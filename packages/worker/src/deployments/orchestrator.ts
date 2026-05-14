import fs from "node:fs";
import path from "node:path";
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
import { and, asc, eq } from "drizzle-orm";
import type { Env } from "../config/env.js";
import type { DockerRunner } from "./docker/docker-runner.js";
import { LogBuffer } from "./logs/log-buffer.js";
import { runBuildStep } from "./steps/build-step.js";
import type { StepResult } from "./steps/clone-step.js";
import { runCloneStep } from "./steps/clone-step.js";
import { runCopyStep } from "./steps/copy-step.js";
import { runInstallStep } from "./steps/install-step.js";
import { runVerifyStep } from "./steps/verify-step.js";

const TWO_GB = 2 * 1024 * 1024 * 1024;

export interface OrchestratorDeps {
	db: unknown;
	env: Env;
	logger: {
		info: (obj: Record<string, unknown>, msg?: string) => void;
		warn: (obj: Record<string, unknown>, msg?: string) => void;
		error: (obj: Record<string, unknown>, msg?: string) => void;
	};
	runner: DockerRunner;
	upsertRoute: (
		appId: string,
		domain: string,
		userId: string,
		deploymentId: string,
		isSpaOrPort: boolean | number,
	) => Promise<void>;
}

export class DeploymentOrchestrator {
	constructor(private deps: OrchestratorDeps) {}

	private get db() {
		// biome-ignore lint/suspicious/noExplicitAny: Drizzle query builder type too complex to abstract
		return this.deps.db as any;
	}

