import { z } from "zod";
import { BUILD_PACKS } from "../constants";

export const createAppSchema = z.object({
	name: z.string().min(1).max(255),
	githubRepo: z.string().min(1).max(500),
	branch: z.string().default("main"),
	buildPack: z.enum(BUILD_PACKS),
	buildCommand: z.string().optional(),
	outputDir: z.string().optional(),
	port: z.number().int().positive().default(80),
	runCommand: z.string().optional(),
	dockerfilePath: z.string().default("./Dockerfile"),
	isSpa: z.boolean().default(true),
	customNginxConfig: z.string().optional(),
	image: z.string().optional(),
});

export const updateAppSchema = createAppSchema.partial();

export type CreateAppInput = z.infer<typeof createAppSchema>;
export type UpdateAppInput = z.infer<typeof updateAppSchema>;
