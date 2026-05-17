import { decrypt, envVars } from "@shipyard/shared";
import { eq } from "drizzle-orm";
import type { Env } from "../config/env.js";

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
