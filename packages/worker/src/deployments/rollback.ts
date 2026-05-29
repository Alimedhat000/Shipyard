import fs from "node:fs";
import { apps, deployments } from "@shipyard/shared";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { activateDeployment, getDeploymentDir } from "./storage.js";

type DB = PostgresJsDatabase<Record<string, unknown>>;

export async function processRollback(
	db: DB,
	sitesDir: string,
	deploymentId: string,
): Promise<void> {
	const [row] = await db
		.select({
			deploymentId: deployments.id,
			appId: deployments.appId,
			status: deployments.status,
		})
		.from(deployments)
		.where(eq(deployments.id, deploymentId));

	if (!row) throw new Error(`Deployment ${deploymentId} not found`);
	if (row.status !== "success") {
		throw new Error(`Cannot rollback: deployment has status "${row.status}"`);
	}

	const depDir = getDeploymentDir(sitesDir, row.appId, row.deploymentId);
	if (!fs.existsSync(depDir)) {
		throw new Error(
			"Cannot rollback: deployment directory does not exist on disk",
		);
	}

	activateDeployment(sitesDir, row.appId, row.deploymentId);

	await db
		.update(apps)
		.set({ activeDeploymentId: row.deploymentId, updatedAt: new Date() })
		.where(eq(apps.id, row.appId));
}