	private async fetchDeploymentContext(deploymentId: string) {
		const rows = await this.db
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

	private async fetchDecryptedEnvVars(appId: string) {
		const rows = await this.db
			.select()
			.from(envVars)
			.where(eq(envVars.appId, appId));

		const masterKey = this.deps.env.ENCRYPTION_KEY;
		const result: Record<string, string> = {};

		for (const row of rows as {
			key: string;
			value: string;
			isSecret: boolean;
		}[]) {
			const val = row.isSecret ? decrypt(row.value, masterKey) : row.value;
			result[row.key] = val;
		}

		return result;
	}

	private async createBuildJobRow(deploymentId: string, stepName: string) {
		await this.db.insert(buildJobs).values({
			deploymentId,
			step: stepName,
			status: "running",
			startedAt: new Date(),
		});
	}

	private async finalizeBuildJobRow(
		deploymentId: string,
		stepName: string,
		ok: boolean,
		attempts: number,
	) {
		await this.db
			.update(buildJobs)
			.set({
				status: ok ? "success" : "failed",
				finishedAt: new Date(),
				attempts,
			})
			.where(
				and(
					eq(buildJobs.deploymentId, deploymentId),
					eq(buildJobs.step, stepName),
					eq(buildJobs.status, "running"),
				),
			);
	}

	private async insertStructuredEvent(
		deploymentId: string,
		step: string,
		content: string,
	) {
		await this.db
			.insert(deploymentLogs)
			.values({ deploymentId, step, content });
	}

	async process(deploymentId: string): Promise<void> {
		const ctx = await this.fetchDeploymentContext(deploymentId);
		// biome-ignore lint/suspicious/noExplicitAny: DB query result shape known at runtime
		const app: Record<string, any> = ctx.app;
		const userId: string = ctx.userId;
		const githubAccessToken: string | null = ctx.githubAccessToken;

		this.deps.logger.info(
			{ deploymentId, appId: app.id, repo: app.githubRepo },
			"Starting build",
		);

		if (app.buildPack === "dockerfile") {
			await this.processDockerfileBuild(
				deploymentId,
				app,
				userId,
				githubAccessToken,
			);
			return;
		}

		if (!githubAccessToken) {
			await this.db
				.update(deployments)
				.set({ status: "failed", finishedAt: new Date() })
				.where(eq(deployments.id, deploymentId));
			await this.insertStructuredEvent(
				deploymentId,
				"clone",
				"No GitHub token available. The owner needs to re-authenticate.",
			);
			this.deps.logger.warn(
				{ deploymentId },
				"Deployment failed: no GitHub token",
			);
			return;
		}

		const workspacePath = this.createWorkspace(deploymentId);
		let containerId: string | undefined;

		try {
			const envMap = await this.fetchDecryptedEnvVars(app.id);

			const container = await this.deps.runner.create({
				image: "node:18-bullseye",
				memory: TWO_GB,
				timeout: 0,
				workspaceHost: workspacePath,
				workspaceContainer: "/workspace",
				labels: {
					"shipyard.managed": "true",
					"shipyard.type": "build",
					"shipyard.deployment-id": deploymentId,
					"shipyard.worker-id": this.deps.env.WORKER_ID,
				},
				envVars: envMap,
			});
			containerId = container.id;
			this.deps.logger.info(
				{ deploymentId, containerId: containerId.slice(0, 12) },
				"Build container created",
			);

			await this.db
				.update(deployments)
				.set({ status: "building", startedAt: new Date() })
				.where(eq(deployments.id, deploymentId));

			const runner = this.deps.runner;

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
							// biome-ignore lint/suspicious/noExplicitAny: runtime shape matches
							app as any,
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
							// biome-ignore lint/suspicious/noExplicitAny: runtime shape matches
							app as any,
							log,
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
							// biome-ignore lint/suspicious/noExplicitAny: runtime shape matches
							app as any,
							log,
						).finally(() => log.flushOnStepEnd());
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
					name: "copy",
					run: () => {
						const log = new LogBuffer(deploymentId, "copy");
						const outputDir = path.join(
							workspacePath,
							"repo",
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
					await this.createBuildJobRow(deploymentId, step.name);
					await this.insertStructuredEvent(
						deploymentId,
						step.name,
						`Step "${step.name}" started`,
					);
					this.deps.logger.info(
						{ deploymentId, step: step.name },
						"Step started",
					);

					const result = await step.run();

					await this.finalizeBuildJobRow(
						deploymentId,
						step.name,
						result.ok,
						result.attempts,
					);

					if (result.ok) {
						await this.insertStructuredEvent(
							deploymentId,
							step.name,
							`Step "${step.name}" completed`,
						);
						this.deps.logger.info(
							{ deploymentId, step: step.name, attempts: result.attempts },
							"Step completed",
						);
					} else {
						await this.insertStructuredEvent(
							deploymentId,
							step.name,
							`Step "${step.name}" failed: ${result.error?.message}`,
						);
						await this.db
							.update(deployments)
							.set({ status: "failed", finishedAt: new Date() })
							.where(eq(deployments.id, deploymentId));
						this.deps.logger.warn(
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

				await this.db
					.update(apps)
					.set({ activeDeploymentId: deploymentId })
					.where(eq(apps.id, app.id));
				this.deps.logger.info({ deploymentId }, "Deployment activated");

				try {
					const results = await this.db
						.select({ domain: domains.domain })
						.from(domains)
						.where(and(eq(domains.appId, app.id), eq(domains.isPrimary, true)));
					const primaryDomain = Array.isArray(results) ? results[0] : undefined;

					const domain =
						primaryDomain?.domain ?? `${app.name}.${this.deps.env.BASE_DOMAIN}`;
					await this.deps.upsertRoute(
						app.id,
						domain,
						userId,
						deploymentId,
						app.isSpa ?? false,
					);
					this.deps.logger.info({ domain }, "Caddy route updated");
				} catch (err) {
					this.deps.logger.warn(
						{ err, deploymentId },
						"Caddy route update failed — site may not be accessible until resolved",
					);
				}

				await this.db
					.update(deployments)
					.set({ status: "success", finishedAt: new Date() })
					.where(eq(deployments.id, deploymentId));
				this.deps.logger.info({ deploymentId }, "Deployment succeeded");
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
			const isTimeout =
				err instanceof Error && err.message.includes("timed out");
			this.deps.logger.error(
				{ err, deploymentId },
				isTimeout ? "Deployment timed out" : "Build error",
			);
			await this.insertStructuredEvent(
				deploymentId,
				"system",
				isTimeout
					? `Deployment timed out after ${app.buildTimeout ?? 900} seconds.`
					: `Build error: ${err instanceof Error ? err.message : "Unknown error"}`,
			);
			await this.db
				.update(deployments)
				.set({ status: "failed", finishedAt: new Date() })
				.where(eq(deployments.id, deploymentId));
		} finally {
			if (containerId) {
				await this.deps.runner.remove(containerId);
				this.deps.logger.info(
					{ containerId: containerId.slice(0, 12) },
					"Build container removed",
				);
			}
			fs.rmSync(workspacePath, { recursive: true, force: true });
			this.deps.logger.info({ workspacePath }, "Workspace cleaned up");
		}
	}

	private async processDockerfileBuild(
		deploymentId: string,
		app: Record<string, any>,
		userId: string,
		githubAccessToken: string | null,
	) {
		if (!githubAccessToken) {
			await this.db
				.update(deployments)
				.set({ status: "failed", finishedAt: new Date() })
				.where(eq(deployments.id, deploymentId));
			await this.insertStructuredEvent(
				deploymentId,
				"clone",
				"No GitHub token available. The owner needs to re-authenticate.",
			);
			this.deps.logger.warn(
				{ deploymentId },
				"Deployment failed: no GitHub token",
			);
			return;
		}

		const workspacePath = this.createWorkspace(deploymentId);
		const imageTag = `shipyard-${app.id}:${deploymentId}`;
		const containerName = `shipyard-app-${app.id}`;
		const port = app.port ?? 80;
		const dockerfilePath = app.dockerfilePath ?? "./Dockerfile";
		let buildContainerId: string | undefined;

		try {
			const envMap = await this.fetchDecryptedEnvVars(app.id);

			const buildContainer = await this.deps.runner.create({
				image: "alpine/git",
				memory: TWO_GB,
				timeout: 0,
				workspaceHost: workspacePath,
				workspaceContainer: "/workspace",
				labels: {
					"shipyard.managed": "true",
					"shipyard.type": "build",
					"shipyard.deployment-id": deploymentId,
					"shipyard.worker-id": this.deps.env.WORKER_ID,
				},
				envVars: {},
			});
			buildContainerId = buildContainer.id;
			this.deps.logger.info(
				{ deploymentId, containerId: buildContainerId.slice(0, 12) },
				"Clone container created",
			);

			await this.db
				.update(deployments)
				.set({ status: "building", startedAt: new Date() })
				.where(eq(deployments.id, deploymentId));

			const runner = this.deps.runner;

			// Step 1: Clone repo
			await this.createBuildJobRow(deploymentId, "clone");
			await this.insertStructuredEvent(
				deploymentId,
				"clone",
				'Step "clone" started',
			);
			this.deps.logger.info({ deploymentId }, "Clone step started");

			const cloneLog = new LogBuffer(deploymentId, "clone");
			const cloneResult = await runCloneStep(
				runner,
				buildContainerId,
				// biome-ignore lint/suspicious/noExplicitAny: runtime shape matches
				app as any,
				githubAccessToken,
				cloneLog,
			).finally(() => cloneLog.flushOnStepEnd());

			await this.finalizeBuildJobRow(
				deploymentId,
				"clone",
				cloneResult.ok,
				cloneResult.attempts || 0,
			);

			if (!cloneResult.ok) {
				await this.insertStructuredEvent(
					deploymentId,
					"clone",
					`Step "clone" failed: ${cloneResult.error?.message}`,
				);
				await this.db
					.update(deployments)
					.set({ status: "failed", finishedAt: new Date() })
					.where(eq(deployments.id, deploymentId));
				this.deps.logger.warn(
					{ deploymentId, error: cloneResult.error?.message },
					"Clone step failed",
				);
				return;
			}

			await this.insertStructuredEvent(
				deploymentId,
				"clone",
				'Step "clone" completed',
			);
			this.deps.logger.info({ deploymentId }, "Clone step completed");

			// Step 2: Docker build
			await this.createBuildJobRow(deploymentId, "dockerfile-build");

			const repoDir = path.join(workspacePath, "repo");
			const absDockerfile = path.resolve(repoDir, dockerfilePath);

			await this.deps.runner.buildImage({
				contextDir: repoDir,
				dockerfile: absDockerfile,
				tag: imageTag,
				onData: (chunk) => {
					// Build output is captured by LogBuffer via flushOnStepEnd
					// For inline logging, we just let it pass through
				},
			});

			await this.finalizeBuildJobRow(deploymentId, "dockerfile-build", true, 0);
			await this.insertStructuredEvent(
				deploymentId,
				"dockerfile-build",
				'Step "dockerfile-build" completed',
			);
			this.deps.logger.info({ deploymentId }, "Docker build completed");

			// Step 3: Stop old long-lived container (best-effort)
			await this.deps.runner.stopByName(containerName);

			// Step 4: Start new long-lived container
			await this.createBuildJobRow(deploymentId, "start");

			await this.deps.runner.runLongLived({
				image: imageTag,
				containerName,
				port,
				envVars: envMap,
				labels: {
					"shipyard.managed": "true",
					"shipyard.type": "app",
					"shipyard.app-id": app.id,
					"shipyard.worker-id": this.deps.env.WORKER_ID,
				},
			});

			await this.finalizeBuildJobRow(deploymentId, "start", true, 0);
			await this.insertStructuredEvent(
				deploymentId,
				"start",
				'Step "start" completed',
			);
			this.deps.logger.info(
				{ containerName, port },
				"Long-lived container started",
			);

			// Step 5: Activate deployment
			await this.db
				.update(apps)
				.set({ activeDeploymentId: deploymentId })
				.where(eq(apps.id, app.id));
			this.deps.logger.info({ deploymentId }, "Deployment activated");

			// Step 6: Update Caddy route with reverse proxy
			try {
				const results = await this.db
					.select({ domain: domains.domain })
					.from(domains)
					.where(and(eq(domains.appId, app.id), eq(domains.isPrimary, true)));
				const primaryDomain = Array.isArray(results) ? results[0] : undefined;

				const domain =
					primaryDomain?.domain ?? `${app.name}.${this.deps.env.BASE_DOMAIN}`;
				await this.deps.upsertRoute(app.id, domain, userId, deploymentId, port);
				this.deps.logger.info({ domain, port }, "Caddy proxy route updated");
			} catch (err) {
				this.deps.logger.warn(
					{ err, deploymentId },
					"Caddy route update failed — site may not be accessible until resolved",
				);
			}

			await this.db
				.update(deployments)
				.set({ status: "success", finishedAt: new Date() })
				.where(eq(deployments.id, deploymentId));
			this.deps.logger.info({ deploymentId }, "Deployment succeeded");
		} catch (err) {
			this.deps.logger.error({ err, deploymentId }, "Dockerfile build failed");
			await this.insertStructuredEvent(
				deploymentId,
				"system",
				`Dockerfile build error: ${err instanceof Error ? err.message : "Unknown error"}`,
			);
			await this.db
				.update(deployments)
				.set({ status: "failed", finishedAt: new Date() })
				.where(eq(deployments.id, deploymentId));
		} finally {
			if (buildContainerId) {
				await this.deps.runner.remove(buildContainerId);
				this.deps.logger.info(
					{ containerId: buildContainerId.slice(0, 12) },
					"Clone container removed",
				);
			}
			fs.rmSync(workspacePath, { recursive: true, force: true });
			this.deps.logger.info({ workspacePath }, "Workspace cleaned up");
		}
	}

	private createWorkspace(deploymentId: string): string {
		const ws = path.join(this.deps.env.BUILD_WORKSPACE_DIR, deploymentId);
		fs.mkdirSync(ws, { recursive: true });
		return ws;
	}
}
