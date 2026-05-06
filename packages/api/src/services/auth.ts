import {
	organizationMembers,
	organizations,
	users,
} from "@shipyard/shared/schema";
import { decrypt, encrypt } from "@shipyard/shared/utils";

import {
	type GithubUser,
	githubEmailSchema,
	githubTokenErrorSchema,
	githubTokenSuccessSchema,
	githubUserSchema,
} from "@shipyard/shared/validators";
import { eq } from "drizzle-orm";
import { getEnv } from "../config/env.js";
import { logger } from "../config/logger.js";
import { db } from "../plugins/db.js";

const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";

/**
 * Exchanges an OAuth authorization code for an access token.
 * Makes a server-to-server POST to GitHub's token endpoint.
 *
 * @param code - The authorization code from GitHub callback
 * @returns The GitHub access token
 * @throws Error if code is invalid, expired, or GitHub returns an error
 *
 * @see https://docs.github.com/en/oauth/oauth-v2/access-tokens-recovery
 */
export async function exchangeCodeForToken(code: string): Promise<string> {
	const env = getEnv();

	// request the access token
	const res = await fetch(GITHUB_TOKEN_URL, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			client_id: env.GITHUB_CLIENT_ID,
			client_secret: env.GITHUB_CLIENT_SECRET,
			code,
		}),
	});

	const data = await res.json();

	// Try success shape first
	const success = githubTokenSuccessSchema.safeParse(data);
	if (success.success) {
		return success.data.access_token;
	}

	// Try error shape for better error message
	const errorParse = githubTokenErrorSchema.safeParse(data);
	if (errorParse.success) {
		const err = errorParse.data;
		throw new Error(err.error_description ?? err.error);
	}

	// Fallback for unexpected response shapes
	if (!res.ok) {
		throw new Error(`Token exchange failed: ${res.status} ${res.statusText}`);
	}

	throw new Error("No access_token in GitHub response");
}

/**
 * Fetches the authenticated user's GitHub profile.
 * Validates the access token by making an API call.
 *
 * @param accessToken - The GitHub access token
 * @returns The GitHub user profile
 * @throws Error if token is invalid/revoked, rate limited, or API error
 *
 * @see https://docs.github.com/en/rest/users/users#get-the-authenticated-user
 */
export async function getGithubUser(accessToken: string): Promise<GithubUser> {
	const res = await fetch(GITHUB_USER_URL, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"X-GitHub-Api-Version": "2022-11-28",
		},
	});

	if (res.status === 401) {
		throw new Error("GitHub token is invalid or revoked");
	}

	// handle rate limit cuz of you, you evil user ( ｡ •̀ ᴖ •́ ｡)!
	if (res.status === 403) {
		const remaining = res.headers.get("X-RateLimit-Remaining");
		if (remaining === "0") {
			const resetTime = res.headers.get("X-RateLimit-Reset");
			throw new Error(`GitHub API rate limited. Resets at ${resetTime}`);
		}
		throw new Error(`GitHub API forbidden: ${res.status} ${res.statusText}`);
	}

	if (!res.ok) {
		throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
	}

	const data = await res.json();
	const parsed = githubUserSchema.parse(data);
	return parsed;
}

/**
 * Fetches the user's verified email from GitHub.
 * Useful when user.email is null in the profile (no public email).
 *
 * @param accessToken - The GitHub access token
 * @returns The primary verified email, or null if unavailable
 *
 * @see https://docs.github.com/en/rest/users/emails#list-email-addresses-for-the-authenticated-user
 */
export async function getGithubEmail(
	accessToken: string,
): Promise<string | null> {
	const res = await fetch("https://api.github.com/user/emails", {
		headers: {
			Authorization: `Bearer ${accessToken}`,
		},
	});

	if (!res.ok) {
		return null;
	}

	const data = await res.json();
	const emails = githubEmailSchema.array().parse(data);
	const primary = emails.find((e) => e.primary && e.verified);
	return primary?.email ?? null;
}

