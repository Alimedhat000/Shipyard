import fs from "node:fs";
import path from "node:path";
import type { DeploymentJob } from "@shipyard/shared";
import {
	apps,
	deploymentLogs,
	deployments,
	domains,
	organizationMembers,
	QUEUE_NAME,
	users,
} from "@shipyard/shared";
import { Worker } from "bullmq";
import { and, eq, isNotNull } from "drizzle-orm";
import Redis from "ioredis";
import { db } from "./config/db.js";
import { getEnv } from "./config/env.js";
import { logger } from "./config/logger.js";
import { processDeployment } from "./deployments/processor.js";
import {
	upsertFileRoute,
	upsertProxyRoute,
} from "./infrastructure/caddy/client.js";
import { DockerRunner } from "./infrastructure/docker/docker-runner.js";

logger.info("Shipyard worker starting...");

const env = getEnv();

async function reconcileCaddyRoutes(): Promise<number> {
	const rows = await db
		.select({
			app: apps,
			userId: users.id,
			primaryDomain: domains.domain,
		})
		.from(apps)
		.innerJoin(
			organizationMembers,
			eq(apps.organizationId, organizationMembers.organizationId),
		)
		.innerJoin(users, eq(organizationMembers.userId, users.id))
		.leftJoin(
			domains,
			and(eq(domains.appId, apps.id), eq(domains.isPrimary, true)),
		)
		.where(isNotNull(apps.activeDeploymentId));

	let restored = 0;
	for (const row of rows) {
		const app = row.app as Record<string, unknown>;
		const domain =
			row.primaryDomain ??
			`${(app.name as string) ?? "app"}.${env.BASE_DOMAIN}`;
		try {
			const buildPack = app.buildPack as string;
			if (
				buildPack === "dockerfile" ||
				(buildPack === "nixpacks" && !(app.isStatic as boolean))
			) {
				await upsertProxyRoute(
					app.id as string,
					domain,
					(app.port as number) ?? 80,
				);
			} else {
				await upsertFileRoute(
					app.id as string,
					domain,
					(app.isSpa as boolean) ?? false,
				);
			}
			restored++;
			logger.info({ appId: app.id as string, domain }, "Caddy route restored");
		} catch (err) {
			logger.warn(
				{ err, appId: app.id as string, domain },
				"Failed to restore Caddy route",
			);
		}
	}
	return restored;
}

async function reconcileStartup() {
	logger.info("Running startup reconciliation...");
	const runner = new DockerRunner();

	const managed = await runner.listManaged();
	for (const c of managed) {
		const [dep] = await db
			.select({ status: deployments.status })
			.from(deployments)
			.where(eq(deployments.id, c.deploymentId));

		if (!dep || (dep.status !== "building" && dep.status !== "pending"))
			continue;

		logger.info(
			{ deploymentId: c.deploymentId, containerId: c.containerId.slice(0, 12) },
			"Cleaning up orphaned build",
		);

		await db
			.update(deployments)
			.set({ status: "failed", finishedAt: new Date() })
			.where(eq(deployments.id, c.deploymentId));

		await db.insert(deploymentLogs).values({
			deploymentId: c.deploymentId,
			step: "system",
			content:
				"Worker restarted during build. Container cleaned up during startup recovery.",
		});

		await runner.remove(c.containerId);
	}

	const workspaceDir = env.BUILD_WORKSPACE_DIR;
	try {
		const entries = fs.readdirSync(workspaceDir);
		for (const entry of entries) {
			const fullPath = path.join(workspaceDir, entry);
			fs.rmSync(fullPath, { recursive: true, force: true });
		}
	} catch {
		// workspace dir doesn't exist yet — nothing to clean
	}

	const restored = await reconcileCaddyRoutes();
	if (restored > 0) {
		logger.info({ count: restored }, "Caddy routes reconciled");
	}

	await reconcileSitesDir();

	logger.info("Startup reconciliation complete");
}

async function reconcileSitesDir() {
	const sitesDir = env.SITES_DIR;
	let entries: string[];
	try {
		entries = fs.readdirSync(sitesDir);
	} catch {
		return; // doesn't exist yet — nothing to clean
	}

	const appRows = await db.select({ id: apps.id }).from(apps);
	const activeIds = new Set(appRows.map((r) => r.id));

	let removed = 0;
	for (const entry of entries) {
		if (activeIds.has(entry)) continue;
		const fullPath = path.join(sitesDir, entry);
		try {
			fs.rmSync(fullPath, { recursive: true, force: true });
			removed++;
		} catch (err) {
			logger.warn({ err, entry }, "Failed to remove orphaned site directory");
		}
	}

	if (removed > 0) {
		logger.info({ count: removed }, "Orphaned site directories cleaned up");
	}
}

const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

const worker = new Worker<DeploymentJob>(
	QUEUE_NAME,
	async (job) => {
		logger.info(
			{ deploymentId: job.data.deploymentId },
			"Processing deployment",
		);
		await processDeployment(job.data.deploymentId);
		logger.info({ deploymentId: job.data.deploymentId }, "Deployment complete");
	},
	{ connection, concurrency: 1 },
);

worker.on("completed", (job) => {
	logger.info({ jobId: job.id }, "Job completed");
});

worker.on("failed", (job, err) => {
	logger.error({ err, jobId: job?.id }, "Job failed");
});

async function shutdown(signal: string) {
	logger.info({ signal }, "Shutting down");
	await worker.close();
	process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

reconcileStartup()
	.then(() => {
		logger.info("Worker ready, waiting for jobs...");
	})
	.catch((err) => {
		logger.error({ err }, "Startup reconciliation failed");
	});
