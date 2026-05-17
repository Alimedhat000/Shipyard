import { decrypt, envVars } from "@shipyard/shared";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Env } from "../config/env.js";

type DB = PostgresJsDatabase<Record<string, unknown>>;

export async function fetchDecryptedEnvVars(db: DB, env: Env, appId: string) {
	const rows = await db.select().from(envVars).where(eq(envVars.appId, appId));

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
