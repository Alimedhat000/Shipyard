import type { DeploymentJob } from "@shipyard/shared";
import { QUEUE_NAME } from "@shipyard/shared";
import { Worker } from "bullmq";
import Redis from "ioredis";
import { getEnv } from "./config/env.js";
import { logger } from "./config/logger.js";
import { processDeployment } from "./jobs/deploy.js";

logger.info("Shipyard worker starting...");

const env = getEnv();
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

logger.info("Worker ready, waiting for jobs...");
