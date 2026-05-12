import fs from "node:fs";
import path from "node:path";
import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import {
	apps,
	buildJobs,
	decrypt,
	deploymentLogs,
	deployments,
	domains,
	envVars,
	organizationMembers,
	users,
} from "@shipyard/shared";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { db } from "../config/db.js";
import { getEnv } from "../config/env.js";
import { logger } from "../config/logger.js";
import { updateCaddyRoute } from "./caddy/client.js";
import { DockerRunner } from "./docker/docker-runner.js";
import { LogBuffer } from "./logs/log-buffer.js";
import { runBuildStep } from "./steps/build-step.js";
import type { StepResult } from "./steps/clone-step.js";
import { runCloneStep } from "./steps/clone-step.js";
import { runInstallStep } from "./steps/install-step.js";
import { runUploadStep } from "./steps/upload-step.js";
import { runVerifyStep } from "./steps/verify-step.js";
import { getS3Client } from "./storage/s3-client.js";

const TWO_GB = 2 * 1024 * 1024 * 1024;

/**
 * Fetches the deployment, its app, and the user's GitHub token.
 *
 * Joins: deployments → apps → organization_members → users.
 * Picks the first (oldest) org member — this assumes single-member orgs
 * in MVP (ADR-0008). When teams land, deployments should track the
 * triggering user explicitly.
 */
async function fetchDeploymentContext(deploymentId: string) {
	const rows = await db
		.select({
			deployment: deployments,
			app: apps,
			githubAccessToken: users.githubAccessToken,
			userId: users.id,
		})
		.from(deployments)
		.innerJoin(apps, eq(deployments.appId, apps.id))
		.innerJoin(
			organizationMembers,
			eq(apps.organizationId, organizationMembers.organizationId),
		)
		.innerJoin(users, eq(organizationMembers.userId, users.id))
		.where(eq(deployments.id, deploymentId))
		.orderBy(asc(organizationMembers.createdAt));

	if (rows.length === 0) {
		throw new Error(`Deployment ${deploymentId} not found`);
	}
	return rows[0];
}

/**
 * Fetches all env vars for an app and decrypts secret ones.
 */
async function fetchDecryptedEnvVars(appId: string) {
	const rows = await db.select().from(envVars).where(eq(envVars.appId, appId));

	const masterKey = getEnv().ENCRYPTION_KEY;
	const result: Record<string, string> = {};

	for (const row of rows) {
		const val = row.isSecret ? decrypt(row.value, masterKey) : row.value;
		result[row.key] = val;
	}

	return result;
}

/** Creates the workspace directory on the bind mount and returns its path. */
function createWorkspace(deploymentId: string): string {
	const ws = path.join(getEnv().BUILD_WORKSPACE_DIR, deploymentId);
	fs.mkdirSync(ws, { recursive: true });
	return ws;
}

/** Inserts a build_job row in "running" state for the given step. */
async function createBuildJobRow(deploymentId: string, step: string) {
	await db.insert(buildJobs).values({
		deploymentId,
		step,
		status: "running",
		startedAt: new Date(),
	});
}

/** Updates the latest running build_job for a step to success or failed. */
async function finalizeBuildJobRow(
	deploymentId: string,
	step: string,
	ok: boolean,
	attempts: number,
) {
	await db
		.update(buildJobs)
		.set({
			status: ok ? "success" : "failed",
			finishedAt: new Date(),
			attempts,
		})
		.where(
			and(
				eq(buildJobs.deploymentId, deploymentId),
				eq(buildJobs.step, step),
				eq(buildJobs.status, "running"),
			),
		);
}

/** Inserts a structured event into deployment_logs (not raw stdout). */
async function insertStructuredEvent(
	deploymentId: string,
	step: string,
	content: string,
) {
	await db.insert(deploymentLogs).values({ deploymentId, step, content });
}

/**
 * Main build orchestrator.
 *
 * 1. Fetches deployment context (app, GitHub token)
 * 2. Creates workspace on bind mount
 * 3. Creates Docker container (node:18-bullseye, 2GB mem, labels, env)
 * 4. Marks deployment as "building"
 * 5. Runs steps sequentially: clone → install → build → verify
 * 6. On failure: marks deployment "failed", stops step execution
 * 7. On success: marks deployment "success"
 * 8. Always: removes container + cleans up workspace
 *
 * @param deploymentId - UUID of the deployment to process
 */
