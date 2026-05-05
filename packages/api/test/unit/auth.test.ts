import { organizations } from "@shipyard/shared/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createOrUpdateUser,
	exchangeCodeForToken,
	getGithubEmail,
	getGithubUser,
	getUserWithOrg,
} from "../../src/services/auth.js";

vi.mock("@shipyard/shared/utils", () => ({
	encrypt: vi.fn().mockReturnValue("encrypted_token"),
	decrypt: vi.fn().mockReturnValue("decrypted_token"),
}));

vi.mock("@shipyard/shared/schema", () => ({
	users: {
		id: {},
		githubId: {},
		githubUsername: {},
		githubAccessToken: {},
		email: {},
		avatarUrl: {},
	},
	organizations: {
		id: {},
		name: {},
		slug: {},
	},
	organizationMembers: {
		userId: {},
		organizationId: {},
		role: {},
	},
}));

vi.mock("drizzle-orm", () => ({
	eq: vi.fn().mockImplementation((col, val) => ({ __type: "eq", col, val })),
	and: vi.fn().mockImplementation((...args) => ({ __type: "and", args })),
}));

vi.mock("../../src/plugins/db.js", () => {
	const mockDb = {
		insert: vi.fn().mockReturnValue({
			values: vi.fn().mockReturnValue({
				onConflictDoUpdate: vi.fn().mockReturnValue({
					returning: vi.fn().mockResolvedValue([
						{
							id: "test-user-id",
							githubId: "12345",
							githubUsername: "testuser",
						},
					]),
				}),
				onConflictDoNothing: vi.fn().mockReturnValue({
					returning: vi.fn().mockResolvedValue([]),
				}),
				returning: vi.fn().mockResolvedValue([
					{
						id: "test-user-id",
						githubId: "12345",
						githubUsername: "testuser",
					},
				]),
				catch: vi.fn().mockResolvedValue(undefined),
			}),
		}),
		select: vi.fn().mockReturnValue({
			from: vi.fn().mockReturnThis(),
			where: vi.fn().mockResolvedValue([]),
			limit: vi.fn().mockResolvedValue([]),
		}),
		query: {
			users: {
				findFirst: vi.fn().mockResolvedValue(null),
			},
			organizations: {
				findFirst: vi.fn().mockResolvedValue(null),
			},
			organizationMembers: {
				findFirst: vi.fn().mockResolvedValue(null),
			},
		},
	};

	mockDb.transaction = vi.fn().mockImplementation(async (cb) => cb(mockDb));

	return { db: mockDb };
});

