import { z } from "zod";
import { BUILD_PACKS } from "../constants";

const appFieldDefs = {
	name: z.string().min(1).max(255),
	githubRepo: z.string().min(1).max(500),
	branch: z.string(),
	buildPack: z.enum(BUILD_PACKS),
	buildCommand: z.string().optional(),
	outputDir: z.string().optional(),
	port: z.number().int().positive(),
	runCommand: z.string().optional(),
	dockerfilePath: z.string(),
	isSpa: z.boolean(),
	customNginxConfig: z.string().optional(),
	image: z.string().optional(),
} satisfies Record<string, z.ZodTypeAny>;

const baseAppSchema = z.object(appFieldDefs);

export const createAppSchema = z
	.object({
		name: appFieldDefs.name,
		githubRepo: appFieldDefs.githubRepo.optional(),
		branch: appFieldDefs.branch.default("main"),
		buildPack: appFieldDefs.buildPack,
		buildCommand: appFieldDefs.buildCommand,
		outputDir: appFieldDefs.outputDir,
		port: appFieldDefs.port.default(80),
		runCommand: appFieldDefs.runCommand,
		dockerfilePath: appFieldDefs.dockerfilePath.default("./Dockerfile"),
		isSpa: appFieldDefs.isSpa.default(true),
		customNginxConfig: appFieldDefs.customNginxConfig,
		image: appFieldDefs.image,
	})
	.superRefine((data, ctx) => {
		if (data.buildPack !== "dockerimage" && !data.githubRepo) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["githubRepo"],
				message: "GitHub repo is required for this build pack",
			});
		}
		if (
			(data.buildPack === "static" || data.buildPack === "nixpacks") &&
			!data.outputDir
		) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["outputDir"],
				message: "Output directory is required for this build pack",
			});
		}
		if (data.buildPack === "dockerimage" && !data.image) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["image"],
				message: "Image is required for Docker Image build pack",
			});
		}
	});

export const updateAppSchema = baseAppSchema.partial();

export type CreateAppInput = z.infer<typeof createAppSchema>;
export type UpdateAppInput = z.infer<typeof updateAppSchema>;