export async function processDeployment(deploymentId: string) {
	const ctx = await fetchDeploymentContext(deploymentId);
	const { deployment: _deployment, app, githubAccessToken, userId } = ctx;

	logger.info({ deploymentId, appId: app.id }, "Starting build");

	// return early
	if (!githubAccessToken) {
		await db
			.update(deployments)
			.set({ status: "failed", finishedAt: new Date() })
			.where(eq(deployments.id, deploymentId));
		await insertStructuredEvent(
			deploymentId,
			"clone",
			"No GitHub token available. The owner needs to re-authenticate.",
		);
		logger.warn({ deploymentId }, "Deployment failed: no GitHub token");
		return;
	}

	const workspacePath = createWorkspace(deploymentId);
	const runner = new DockerRunner();
	let containerId: string | undefined;

	try {
		const envMap = await fetchDecryptedEnvVars(app.id);

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
				"shipyard.worker-id": getEnv().WORKER_ID,
			},
			envVars: envMap,
		});
		containerId = container.id;

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
					return runInstallStep(runner, containerId!, app, log).finally(() =>
						log.flushOnStepEnd(),
					);
				},
			},
			{
				name: "build",
				run: () => {
					const log = new LogBuffer(deploymentId, "build");
					return runBuildStep(runner, containerId!, app, log).finally(() =>
						log.flushOnStepEnd(),
					);
				},
			},
			{
				name: "verify",
				run: () => {
					const log = new LogBuffer(deploymentId, "verify");
					const outputDir = app.outputDir ?? "dist";
					return runVerifyStep(deploymentId, outputDir, log).finally(() =>
						log.flushOnStepEnd(),
					);
				},
			},
			{
				name: "upload",
				run: () => {
					const log = new LogBuffer(deploymentId, "upload");
					const outputDir = app.outputDir ?? "dist";
					return runUploadStep(
						deploymentId,
						app,
						userId,
						outputDir,
						log,
					).finally(() => log.flushOnStepEnd());
				},
			},
		];

		const timeoutMs = (app.buildTimeout ?? 900) * 1000;

		const stepLoop = (async () => {
			for (const step of stepRunners) {
				await createBuildJobRow(deploymentId, step.name);
				await insertStructuredEvent(
					deploymentId,
					step.name,
					`Step "${step.name}" started`,
				);

				const result = await step.run();

				await finalizeBuildJobRow(
					deploymentId,
					step.name,
					result.ok,
					result.attempts,
				);

				if (result.ok) {
					await insertStructuredEvent(
						deploymentId,
						step.name,
						`Step "${step.name}" completed`,
					);
				} else {
					await insertStructuredEvent(
						deploymentId,
						step.name,
						`Step "${step.name}" failed: ${result.error?.message}`,
					);
					await db
						.update(deployments)
						.set({ status: "failed", finishedAt: new Date() })
						.where(eq(deployments.id, deploymentId));
					logger.info({ deploymentId, step: step.name }, "Deployment failed");
					return;
				}
			}

			const bucket = getEnv().GARAGE_S3_BUCKET;
			const s3 = getS3Client();

			// Activate deployment
			await db
				.update(apps)
				.set({ activeDeploymentId: deploymentId })
				.where(eq(apps.id, app.id));
			logger.info({ deploymentId }, "Deployment activated");

			// Caddy: update route for this deployment
			try {
				const [primaryDomain] = await db
					.select({ domain: domains.domain })
					.from(domains)
					.where(and(eq(domains.appId, app.id), eq(domains.isPrimary, true)));
				const domain =
					primaryDomain?.domain ?? `${app.name}.${getEnv().BASE_DOMAIN}`;
				await updateCaddyRoute(
					domain,
					userId,
					app.id,
					deploymentId,
					app.isSpa ?? false,
				);
				logger.info({ domain }, "Caddy route updated");
			} catch (err) {
				logger.warn(
					{ err, deploymentId },
					"Caddy route update failed — site may not be accessible until resolved",
				);
			}

			// Retention: delete old deployments from S3 (keep newest 5)
			const oldDeployments = await db
				.select({ id: deployments.id })
				.from(deployments)
				.where(
					and(
						eq(deployments.appId, app.id),
						eq(deployments.status, "success"),
						ne(deployments.id, deploymentId),
					),
				)
				.orderBy(desc(deployments.createdAt))
				.offset(5);

			for (const dep of oldDeployments) {
				const prefix = `users/${userId}/apps/${app.id}/deployments/${dep.id}`;
				const list = await s3.send(
					new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }),
				);
				if (list.Contents?.length) {
					await s3.send(
						new DeleteObjectsCommand({
							Bucket: bucket,
							Delete: {
								Objects: list.Contents.map((o) => ({ Key: o.Key })),
								Quiet: true,
							},
						}),
					);
					logger.info(
						{ deploymentId: dep.id },
						"Deleted old deployment from storage",
					);
				}
			}

			await db
				.update(deployments)
				.set({ status: "success", finishedAt: new Date() })
				.where(eq(deployments.id, deploymentId));
			logger.info({ deploymentId }, "Deployment succeeded");
		})();

		const timeoutGuard = new Promise<never>((_, reject) =>
			setTimeout(
				() =>
					reject(
						new Error(
							`Deployment timed out after ${app.buildTimeout ?? 900} seconds`,
						),
					),
				timeoutMs,
			),
		);

		await Promise.race([stepLoop, timeoutGuard]);
	} catch (err) {
		const isTimeout = err instanceof Error && err.message.includes("timed out");
		logger.error(
			{ err, deploymentId },
			isTimeout ? "Deployment timed out" : "Build error",
		);
		await insertStructuredEvent(
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
		}
		fs.rmSync(workspacePath, { recursive: true, force: true });
	}
}
