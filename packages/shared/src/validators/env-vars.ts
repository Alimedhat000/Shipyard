import { z } from "zod";

export const envVarKeySchema = z
	.string()
	.min(1, "Key is required")
	.max(255)
	.regex(
		/^[A-Za-z_][A-Za-z0-9_]*$/,
		"Key must be alphanumeric + underscore only, starting with a letter or underscore",
	);

export const createEnvVarSchema = z.object({
	key: envVarKeySchema,
	value: z.string().min(1, "Value is required"),
	isSecret: z.boolean().default(true),
});

export const updateEnvVarSchema = z.object({
	key: envVarKeySchema.optional(),
	value: z.string().optional(),
	isSecret: z.boolean().optional(),
});

export type CreateEnvVarInput = z.infer<typeof createEnvVarSchema>;
export type UpdateEnvVarInput = z.infer<typeof updateEnvVarSchema>;
