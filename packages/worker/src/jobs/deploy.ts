import { buildJobs, deployments } from "@shipyard/shared/schema";
import { and, eq } from "drizzle-orm";
import { db } from "../config/db.js";

// TODO: This is a no-op pipeline for #16 4a. It marks steps as success
// without actually cloning, installing, or building. Real build
// logic for each step belongs in #17 4b.
const STEPS = ["clone", "install", "build", "verify"] as const;

export async function processDeployment(deploymentId: string) {
	const rows = await db
		.select()
		.from(deployments)
		.where(eq(deployments.id, deploymentId));

	if (rows.length === 0) {
		throw new Error(`Deployment ${deploymentId} not found`);
	}

	const now = new Date();

	await db
		.update(deployments)
		.set({ status: "building", startedAt: now })
		.where(eq(deployments.id, deploymentId));

	for (const step of STEPS) {
		await db.insert(buildJobs).values({
			deploymentId,
			step,
			status: "running",
			startedAt: now,
		});

		// TODO: Replace with actual step execution in 4b
		await db
			.update(buildJobs)
			.set({ status: "success", finishedAt: new Date() })
			.where(
				and(eq(buildJobs.deploymentId, deploymentId), eq(buildJobs.step, step)),
			);
	}

	await db
		.update(deployments)
		.set({ status: "success", finishedAt: new Date() })
		.where(eq(deployments.id, deploymentId));
}
