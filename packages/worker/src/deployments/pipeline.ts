import {
	apps,
	deployments,
	organizationMembers,
	users,
} from "@shipyard/shared";
import { asc, eq } from "drizzle-orm";
import type { Env } from "../config/env.js";
import type { DockerRunner } from "../infrastructure/docker/docker-runner.js";
import { deployDockerfile } from "./strategies/dockerfile.js";
import { deployBuildPack } from "./strategies/static.js";

export interface OrchestratorDeps {
	db: unknown;
	env: Env;
	logger: {
		info: (obj: Record<string, unknown>, msg?: string) => void;
		warn: (obj: Record<string, unknown>, msg?: string) => void;
		error: (obj: Record<string, unknown>, msg?: string) => void;
	};
	runner: DockerRunner;
	upsertFileRoute: (
		appId: string,
		domain: string,
		isSpa: boolean,
	) => Promise<void>;
	upsertProxyRoute: (
		appId: string,
		domain: string,
		port: number,
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
			await deployDockerfile(
				deploymentId,
				app,
				githubAccessToken,
				this.db,
				this.deps.env,
				this.deps.logger,
				this.deps.runner,
				this.deps.upsertProxyRoute,
			);
			return;
		}

		await deployBuildPack(
			deploymentId,
			app,
			userId,
			githubAccessToken,
			this.db,
			this.deps.env,
			this.deps.logger,
			this.deps.runner,
			this.deps.upsertFileRoute,
		);
	}
}
