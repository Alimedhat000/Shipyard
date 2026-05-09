import { type DeploymentJob, QUEUE_NAME } from "@shipyard/shared";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { getEnv } from "../config/env";

const connection = new Redis(getEnv().REDIS_URL, {
	maxRetriesPerRequest: null,
});
export const myQueue = new Queue<DeploymentJob>(QUEUE_NAME, {
	connection,
	defaultJobOptions: {
		attempts: 3,
		backoff: { type: "exponential", delay: 2000 },
	},
});