/**
 * Creates or updates a user in the database from GitHub profile.
 * Handles implicit org creation (1:1 per user) for now.
 * TODO: add actual orgs
 *
 * @param githubUser - The GitHub user profile
 * @param accessToken - The raw (unencrypted) GitHub access token
 * @returns The created/updated user and their organization
 *
 * @example
 * const { user, org } = await createOrUpdateUser(githubUser, accessToken);
 */
export async function createOrUpdateUser(
	githubUser: GithubUser,
	accessToken: string,
): Promise<{
	user: typeof users.$inferSelect;
	org: typeof organizations.$inferSelect;
}> {
	const env = getEnv();
	const encryptedToken = encrypt(accessToken, env.ENCRYPTION_KEY);
	const email = githubUser.email ?? (await getGithubEmail(accessToken));

	return db.transaction(async (tx) => {
		const [user] = await tx
			.insert(users)
			.values({
				githubId: String(githubUser.id),
				githubUsername: githubUser.login,
				githubAccessToken: encryptedToken,
				email,
				avatarUrl: githubUser.avatar_url,
			})
			.onConflictDoUpdate({
				target: users.githubId,
				set: {
					githubUsername: githubUser.login,
					githubAccessToken: encryptedToken,
					avatarUrl: githubUser.avatar_url,
					email,
				},
			})
			.returning();

		const member = await tx.query.organizationMembers.findFirst({
			where: eq(organizationMembers.userId, user.id),
		});

		let org: typeof organizations.$inferSelect;

		if (member) {
			const found = await tx.query.organizations.findFirst({
				where: eq(organizations.id, member.organizationId),
			});
			if (!found) {
				throw new Error(
					`Organization ${member.organizationId} not found for user ${user.id}`,
				);
			}
			org = found;
		} else {
			const inserted = await tx
				.insert(organizations)
				.values({
					name: githubUser.login,
					slug: githubUser.login,
				})
				.onConflictDoNothing()
				.returning();

			if (inserted.length === 0) {
				const found = await tx.query.organizations.findFirst({
					where: eq(organizations.slug, githubUser.login),
				});
				if (!found) {
					throw new Error(
						`Organization with slug "${githubUser.login}" not found after conflict`,
					);
				}
				org = found;
			} else {
				org = inserted[0];
			}

			await tx.insert(organizationMembers).values({
				userId: user.id,
				organizationId: org.id,
				role: "owner",
			});
		}

		return { user, org };
	});
}

/**
 * Gets the current user with their organization and (optionally) GitHub token.
 *
 * @param userId - The user's UUID
 * @returns User data with org, role, and decrypted access token, or null if not found
 *
 * @example
 * const data = await getUserWithOrg(userId);
 * // { user: { id, githubUsername, ... }, organization: { id, name, role }, accessToken }
 */
export async function getUserWithOrg(userId: string) {
	const user = await db.query.users.findFirst({
		where: eq(users.id, userId),
	});

	if (!user) {
		return null;
	}

	const member = await db.query.organizationMembers.findFirst({
		where: eq(organizationMembers.userId, userId),
	});

	if (!member) {
		return null;
	}

	const org = await db.query.organizations.findFirst({
		where: eq(organizations.id, member.organizationId),
	});

	if (!org) {
		return null;
	}

	const env = getEnv();
	let accessToken: string | null = null;
	if (user.githubAccessToken) {
		try {
			accessToken = decrypt(user.githubAccessToken, env.ENCRYPTION_KEY);
		} catch (err) {
			if (err instanceof Error) {
				logger.error({ err }, "Failed to decrypt GitHub access token");
			}
		}
	}

	return {
		user: {
			id: user.id,
			githubUsername: user.githubUsername,
			email: user.email,
			avatarUrl: user.avatarUrl,
		},
		organization: {
			id: org.id,
			name: org.name,
			role: member.role,
		},
		accessToken,
	};
}
