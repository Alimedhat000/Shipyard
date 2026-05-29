import { hostname } from "node:os";
import { resolve } from "node:path";
import { config } from "dotenv";
import { z } from "zod";

config({ path: resolve(process.cwd(), "../../.env") });

const envSchema = z.object({
	DATABASE_URL: z.string().min(1),
	REDIS_URL: z.string().min(1),
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
	DOCKER_HOST: z.string().optional(),
	DOCKER_NETWORK: z.string().default("shipyard"),
	BUILD_WORKSPACE_DIR: z.string().default("/var/lib/shipyard/builds"),
	SITES_DIR: z.string().default("/var/lib/shipyard/sites"),
	WORKER_ID: z.string().default(`worker-${hostname()}`),
	ENCRYPTION_KEY: z
		.string()
		.regex(/^[0-9a-f]{64}$/i, "Must be 64 hex characters (32 bytes)"),
	CADDY_ADMIN_URL: z.string().min(1),
	BASE_DOMAIN: z.string().min(1),
	AUTO_HTTPS: z
		.string()
		.transform((v) => v === "true")
		.pipe(z.boolean()),
	LOG_TO_FILE: z
		.string()
		.default("false")
		.transform((v) => v === "true")
		.pipe(z.boolean()),
	DEPLOYMENT_KEEP_COUNT: z
		.string()
		.default("5")
		.transform((v) => parseInt(v, 10))
		.pipe(z.number().int().positive()),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
	if (cachedEnv) return cachedEnv;
	const result = envSchema.safeParse(process.env);
	if (!result.success) {
		const errors = result.error.issues
			.map((i) => `${i.path.join(".")}: ${i.message}`)
			.join(", ");
		throw new Error(`Invalid worker environment: ${errors}`);
	}
	cachedEnv = result.data;
	return cachedEnv;
}
