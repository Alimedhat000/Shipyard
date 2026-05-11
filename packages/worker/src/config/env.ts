import { hostname } from "node:os";
import { resolve } from "node:path";
import { config } from "dotenv";
import { z } from "zod";

config({ path: resolve(process.cwd(), "../../.env") });

const envSchema = z.object({
	DATABASE_URL: z.string().min(1),
	REDIS_URL: z.string().min(1),
	NODE_ENV: z.enum(["development", "production"]).default("development"),
	DOCKER_HOST: z.string().optional(),
	BUILD_WORKSPACE_DIR: z.string().default("/var/lib/shipyard/builds"),
	WORKER_ID: z.string().default(`worker-${hostname()}`),
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
