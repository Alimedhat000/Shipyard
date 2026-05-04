import { z } from "zod";

export const envSchema = z.object({
	DATABASE_URL: z.string().min(1),
	REDIS_URL: z.string().min(1),
	GARAGE_S3_ENDPOINT: z.string().min(1),
	GARAGE_S3_ACCESS_KEY: z.string().min(1),
	GARAGE_S3_SECRET_KEY: z.string().min(1),
	GARAGE_S3_BUCKET: z.string().min(1),
	CADDY_ADMIN_URL: z.string().min(1),
	GITHUB_CLIENT_ID: z.string().min(1),
	GITHUB_CLIENT_SECRET: z.string().min(1),
	GITHUB_CALLBACK_URL: z.string().min(1),
	API_SECRET: z.string().min(1),
	SESSION_SECRET: z.string().min(1),
	ENCRYPTION_KEY: z.string().min(32), // used for the AES-256-GCM algorithm
	SESSION_TTL: z.string().default("604800"), // 7 days in seconds
	NODE_ENV: z.string().default("development"),
	PORT: z.string().default("3000"),
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
		throw new Error(`Invalid environment: ${errors}`);
	}

	cachedEnv = result.data;
	return cachedEnv;
}
