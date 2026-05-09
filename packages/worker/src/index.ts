import type { DeploymentJob } from "@shipyard/shared";
import { QUEUE_NAME } from "@shipyard/shared";
import { Worker } from "bullmq";
import Redis from "ioredis";
import { getEnv } from "./config/env.js";
import { processDeployment } from "./jobs/deploy.js";

console.log("Shipyard worker starting...");

const env = getEnv();
const connection = new Redis(env.REDIS_URL);

const worker = new Worker<DeploymentJob>(
	QUEUE_NAME,
	async (job) => {
		console.log(`Processing deployment ${job.data.deploymentId}`);
		await processDeployment(job.data.deploymentId);
		console.log(`Deployment ${job.data.deploymentId} complete`);
	},
	{ connection },
);

worker.on("completed", (job) => {
	console.log(`Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
	console.error(`Job ${job?.id} failed:`, err);
});

async function shutdown(signal: string) {
	console.log(`Received ${signal}, shutting down...`);
	await worker.close();
	process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

console.log("Worker ready, waiting for jobs...");
