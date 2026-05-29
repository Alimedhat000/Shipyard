import { execSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { apps, deployments, domains } from "@shipyard/shared";
import type { App } from "@shipyard/shared/schema";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { getEnv } from "../../config/env.js";
import type { DockerRunner } from "../../infrastructure/docker/docker-runner.js";
import { LogBuffer } from "../../infrastructure/log-buffer.js";
import { fetchDecryptedEnvVars } from "../env-vars.js";
import {
	createBuildJobRow,
	createWorkspace,
	finalizeBuildJobRow,
	insertStructuredEvent,
} from "../events.js";
import {
	activateDeployment,
	getDeploymentDir,
	pruneDeployments,
} from "../storage.js";

type DB = PostgresJsDatabase<Record<string, unknown>>;

function checkNixpacksInstalled(): void {
	const result = spawnSync("nixpacks", ["--version"], { stdio: "pipe" });
	if (result.error || (result.status ?? 1) !== 0) {
		throw new Error(
			"Nixpacks is not installed. Install it with: curl -fsSL https://nixpacks.com/install.sh | sh",
		);
	}
}

function runNixpacksBuild(
	workspacePath: string,
	app: App,
	envMap: Record<string, string>,
	subdirectory: string,
	isStatic: boolean,
	log: LogBuffer,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const repoDir = subdirectory
			? path.join(workspacePath, "repo", subdirectory)
			: path.join(workspacePath, "repo");
		const imageTag = `shipyard-${app.id}:${workspacePath.split("/").pop()}`;
		const args = ["build", repoDir, "--name", imageTag];

		// Stable cache key per app so nixpacks restores ~/.npm, ~/.cache, etc.
		// between deploys instead of treating each build as a fresh project.
		args.push("--cache-key", `shipyard-${app.id}`);
		args.push("--inline-cache");

		if (isStatic) {
			args.push("--no-error-without-start");
		}
		if (app.installCommand) {
			args.push("--install-cmd", app.installCommand);
		}
		if (app.buildCommand) {
			args.push("--build-cmd", app.buildCommand);
		}
		if (app.runCommand) {
			args.push("--start-cmd", app.runCommand);
		}

		// Pass env vars individually. In a container env, command-line
		// args are not visible to other processes.
		for (const [k, v] of Object.entries(envMap)) {
			args.push("--env", `${k}=${v}`);
		}

		const proc = spawn("nixpacks", args, {
			cwd: repoDir,
			stdio: ["ignore", "pipe", "pipe"],
		});

		proc.stdout?.on("data", (chunk: Buffer) => log.append(chunk.toString()));
		proc.stderr?.on("data", (chunk: Buffer) => log.append(chunk.toString()));

		proc.on("close", (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`Nixpacks build failed (exit ${code})`));
			}
		});

		proc.on("error", (err) => {
			reject(new Error(`Failed to start nixpacks: ${err.message}`));
		});
	});
}

async function extractStaticOutput(
	appId: string,
	deploymentId: string,
	outputDir: string,
	workspacePath: string,
): Promise<void> {
	const imageTag = `shipyard-${appId}:${workspacePath.split("/").pop()}`;
	const containerName = `shipyard-extract-${appId}-${Date.now()}`;
	const sitesDir = getEnv().SITES_DIR;
	const sitesPath = getDeploymentDir(sitesDir, appId, deploymentId);
	fs.mkdirSync(sitesPath, { recursive: true });

	try {
		execSync(`docker create --name ${containerName} ${imageTag}`, {
			stdio: "pipe",
		});

		const containerPath = `/app/${outputDir}`;

		try {
			execSync(`docker cp ${containerName}:${containerPath}/. ${sitesPath}`, {
				stdio: "pipe",
			});
		} catch {
			execSync(`docker cp ${containerName}:/app/. ${sitesPath}`, {
				stdio: "pipe",
			});
		}

		execSync(`docker rm ${containerName}`, { stdio: "pipe" });
	} catch (err) {
		const msg = err instanceof Error ? err.message : "extraction failed";
		throw new Error(`Failed to extract static output: ${msg}`);
	}
}

