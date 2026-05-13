import { envVars } from "@shipyard/shared/schema";
import { encrypt } from "@shipyard/shared/utils";
import type {
	CreateEnvVarInput,
	UpdateEnvVarInput,
} from "@shipyard/shared/validators";
import { eq } from "drizzle-orm";
import { getEnv } from "../config/env.js";
import { db } from "../plugins/db.js";

const MASKED_VALUE = "*****";

const safeColumns = {
	id: envVars.id,
	appId: envVars.appId,
	key: envVars.key,
	value: envVars.value,
	isSecret: envVars.isSecret,
	createdAt: envVars.createdAt,
};

function maskValue(row: typeof envVars.$inferSelect) {
	return {
		...row,
		value: row.isSecret ? MASKED_VALUE : row.value,
	};
}

export async function listEnvVars(appId: string) {
	const rows = await db
		.select(safeColumns)
		.from(envVars)
		.where(eq(envVars.appId, appId))
		.orderBy(envVars.createdAt);
	return rows.map(maskValue);
}

export async function createEnvVar(appId: string, input: CreateEnvVarInput) {
	const env = getEnv();
	const value = input.isSecret
		? encrypt(input.value, env.ENCRYPTION_KEY)
		: input.value;

	const [row] = await db
		.insert(envVars)
		.values({
			appId,
			key: input.key,
			value,
			isSecret: input.isSecret,
		})
		.returning();

	return maskValue(row);
}

export async function getEnvVar(envVarId: string) {
	const rows = await db
		.select(safeColumns)
		.from(envVars)
		.where(eq(envVars.id, envVarId));

	const row = rows[0] ?? null;
	return row ? maskValue(row) : null;
}

export async function updateEnvVar(envVarId: string, input: UpdateEnvVarInput) {
	const env = getEnv();
	const setData: Record<string, unknown> = {};

	if (input.key !== undefined) setData.key = input.key;
	if (input.isSecret !== undefined) setData.isSecret = input.isSecret;
	if (input.value !== undefined) {
		const isSecret = input.isSecret ?? true;
		setData.value = isSecret
			? encrypt(input.value, env.ENCRYPTION_KEY)
			: input.value;
	}

	if (Object.keys(setData).length === 0) {
		return getEnvVar(envVarId);
	}

	const [row] = await db
		.update(envVars)
		.set(setData)
		.where(eq(envVars.id, envVarId))
		.returning();

	return row ? maskValue(row) : null;
}

export async function deleteEnvVar(envVarId: string) {
	const rows = await db
		.delete(envVars)
		.where(eq(envVars.id, envVarId))
		.returning({ id: envVars.id });
	return rows.length > 0;
}
