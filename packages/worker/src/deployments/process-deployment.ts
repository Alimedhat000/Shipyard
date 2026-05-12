import { db } from "../config/db.js";
import { getEnv } from "../config/env.js";
import { logger } from "../config/logger.js";
import { upsertRoute } from "./caddy/client.js";
import { DockerRunner } from "./docker/docker-runner.js";
import { DeploymentOrchestrator } from "./orchestrator.js";

export async function processDeployment(deploymentId: string): Promise<void> {
	const orchestrator = new DeploymentOrchestrator({
		db,
		env: getEnv(),
		logger,
		runner: new DockerRunner(),
		upsertRoute,
	});

	await orchestrator.process(deploymentId);
}
