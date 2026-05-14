import fs from "node:fs";
import path from "node:path";
import { apps, deployments, domains } from "@shipyard/shared";
import { and, eq } from "drizzle-orm";
import type { DockerRunner } from "./docker/docker-runner.js";
import { LogBuffer } from "./logs/log-buffer.js";
import {
	createBuildJobRow,
	createWorkspace,
	fetchDecryptedEnvVars,
	finalizeBuildJobRow,
	insertStructuredEvent,
	TWO_GB,
} from "./shared.js";
import { runCloneStep } from "./steps/clone-step.js";

export async function deployDockerfile(
	deploymentId: string,
	// biome-ignore lint/suspicious/noExplicitAny: DB query result shape known at runtime
	app: Record<string, any>,
	githubAccessToken: string | null,
	// biome-ignore lint/suspicious/noExplicitAny: Drizzle query builder type too complex to abstract
	db: any,
	// biome-ignore lint/suspicious/noExplicitAny: runtime shape matches Env
	env: any,
	logger: {
		info: (obj: Record<string, unknown>, msg?: string) => void;
		warn: (obj: Record<string, unknown>, msg?: string) => void;
		error: (obj: Record<string, unknown>, msg?: string) => void;
	},
	runner: DockerRunner,
	upsertProxyRoute: (
		appId: string,
		domain: string,
		port: number,
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
	const imageTag = `shipyard-${app.id}:${deploymentId}`;
	const containerName = `shipyard-app-${app.id}`;
	const port = app.port ?? 80;
	const dockerfilePath = app.dockerfilePath ?? "./Dockerfile";
	let buildContainerId: string | undefined;

	try {
		const envMap = await fetchDecryptedEnvVars(db, env, app.id);

		const buildContainer = await runner.create({
			image: "node:20-bookworm-slim",
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
			envVars: {},
		});
		buildContainerId = buildContainer.id;
		logger.info(
			{ deploymentId, containerId: buildContainerId.slice(0, 12) },
			"Clone container created",
		);

		await db
			.update(deployments)
			.set({ status: "building", startedAt: new Date() })
			.where(eq(deployments.id, deploymentId));

		// Step 1: Clone repo
		await createBuildJobRow(db, deploymentId, "clone");
		await insertStructuredEvent(
			db,
			deploymentId,
			"clone",
			'Step "clone" started',
		);
		logger.info({ deploymentId }, "Clone step started");

		const cloneLog = new LogBuffer(deploymentId, "clone");
		const cloneResult = await runCloneStep(
			runner,
			buildContainerId,
			app as any,
			githubAccessToken,
			cloneLog,
		).finally(() => cloneLog.flushOnStepEnd());

		await finalizeBuildJobRow(
			db,
			deploymentId,
			"clone",
			cloneResult.ok,
			cloneResult.attempts || 0,
		);

		if (!cloneResult.ok) {
			await insertStructuredEvent(
				db,
				deploymentId,
				"clone",
				`Step "clone" failed: ${cloneResult.error?.message}`,
			);
			await db
				.update(deployments)
				.set({ status: "failed", finishedAt: new Date() })
				.where(eq(deployments.id, deploymentId));
			logger.warn(
				{ deploymentId, error: cloneResult.error?.message },
				"Clone step failed",
			);
			return;
		}

		await insertStructuredEvent(
			db,
			deploymentId,
			"clone",
			'Step "clone" completed',
		);
		logger.info({ deploymentId }, "Clone step completed");

		// Step 2: Docker build
		await createBuildJobRow(db, deploymentId, "dockerfile-build");

		const repoDir = path.join(workspacePath, "repo");
		const absDockerfile = path.resolve(repoDir, dockerfilePath);

		await runner.buildImage({
			contextDir: repoDir,
			dockerfile: absDockerfile,
			tag: imageTag,
		});

		await finalizeBuildJobRow(db, deploymentId, "dockerfile-build", true, 0);
		await insertStructuredEvent(
			db,
			deploymentId,
			"dockerfile-build",
			'Step "dockerfile-build" completed',
		);
		logger.info({ deploymentId }, "Docker build completed");

		// Step 3: Stop old long-lived container (best-effort)
		await runner.stopByName(containerName);

		// Step 4: Start new long-lived container
		await createBuildJobRow(db, deploymentId, "start");

		await runner.runLongLived({
			image: imageTag,
			containerName,
			port,
			envVars: envMap,
			labels: {
				"shipyard.managed": "true",
				"shipyard.type": "app",
				"shipyard.app-id": app.id,
				"shipyard.worker-id": env.WORKER_ID,
			},
		});

		await finalizeBuildJobRow(db, deploymentId, "start", true, 0);
		await insertStructuredEvent(
			db,
			deploymentId,
			"start",
			'Step "start" completed',
		);
		logger.info({ containerName, port }, "Long-lived container started");

		// Step 5: Activate deployment
		await db
			.update(apps)
			.set({ activeDeploymentId: deploymentId })
			.where(eq(apps.id, app.id));
		logger.info({ deploymentId }, "Deployment activated");

		// Step 6: Update Caddy route with reverse proxy
		try {
			const results = await db
				.select({ domain: domains.domain })
				.from(domains)
				.where(and(eq(domains.appId, app.id), eq(domains.isPrimary, true)));
			const primaryDomain = Array.isArray(results) ? results[0] : undefined;

			const domain = primaryDomain?.domain ?? `${app.name}.${env.BASE_DOMAIN}`;
			await upsertProxyRoute(app.id, domain, port);
			logger.info({ domain, port }, "Caddy proxy route updated");
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
	} catch (err) {
		logger.error({ err, deploymentId }, "Dockerfile build failed");
		await insertStructuredEvent(
			db,
			deploymentId,
			"system",
			`Dockerfile build error: ${err instanceof Error ? err.message : "Unknown error"}`,
		);
		await db
			.update(deployments)
			.set({ status: "failed", finishedAt: new Date() })
			.where(eq(deployments.id, deploymentId));
	} finally {
		if (buildContainerId) {
			await runner.remove(buildContainerId);
			logger.info(
				{ containerId: buildContainerId.slice(0, 12) },
				"Clone container removed",
			);
		}
		fs.rmSync(workspacePath, { recursive: true, force: true });
		logger.info({ workspacePath }, "Workspace cleaned up");
	}
}
