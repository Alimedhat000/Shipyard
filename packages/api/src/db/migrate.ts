import * as schema from "@shipyard/shared";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { logger } from "../config/logger.js";

async function main() {
	const url = process.env.DATABASE_URL;
	if (!url) {
		throw new Error("DATABASE_URL is required");
	}

	logger.info("Running database migrations...");
	const client = postgres(url, { max: 1 });
	const db = drizzle(client, { schema });

	await migrate(db, {
		migrationsFolder: new URL("../../../../drizzle", import.meta.url).pathname,
	});
	await client.end();
	logger.info("Migrations complete");
}

main().catch((err) => {
	logger.error({ err }, "Migration failed");
	process.exit(1);
});
