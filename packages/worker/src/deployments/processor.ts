import { db } from "../config/db.js";
import { getEnv } from "../config/env.js";
import { logger } from "../config/logger.js";
import {
	upsertFileRoute,
	upsertProxyRoute,
} from "../infrastructure/caddy/client.js";
import { DockerRunner } from "../infrastructure/docker/docker-runner.js";
import { DeploymentOrchestrator } from "./pipeline.js";

export async function processDeployment(deploymentId: string): Promise<void> {
	const orchestrator = new DeploymentOrchestrator({
		db,
		env: getEnv(),
		logger,
		runner: new DockerRunner(),
		upsertFileRoute,
		upsertProxyRoute,
	});

	await orchestrator.process(deploymentId);
}