describe("auth service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("exchangeCodeForToken", () => {
		it("exchanges code for access token", async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({
					access_token: "gho_test_token",
					token_type: "bearer",
				}),
			});

			const token = await exchangeCodeForToken("test-code");

			expect(token).toBe("gho_test_token");
		});

		it("throws on GitHub error response", async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: false,
				json: vi.fn().mockResolvedValue({
					error: "bad_verification_code",
					error_description: "The code passed is incorrect",
				}),
			});

			await expect(exchangeCodeForToken("bad-code")).rejects.toThrow(
				"The code passed is incorrect",
			);
		});

		it("throws when no access_token in response", async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue({}),
			});

			await expect(exchangeCodeForToken("test-code")).rejects.toThrow(
				"No access_token in GitHub response",
			);
		});

		it("throws on unexpected error format", async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: false,
				status: 500,
				statusText: "Internal Server Error",
				json: vi.fn().mockResolvedValue({ weird: "response" }),
			});

			await expect(exchangeCodeForToken("test-code")).rejects.toThrow(
				"Token exchange failed: 500 Internal Server Error",
			);
		});
	});

	describe("getGithubUser", () => {
		it("fetches and returns GitHub user", async () => {
			const mockUser = {
				id: 12345,
				login: "testuser",
				name: "Test User",
				email: "test@example.com",
				avatar_url: "https://avatars.githubusercontent.com/u/12345",
			};

			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue(mockUser),
			});

			const user = await getGithubUser("test_token");

			expect(user).toEqual(mockUser);
		});

		it("throws on 401 - token revoked", async () => {
			global.fetch = vi.fn().mockResolvedValue({
				status: 401,
				json: vi.fn().mockResolvedValue({}),
			});

			await expect(getGithubUser("revoked_token")).rejects.toThrow(
				"GitHub token is invalid or revoked",
			);
		});

		it("throws on 403 - rate limited", async () => {
			global.fetch = vi.fn().mockResolvedValue({
				status: 403,
				headers: new Headers({
					"X-RateLimit-Remaining": "0",
					"X-RateLimit-Reset": "1234567890",
				}),
				json: vi.fn().mockResolvedValue({}),
			});

			await expect(getGithubUser("test_token")).rejects.toThrow(
				"GitHub API rate limited",
			);
		});

		it("throws on 403 - forbidden (not rate limited)", async () => {
			global.fetch = vi.fn().mockResolvedValue({
				status: 403,
				statusText: "Forbidden",
				headers: new Headers({ "X-RateLimit-Remaining": "500" }),
				json: vi.fn().mockResolvedValue({}),
			});

			await expect(getGithubUser("test_token")).rejects.toThrow(
				"GitHub API forbidden",
			);
		});

		it("throws on 404 - user not found", async () => {
			global.fetch = vi.fn().mockResolvedValue({
				status: 404,
				statusText: "Not Found",
				json: vi.fn().mockResolvedValue({}),
			});

			await expect(getGithubUser("test_token")).rejects.toThrow(
				"GitHub API error: 404 Not Found",
			);
		});
	});

	describe("getGithubEmail", () => {
		it("returns primary verified email", async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: vi.fn().mockResolvedValue([
					{ email: "secondary@example.com", primary: false, verified: true },
					{ email: "primary@example.com", primary: true, verified: true },
				]),
			});

			const email = await getGithubEmail("test_token");
			expect(email).toBe("primary@example.com");
		});

		it("returns null when no verified primary email", async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: vi
					.fn()
					.mockResolvedValue([
						{ email: "unverified@example.com", primary: true, verified: false },
					]),
			});

			const email = await getGithubEmail("test_token");
			expect(email).toBeNull();
		});

		it("returns null on API failure", async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: false,
			});

			const email = await getGithubEmail("test_token");
			expect(email).toBeNull();
		});
	});

	describe("createOrUpdateUser", () => {
		it("creates new user and org for first-time GitHub user", async () => {
			const { db } = await import("../../src/plugins/db.js");
			const { encrypt } = await import("@shipyard/shared/utils");

			const githubUser = {
				id: 12345,
				login: "newuser",
				email: "new@example.com",
				avatar_url: "https://avatar.url",
			};

			vi.mocked(db.query.organizations.findFirst).mockResolvedValueOnce(null);

			// Track insert calls - first call is user, second is org
			let insertCallCount = 0;
			vi.mocked(db.insert).mockImplementation((_table: unknown) => {
				insertCallCount++;
				if (insertCallCount === 1) {
					// User insert
					return {
						values: vi.fn().mockReturnValue({
							onConflictDoUpdate: vi.fn().mockReturnValue({
								returning: vi.fn().mockResolvedValue([
									{
										id: "new-user-id",
										githubId: "12345",
										githubUsername: "newuser",
										email: "new@example.com",
										avatarUrl: "https://avatar.url",
									},
								]),
							}),
							returning: vi.fn().mockResolvedValue([
								{
									id: "new-user-id",
									githubId: "12345",
									githubUsername: "newuser",
								},
							]),
						}),
					} as Record<string, unknown>;
				} else {
					// Org insert
					return {
						values: vi.fn().mockReturnValue({
							onConflictDoNothing: vi.fn().mockReturnValue({
								returning: vi.fn().mockResolvedValue([
									{
										id: "new-org-id",
										name: "newuser",
										slug: "newuser",
									},
								]),
							}),
							returning: vi.fn().mockResolvedValue([
								{
									id: "new-org-id",
									name: "newuser",
									slug: "newuser",
								},
							]),
						}),
					} as Record<string, unknown>;
				}
			});

			// Drizzle queries are thenable - they have a then() method
			// that resolves to the query result when awaited
			const createThenable = (result: unknown) => {
				const thenFn = (resolve: (v: unknown) => unknown) => resolve(result);
				const obj = {
					then: thenFn,
					limit: vi.fn().mockImplementation(() => {
						return { then: thenFn };
					}),
				};
				return obj;
			};

			const mockWhere = vi.fn().mockReturnValue(createThenable([]));
			const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
			vi.mocked(db.select).mockReturnValue({ from: mockFrom } as Record<
				string,
				unknown
			>);

			const { user, org } = await createOrUpdateUser(githubUser, "gh_token");

			expect(encrypt).toHaveBeenCalledWith("gh_token", expect.any(String));
			expect(user.githubUsername).toBe("newuser");
			expect(org.name).toBe("newuser");
		});

		it("updates existing user on conflict", async () => {
			const { db } = await import("../../src/plugins/db.js");
			const { encrypt } = await import("@shipyard/shared/utils");

			const githubUser = {
				id: 12345,
				login: "existinguser",
				email: "updated@example.com",
				avatar_url: "https://new-avatar.url",
			};

			vi.mocked(db.query.organizations.findFirst).mockReset();
			vi.mocked(db.query.organizations.findFirst).mockResolvedValueOnce({
				id: "existing-org-id",
				name: "existinguser",
				slug: "existinguser",
			});

			// Mock onConflictDoUpdate returning updated user
			vi.mocked(db.insert).mockReset();
			vi.mocked(db.insert).mockImplementation((table: unknown) => {
				if (table === organizations) {
					return {
						values: vi.fn().mockReturnValue({
							onConflictDoNothing: vi.fn().mockReturnValue({
								returning: vi.fn().mockResolvedValue([
									{
										id: "existing-org-id",
										name: "existinguser",
										slug: "existinguser",
									},
								]),
							}),
							returning: vi.fn().mockResolvedValue([
								{
									id: "existing-org-id",
									name: "existinguser",
									slug: "existinguser",
								},
							]),
						}),
					} as Record<string, unknown>;
				}
				// User insert
				return {
					values: vi.fn().mockReturnValue({
						onConflictDoUpdate: vi.fn().mockReturnValue({
							returning: vi.fn().mockResolvedValue([
								{
									id: "existing-user-id",
									githubId: "12345",
									githubUsername: "existinguser",
									email: "updated@example.com",
									avatarUrl: "https://new-avatar.url",
								},
							]),
						}),
						returning: vi.fn().mockResolvedValue([]),
					}),
				} as Record<string, unknown>;
			});

			// Mock select() calls:
			// Call 1: db.select().from(organizations) - returns existing org
			// Call 2: db.select().from(organizationMembers) - returns existing member
			let selectCallCount = 0;
			vi.mocked(db.select).mockReset();
			vi.mocked(db.select).mockImplementation(() => {
				selectCallCount++;
				if (selectCallCount === 1) {
					// Organizations query - org exists
					const result = [
						{
							id: "existing-org-id",
							name: "existinguser",
							slug: "existinguser",
						},
					];
					const thenable = {
						then: (resolve: (v: unknown) => unknown) => resolve(result),
						limit: vi.fn().mockReturnValue({
							then: (resolve: (v: unknown) => unknown) => resolve(result),
						}),
					};
					const mockWhere = vi.fn().mockReturnValue(thenable);
					return {
						from: vi.fn().mockReturnValue({ where: mockWhere }),
					} as Record<string, unknown>;
				} else {
					// OrganizationMembers query - member exists
					const existingMember = {
						userId: "existing-user-id",
						organizationId: "existing-org-id",
						role: "owner",
					};
					const result = [existingMember];
					const thenable = {
						then: (resolve: (v: unknown) => unknown) => resolve(result),
						limit: vi.fn().mockReturnValue({
							then: (resolve: (v: unknown) => unknown) => resolve(result),
						}),
					};
					const mockWhere = vi.fn().mockReturnValue(thenable);
					return {
						from: vi.fn().mockReturnValue({ where: mockWhere }),
					} as Record<string, unknown>;
				}
			});

			const { user, org } = await createOrUpdateUser(
				githubUser,
				"new_gh_token",
			);

			expect(encrypt).toHaveBeenCalledWith("new_gh_token", expect.any(String));
			expect(user.githubUsername).toBe("existinguser");
			expect(org.name).toBe("existinguser");
		});
	});

	describe("getUserWithOrg", () => {
		it("returns null when user not found", async () => {
			const { db } = await import("../../src/plugins/db.js");
			vi.mocked(db.query.users.findFirst).mockReset();
			vi.mocked(db.query.users.findFirst).mockResolvedValueOnce(null);

			const result = await getUserWithOrg("non-existent-id");

			expect(result).toBeNull();
		});

		it("returns user with org and decrypted token when found", async () => {
			const { db } = await import("../../src/plugins/db.js");
			const { decrypt } = await import("@shipyard/shared/utils");

			vi.mocked(db.query.users.findFirst).mockReset();
			vi.mocked(db.query.organizationMembers.findFirst).mockReset();
			vi.mocked(db.query.organizations.findFirst).mockReset();

			vi.mocked(db.query.users.findFirst).mockResolvedValueOnce({
				id: "user-123",
				githubId: "12345",
				githubUsername: "testuser",
				email: "test@example.com",
				avatarUrl: "https://avatar.url",
				githubAccessToken: "encrypted_token_here",
			});

			vi.mocked(db.query.organizationMembers.findFirst).mockResolvedValueOnce({
				userId: "user-123",
				organizationId: "org-456",
				role: "owner",
			});

			vi.mocked(db.query.organizations.findFirst).mockResolvedValueOnce({
				id: "org-456",
				name: "testuser",
				slug: "testuser",
			});

			vi.mocked(decrypt).mockReset();
			vi.mocked(decrypt).mockReturnValueOnce("decrypted_gh_token");

			const result = await getUserWithOrg("user-123");

			expect(result).toEqual({
				user: {
					id: "user-123",
					githubUsername: "testuser",
					email: "test@example.com",
					avatarUrl: "https://avatar.url",
				},
				organization: {
					id: "org-456",
					name: "testuser",
					role: "owner",
				},
				accessToken: "decrypted_gh_token",
			});
		});

		it("returns null when org member not found", async () => {
			const { db } = await import("../../src/plugins/db.js");

			vi.mocked(db.query.users.findFirst).mockReset();
			vi.mocked(db.query.organizationMembers.findFirst).mockReset();

			vi.mocked(db.query.users.findFirst).mockResolvedValueOnce({
				id: "user-123",
				githubUsername: "testuser",
			});

			vi.mocked(db.query.organizationMembers.findFirst).mockResolvedValueOnce(
				null,
			);

			const result = await getUserWithOrg("user-123");

			expect(result).toBeNull();
		});
	});
});
