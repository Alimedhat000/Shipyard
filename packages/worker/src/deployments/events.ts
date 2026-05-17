import fs from "node:fs";
import path from "node:path";
import { buildJobs, deploymentLogs } from "@shipyard/shared";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Env } from "../config/env.js";

type DB = PostgresJsDatabase<Record<string, unknown>>;

export const TWO_GB = 2 * 1024 * 1024 * 1024;

export function createWorkspace(env: Env, deploymentId: string): string {
	const ws = path.join(env.BUILD_WORKSPACE_DIR, deploymentId);
	fs.mkdirSync(ws, { recursive: true });
	return ws;
}

export async function createBuildJobRow(
	db: DB,
	deploymentId: string,
	stepName: string,
) {
	await db.insert(buildJobs).values({
		deploymentId,
		step: stepName,
		status: "running",
		startedAt: new Date(),
	});
}

export async function finalizeBuildJobRow(
	db: DB,
	deploymentId: string,
	stepName: string,
	ok: boolean,
	attempts: number,
) {
	await db
		.update(buildJobs)
		.set({
			status: ok ? "success" : "failed",
			finishedAt: new Date(),
			attempts,
		})
		.where(
			and(
				eq(buildJobs.deploymentId, deploymentId),
				eq(buildJobs.step, stepName),
				eq(buildJobs.status, "running"),
			),
		);
}

export async function insertStructuredEvent(
	db: DB,
	deploymentId: string,
	step: string,
	content: string,
) {
	await db.insert(deploymentLogs).values({ deploymentId, step, content });
}
