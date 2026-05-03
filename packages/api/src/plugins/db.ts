import * as schema from "@shipyard/shared";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "../config/env.js";

const env = getEnv();

const connectionString = env.DATABASE_URL.replace(
	"postgres://",
	"postgresql://",
);
export const client = postgres(connectionString);
export const db = drizzle(client, { schema });

export async function healthCheck() {
	await client`SELECT 1`;
	return { database: "connected" };
}
