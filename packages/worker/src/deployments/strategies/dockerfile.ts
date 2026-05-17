import fs from "node:fs";
import path from "node:path";
import { apps, deployments, domains } from "@shipyard/shared";
import { and, eq } from "drizzle-orm";
import type { DockerRunner } from "../../infrastructure/docker/docker-runner.js";
import { fetchDecryptedEnvVars } from "../env-vars.js";
import {
	createBuildJobRow,
	createWorkspace,
	finalizeBuildJobRow,
	insertStructuredEvent,
} from "../events.js";

const PORT_CONFLICT_RETRIES = 3;
const PORT_CONFLICT_BACKOFF_MS = 2000;

async function runLongLivedWithRetry(
	runner: DockerRunner,
	opts: {
		image: string;
		containerName: string;
		containerPort: number;
		envVars: Record<string, string>;
		labels: Record<string, string>;
	},
): Promise<number> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await runner.runLongLived(opts);
		} catch (err) {
			const msg = err instanceof Error ? err.message : "";
			if (
				msg.includes("port is already allocated") &&
				attempt < PORT_CONFLICT_RETRIES
			) {
				await new Promise((r) =>
					setTimeout(r, PORT_CONFLICT_BACKOFF_MS * attempt),
				);
				continue;
			}
			throw err;
		}
	}
}

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

	try {
		const envMap = await fetchDecryptedEnvVars(db, env, app.id);

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

		const repoUrl = `https://${githubAccessToken}@github.com/${app.githubRepo}.git`;
		const exitCode = await runner.runOnce({
			image: "alpine/git",
			cmd: ["git", "clone", "--depth", "1", repoUrl, "/workspace/repo"],
			binds: [`${workspacePath}:/workspace`],
			env: {},
		});

		const cloneOk = exitCode === 0;
		await finalizeBuildJobRow(db, deploymentId, "clone", cloneOk, 1);

		if (!cloneOk) {
			await insertStructuredEvent(
				db,
				deploymentId,
				"clone",
				`Git clone failed with exit code ${exitCode}`,
			);
			await db
				.update(deployments)
				.set({ status: "failed", finishedAt: new Date() })
				.where(eq(deployments.id, deploymentId));
			logger.warn({ deploymentId, exitCode }, "Clone step failed");
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

		try {
			await runner.buildImage({
				contextDir: repoDir,
				dockerfile: absDockerfile,
				tag: imageTag,
			});
			await finalizeBuildJobRow(db, deploymentId, "dockerfile-build", true, 1);
		} catch (err) {
			await finalizeBuildJobRow(db, deploymentId, "dockerfile-build", false, 0);
			throw err;
		}
		await insertStructuredEvent(
			db,
			deploymentId,
			"dockerfile-build",
			'Step "dockerfile-build" completed',
		);
		logger.info({ deploymentId }, "Docker build completed");

		// Step 3: Stop old long-lived container (best-effort)
		await runner.stopByName(containerName);

		// Port release from the old container isn't instant — wait briefly
		await new Promise((r) => setTimeout(r, 2000));

		// Step 4: Start new long-lived container with retry on port conflict
		await createBuildJobRow(db, deploymentId, "start");

		let hostPort: number;
		try {
			hostPort = await runLongLivedWithRetry(runner, {
				image: imageTag,
				containerName,
				containerPort: port,
				envVars: envMap,
				labels: {
					"shipyard.managed": "true",
					"shipyard.type": "app",
					"shipyard.app-id": app.id,
					"shipyard.worker-id": env.WORKER_ID,
				},
			});
			await finalizeBuildJobRow(db, deploymentId, "start", true, 1);
		} catch (err) {
			await finalizeBuildJobRow(db, deploymentId, "start", false, 0);
			throw err;
		}
		await insertStructuredEvent(
			db,
			deploymentId,
			"start",
			'Step "start" completed',
		);
		logger.info(
			{ containerName, containerPort: port, hostPort },
			"Long-lived container started",
		);

		// Prune old image tags (best-effort)
		await runner.pruneOldImageTags(app.id, imageTag);

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
			logger.info({ domain, port, hostPort }, "Caddy proxy route updated");
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
		fs.rmSync(workspacePath, { recursive: true, force: true });
		logger.info({ workspacePath }, "Workspace cleaned up");
	}
}
