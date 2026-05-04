import { z } from "zod";

/**
 * Zod schemas for GitHub API responses
 */
export const githubTokenErrorSchema = z.object({
	error: z.string(),
	error_description: z.string().optional(),
	error_uri: z.string().optional(),
});

export const githubTokenSuccessSchema = z.object({
	access_token: z.string(),
	token_type: z.string(),
	scope: z.string().optional(),
});

export const githubUserSchema = z.object({
	id: z.number(),
	login: z.string(),
	name: z.string().nullable(),
	email: z.string().nullable(),
	avatar_url: z.string(),
});

export const githubEmailSchema = z.object({
	email: z.string(),
	primary: z.boolean(),
	verified: z.boolean(),
});

/**
 * GitHub user profile response from GET /user
 */
export type GithubUser = z.infer<typeof githubUserSchema>;
