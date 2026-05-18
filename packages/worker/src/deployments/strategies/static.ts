import fs from "node:fs";
import path from "node:path";
import { apps, deployments, domains } from "@shipyard/shared";
import type { App } from "@shipyard/shared/schema";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Env } from "../../config/env.js";
import type { DockerRunner } from "../../infrastructure/docker/docker-runner.js";
import { LogBuffer } from "../../infrastructure/log-buffer.js";
import { fetchDecryptedEnvVars } from "../env-vars.js";

type DB = PostgresJsDatabase<Record<string, unknown>>;

import {
	createBuildJobRow,
	createWorkspace,
	finalizeBuildJobRow,
	insertStructuredEvent,
	TWO_GB,
} from "../events.js";
import { runBuildStep } from "../steps/build-step.js";
import type { StepResult } from "../steps/clone-step.js";
import { runCloneStep } from "../steps/clone-step.js";
import { runCopyStep } from "../steps/copy-step.js";
import { runInstallStep } from "../steps/install-step.js";
import { runVerifyStep } from "../steps/verify-step.js";

export async function deployBuildPack(
	deploymentId: string,
	app: App,
	_userId: string,
	githubAccessToken: string | null,
	db: DB,
	env: Env,
	logger: {
		info: (obj: Record<string, unknown>, msg?: string) => void;
		warn: (obj: Record<string, unknown>, msg?: string) => void;
		error: (obj: Record<string, unknown>, msg?: string) => void;
	},
	runner: DockerRunner,
	upsertFileRoute: (
		appId: string,
		domain: string,
		isSpa: boolean,
	) => Promise<void>,
) {
	if (!githubAccessToken) {
		await db
			.update(deployments)
			.set({ status: "failed", finishedAt: new Date() })
			.where(eq(deployments.id, deploymentId));
		await insertStructuredEvent(
			db,
			deploymentId,
			"clone",
			"No GitHub token available. The owner needs to re-authenticate.",
		);
		logger.warn({ deploymentId }, "Deployment failed: no GitHub token");
		return;
	}

	const workspacePath = createWorkspace(env, deploymentId);
	const subdirectory = app.subdirectory ?? "";
	let containerId: string | undefined;

	try {
		const envMap = await fetchDecryptedEnvVars(db, env, app.id);

		const container = await runner.create({
			image: "node:18-bullseye",
			memory: TWO_GB,
			timeout: 0,
			workspaceHost: workspacePath,
			workspaceContainer: "/workspace",
			labels: {
				"shipyard.managed": "true",
				"shipyard.type": "build",
				"shipyard.deployment-id": deploymentId,
				"shipyard.worker-id": env.WORKER_ID,
			},
			envVars: envMap,
		});
		containerId = container.id;
		logger.info(
			{ deploymentId, containerId: containerId.slice(0, 12) },
			"Build container created",
		);

		await db
			.update(deployments)
			.set({ status: "building", startedAt: new Date() })
			.where(eq(deployments.id, deploymentId));

		const stepRunners: {
			name: string;
			run: () => Promise<StepResult>;
		}[] = [
			{
				name: "clone",
				run: () => {
					const log = new LogBuffer(deploymentId, "clone");
					return runCloneStep(
						runner,
						containerId!,
						app,
						githubAccessToken,
						log,
					).finally(() => log.flushOnStepEnd());
				},
			},
			{
				name: "install",
				run: () => {
					const log = new LogBuffer(deploymentId, "install");
					return runInstallStep(
						runner,
						containerId!,
						app,
						log,
						subdirectory,
					).finally(() => log.flushOnStepEnd());
				},
			},
			{
				name: "build",
				run: () => {
					const log = new LogBuffer(deploymentId, "build");
					return runBuildStep(
						runner,
						containerId!,
						app,
						log,
						subdirectory,
					).finally(() => log.flushOnStepEnd());
				},
			},
			{
				name: "verify",
				run: () => {
					const log = new LogBuffer(deploymentId, "verify");
					const outputDir = app.outputDir ?? "dist";
					return runVerifyStep(
						deploymentId,
						outputDir,
						log,
						subdirectory,
					).finally(() => log.flushOnStepEnd());
				},
			},
			{
				name: "copy",
				run: () => {
					const log = new LogBuffer(deploymentId, "copy");
					const outputDir = path.join(
						workspacePath,
						"repo",
						subdirectory,
						app.outputDir ?? "dist",
					);
					return runCopyStep(app.id, outputDir).finally(() =>
						log.flushOnStepEnd(),
					);
				},
			},
		];

		const timeoutMs = (app.buildTimeout ?? 900) * 1000;

		const stepLoop = (async () => {
			for (const step of stepRunners) {
				await createBuildJobRow(db, deploymentId, step.name);
				await insertStructuredEvent(
					db,
					deploymentId,
					step.name,
					`Step "${step.name}" started`,
				);
				logger.info({ deploymentId, step: step.name }, "Step started");

				let result: StepResult;
				try {
					result = await step.run();
				} catch (err) {
					await finalizeBuildJobRow(db, deploymentId, step.name, false, 0);
					throw err;
				}

				await finalizeBuildJobRow(
					db,
					deploymentId,
					step.name,
					result.ok,
					result.attempts,
				);

				if (result.ok) {
					await insertStructuredEvent(
						db,
						deploymentId,
						step.name,
						`Step "${step.name}" completed`,
					);
					logger.info(
						{ deploymentId, step: step.name, attempts: result.attempts },
						"Step completed",
					);
				} else {
					await insertStructuredEvent(
						db,
						deploymentId,
						step.name,
						`Step "${step.name}" failed: ${result.error?.message}`,
					);
					await db
						.update(deployments)
						.set({ status: "failed", finishedAt: new Date() })
						.where(eq(deployments.id, deploymentId));
					logger.warn(
						{
							deploymentId,
							step: step.name,
							error: result.error?.message,
							category: result.error?.category,
							attempts: result.attempts,
						},
						"Step failed",
					);
					return;
				}
			}

			await db
				.update(apps)
				.set({ activeDeploymentId: deploymentId })
				.where(eq(apps.id, app.id));
			logger.info({ deploymentId }, "Deployment activated");

			try {
				const results = await db
					.select({ domain: domains.domain })
					.from(domains)
					.where(and(eq(domains.appId, app.id), eq(domains.isPrimary, true)));
				const primaryDomain = Array.isArray(results) ? results[0] : undefined;

				const domain =
					primaryDomain?.domain ?? `${app.name}.${env.BASE_DOMAIN}`;
				await upsertFileRoute(app.id, domain, app.isSpa ?? false);
				logger.info({ domain }, "Caddy route updated");
			} catch (err) {
				logger.warn(
					{ err, deploymentId },
					"Caddy route update failed — site may not be accessible until resolved",
				);
			}

			await db
				.update(deployments)
				.set({ status: "success", finishedAt: new Date() })
				.where(eq(deployments.id, deploymentId));
			logger.info({ deploymentId }, "Deployment succeeded");
		})();

		const timeoutGuard = new Promise<never>((_, reject) => {
			const timer = setTimeout(
				() =>
					reject(
						new Error(
							`Deployment timed out after ${app.buildTimeout ?? 900} seconds`,
						),
					),
				timeoutMs,
			);
			if (typeof timer === "object" && timer !== null && "unref" in timer) {
				(timer as { unref: () => void }).unref();
			}
		});

		await Promise.race([stepLoop, timeoutGuard]);
	} catch (err) {
		const isTimeout = err instanceof Error && err.message.includes("timed out");
		logger.error(
			{ err, deploymentId },
			isTimeout ? "Deployment timed out" : "Build error",
		);
		await insertStructuredEvent(
			db,
			deploymentId,
			"system",
			isTimeout
				? `Deployment timed out after ${app.buildTimeout ?? 900} seconds.`
				: `Build error: ${err instanceof Error ? err.message : "Unknown error"}`,
		);
		await db
			.update(deployments)
			.set({ status: "failed", finishedAt: new Date() })
			.where(eq(deployments.id, deploymentId));
	} finally {
		if (containerId) {
			await runner.remove(containerId);
			logger.info(
				{ containerId: containerId.slice(0, 12) },
				"Build container removed",
			);
		}
		fs.rmSync(workspacePath, { recursive: true, force: true });
		logger.info({ workspacePath }, "Workspace cleaned up");
	}
}
