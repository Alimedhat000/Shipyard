import fs from "node:fs";
import path from "node:path";
import { buildJobs, decrypt, deploymentLogs, envVars } from "@shipyard/shared";
import { and, eq } from "drizzle-orm";
import type { Env } from "../config/env.js";

export const TWO_GB = 2 * 1024 * 1024 * 1024;

export function createWorkspace(env: Env, deploymentId: string): string {
	const ws = path.join(env.BUILD_WORKSPACE_DIR, deploymentId);
	fs.mkdirSync(ws, { recursive: true });
	return ws;
}

export async function fetchDecryptedEnvVars(
	db: unknown,
	env: Env,
	appId: string,
) {
	// biome-ignore lint/suspicious/noExplicitAny: Drizzle query builder type too complex to abstract
	const rows = await (db as any)
		.select()
		.from(envVars)
		.where(eq(envVars.appId, appId));

	const masterKey = env.ENCRYPTION_KEY;
	const result: Record<string, string> = {};

	for (const row of rows as {
		key: string;
		value: string;
		isSecret: boolean;
	}[]) {
		const val = row.isSecret ? decrypt(row.value, masterKey) : row.value;
		result[row.key] = val;
	}

	return result;
}

export async function createBuildJobRow(
	db: unknown,
	deploymentId: string,
	stepName: string,
) {
	// biome-ignore lint/suspicious/noExplicitAny: Drizzle query builder type too complex to abstract
	await (db as any).insert(buildJobs).values({
		deploymentId,
		step: stepName,
		status: "running",
		startedAt: new Date(),
	});
}

export async function finalizeBuildJobRow(
	db: unknown,
	deploymentId: string,
	stepName: string,
	ok: boolean,
	attempts: number,
) {
	// biome-ignore lint/suspicious/noExplicitAny: Drizzle query builder type too complex to abstract
	await (db as any)
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
	db: unknown,
	deploymentId: string,
	step: string,
	content: string,
) {
	// biome-ignore lint/suspicious/noExplicitAny: Drizzle query builder type too complex to abstract
	await (db as any)
		.insert(deploymentLogs)
		.values({ deploymentId, step, content });
}
