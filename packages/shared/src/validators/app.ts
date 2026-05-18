import { z } from "zod";
import { BUILD_PACKS } from "../constants";

const noShellMeta = /^[^\n\r;|&`$()<>]+$/;

const safeCommandSchema = z
	.string()
	.refine((val) => noShellMeta.test(val), "Contains unsafe shell characters");

const installCommandSchema = z
	.string()
	.refine((val) => {
		const tokens = val.trim().split(/\s+/);
		return ["npm", "pnpm", "yarn", "bun"].includes(tokens[0]);
	}, "Must start with a supported package manager (npm, pnpm, yarn, bun)")
	.refine((val) => noShellMeta.test(val), "Contains unsafe shell characters");

const appFieldDefs = {
	name: z.string().min(1).max(255),
	githubRepo: z.string().min(1).max(500),
	branch: z.string(),
	buildPack: z.enum(BUILD_PACKS),
	buildCommand: z.string().optional(),
	outputDir: z.string().optional(),
	subdirectory: z
		.string()
		.optional()
		.refine(
			(val) => !val || noShellMeta.test(val),
			"Contains unsafe shell characters",
		)
		.refine(
			(val) => !val?.split("/").includes(".."),
			"Must not contain parent directory references",
		)
		.transform((val) =>
			val?.trim() ? val.replace(/^\/+|\/+$/g, "") : undefined,
		),
	isStatic: z.boolean(),
	port: z.number().int().positive(),
	runCommand: safeCommandSchema.optional(),
	installCommand: installCommandSchema.optional(),
	dockerfilePath: z.string(),
	isSpa: z.boolean(),
	customNginxConfig: z.string().optional(),
	image: z.string().optional(),
} satisfies Record<string, z.ZodTypeAny>;

const baseAppSchema = z.object(appFieldDefs);

export const appRefinement = <
	T extends {
		buildPack?: string;
		githubRepo?: string;
		outputDir?: string;
		isStatic?: boolean;
		image?: string;
	},
>(
	data: T,
	ctx: z.RefinementCtx,
) => {
	if (data.buildPack && data.buildPack !== "dockerimage" && !data.githubRepo) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["githubRepo"],
			message: "GitHub repo is required for this build pack",
		});
	}
	if (
		data.buildPack === "nixpacks" &&
		data.isStatic !== false &&
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
};

const withDefaults = z.object({
	name: appFieldDefs.name,
	githubRepo: appFieldDefs.githubRepo.optional(),
	branch: appFieldDefs.branch.default("main"),
	buildPack: appFieldDefs.buildPack,
	buildCommand: appFieldDefs.buildCommand,
	outputDir: appFieldDefs.outputDir,
	subdirectory: appFieldDefs.subdirectory,
	isStatic: appFieldDefs.isStatic.default(true),
	port: appFieldDefs.port.default(80),
	runCommand: appFieldDefs.runCommand,
	installCommand: appFieldDefs.installCommand,
	dockerfilePath: appFieldDefs.dockerfilePath.default("./Dockerfile"),
	isSpa: appFieldDefs.isSpa.default(true),
	customNginxConfig: appFieldDefs.customNginxConfig,
	image: appFieldDefs.image,
});

export const createAppSchema = withDefaults.superRefine(appRefinement);

export const updateAppSchema = baseAppSchema
	.partial()
	.superRefine(appRefinement);

export type CreateAppInput = z.infer<typeof createAppSchema>;
export type UpdateAppInput = z.infer<typeof updateAppSchema>;