export async function deployNixpacks(
	deploymentId: string,
	app: App,
	githubAccessToken: string | null,
	db: DB,
	env: ReturnType<typeof getEnv>,
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
	upsertProxyRoute: (
		appId: string,
		domain: string,
		port: number,
	) => Promise<void>,
) {
	checkNixpacksInstalled();

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
	const imageTag = `shipyard-${app.id}:${workspacePath.split("/").pop()}`;
	const subdirectory = app.subdirectory ?? "";

	try {
		const envMap = await fetchDecryptedEnvVars(db, env, app.id);

		await db
			.update(deployments)
			.set({ status: "building", startedAt: new Date() })
			.where(eq(deployments.id, deploymentId));

		// Step 1: Clone
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

		const cloneOk = exitCode !== undefined && exitCode === 0;
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

		// Step 2: Nixpacks build
		await createBuildJobRow(db, deploymentId, "nixpacks-build");
		await insertStructuredEvent(
			db,
			deploymentId,
			"nixpacks-build",
			'Step "nixpacks-build" started',
		);

		const isStatic = app.isStatic ?? true;

		const buildLog = new LogBuffer(deploymentId, "nixpacks-build");

		try {
			await runNixpacksBuild(
				workspacePath,
				app,
				envMap,
				subdirectory,
				isStatic,
				buildLog,
			);
			await finalizeBuildJobRow(db, deploymentId, "nixpacks-build", true, 1);
		} catch (err) {
			await finalizeBuildJobRow(db, deploymentId, "nixpacks-build", false, 0);
			throw err;
		} finally {
			await buildLog.flushOnStepEnd();
		}
		await insertStructuredEvent(
			db,
			deploymentId,
			"nixpacks-build",
			'Step "nixpacks-build" completed',
		);
		logger.info({ deploymentId }, "Nixpacks build completed");

		if (isStatic) {
			// Static path: extract output directory, serve via nginx
			const outputDir = app.outputDir ?? "dist";
			await createBuildJobRow(db, deploymentId, "extract");
			logger.info({ deploymentId, outputDir }, "Extracting static output");

			try {
				await extractStaticOutput(
					app.id,
					deploymentId,
					outputDir,
					workspacePath,
				);
				await finalizeBuildJobRow(db, deploymentId, "extract", true, 1);
			} catch (err) {
				await finalizeBuildJobRow(db, deploymentId, "extract", false, 0);
				throw err;
			}

			await insertStructuredEvent(
				db,
				deploymentId,
				"extract",
				'Step "extract" completed',
			);

			// Activate via symlink swap
			activateDeployment(env.SITES_DIR, app.id, deploymentId);

			// Caddy file route (root permanently points to sites/{appId}/current)
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
					primaryDomain?.domain ??
					`${app.name}.${env.BASE_DOMAIN ?? "bigboss.dev"}`;
				await upsertFileRoute(app.id, domain, app.isSpa ?? false);
				logger.info({ domain }, "Caddy file route updated");
			} catch (err) {
				logger.warn(
					{ err, deploymentId },
					"Caddy route update failed — site may not be accessible",
				);
			}
		} else {
			// Server path: stop old, start new long-lived container
			const port = app.port ?? 80;
			const containerName = `shipyard-app-${app.id}`;

			await createBuildJobRow(db, deploymentId, "start");
			logger.info({ deploymentId }, "Starting long-lived container");

			await runner.stopByName(containerName);
			await new Promise((r) => setTimeout(r, 2000));

			try {
				await runner.runLongLived({
					image: imageTag,
					containerName,
					containerPort: port,
					envVars: envMap,
					labels: {
						"shipyard.managed": "true",
						"shipyard.type": "app",
						"shipyard.app-id": app.id,
						"shipyard.worker-id": env.WORKER_ID ?? "worker-unknown",
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
			logger.info({ containerName, port }, "Long-lived container started");

			await runner.pruneOldImageTags(app.id, imageTag);

			// Activate + Caddy proxy route
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
					primaryDomain?.domain ??
					`${app.name}.${env.BASE_DOMAIN ?? "bigboss.dev"}`;
				await upsertProxyRoute(app.id, domain, port);
				logger.info({ domain, port }, "Caddy proxy route updated");
			} catch (err) {
				logger.warn(
					{ err, deploymentId },
					"Caddy route update failed — site may not be accessible",
				);
			}
		}

		await db
			.update(deployments)
			.set({ status: "success", finishedAt: new Date() })
			.where(eq(deployments.id, deploymentId));
		logger.info({ deploymentId }, "Deployment succeeded");

		// Prune old deployments now that status is "success",
		// so the retention count includes this deployment.
		if (isStatic) {
			await pruneDeployments(
				db,
				app.id,
				env.SITES_DIR,
				env.DEPLOYMENT_KEEP_COUNT,
			);
		}
	} catch (err) {
		logger.error({ err, deploymentId }, "Nixpacks deployment failed");
		await insertStructuredEvent(
			db,
			deploymentId,
			"system",
			`Nixpacks build error: ${err instanceof Error ? err.message : "Unknown error"}`,
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
