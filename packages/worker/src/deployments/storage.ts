import fs from "node:fs";
import path from "node:path";
import { deployments } from "@shipyard/shared";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

type DB = PostgresJsDatabase<Record<string, unknown>>;

export function getDeploymentDir(
	sitesDir: string,
	appId: string,
	deploymentId: string,
): string {
	return path.join(sitesDir, appId, deploymentId);
}

export function getCurrentSymlinkPath(sitesDir: string, appId: string): string {
	return path.join(sitesDir, appId, "current");
}

export function activateDeployment(
	sitesDir: string,
	appId: string,
	deploymentId: string,
): void {
	const appDir = path.join(sitesDir, appId);
	fs.mkdirSync(appDir, { recursive: true });

	const symlinkPath = getCurrentSymlinkPath(sitesDir, appId);
	const target = path.join(appDir, deploymentId);

	if (!fs.existsSync(target)) {
		throw new Error(`Deployment directory ${target} does not exist`);
	}

	fs.rmSync(symlinkPath, { force: true, recursive: true });

	fs.symlinkSync(deploymentId, symlinkPath, "dir");
}

export async function pruneDeployments(
	db: DB,
	appId: string,
	sitesDir: string,
	keepCount: number,
): Promise<void> {
	const all = await db
		.select({ id: deployments.id })
		.from(deployments)
		.where(
			and(
				eq(deployments.appId, appId),
				eq(deployments.status, "success"),
				inArray(deployments.prunedAt, [null as unknown as Date]),
			),
		)
		.orderBy(desc(deployments.createdAt));

	if (all.length <= keepCount) return;

	const toPrune = all.slice(keepCount);

	for (const dep of toPrune) {
		const depDir = getDeploymentDir(sitesDir, appId, dep.id);
		try {
			fs.rmSync(depDir, { recursive: true, force: true });
		} catch {
			// Dir may not exist — that's fine
		}

		await db
			.update(deployments)
			.set({ prunedAt: new Date() })
			.where(eq(deployments.id, dep.id));
	}
}
