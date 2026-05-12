import fs from "node:fs";
import path from "node:path";
import type { DeploymentJob } from "@shipyard/shared";
import { deploymentLogs, deployments, QUEUE_NAME } from "@shipyard/shared";
import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import Redis from "ioredis";
import { db } from "./config/db.js";
import { getEnv } from "./config/env.js";
import { logger } from "./config/logger.js";
import { DockerRunner } from "./deployments/docker/docker-runner.js";
import { processDeployment } from "./jobs/deploy.js";

logger.info("Shipyard worker starting...");

const env = getEnv();

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

	logger.info("Startup reconciliation complete");
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
	{ connection },
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
