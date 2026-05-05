import { createRequire } from "module";
import supertest from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getEnv } from "../../src/config/env.js";
import { createAuthRouter } from "../../src/routes/auth.js";

const require = createRequire(import.meta.url);
const express = require("express");
const cookieParser = require("cookie-parser");

vi.mock("../../src/plugins/redis.js", () => ({
	redis: {
		setex: vi.fn().mockResolvedValue("OK"),
		get: vi.fn().mockResolvedValue(null),
		del: vi.fn().mockResolvedValue(1),
	},
}));

vi.mock("../../src/plugins/db.js", () => ({
	db: {
		insert: vi.fn().mockReturnValue({
			values: vi.fn().mockReturnValue({
				onConflictDoUpdate: vi.fn().mockReturnValue({
					returning: vi
						.fn()
						.mockResolvedValue([
							{ id: "user-123", githubId: "12345", githubUsername: "testuser" },
						]),
				}),
				returning: vi.fn().mockResolvedValue([]),
			}),
		}),
		select: vi.fn().mockReturnValue({
			from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
		}),
		delete: vi.fn().mockReturnValue({
			where: vi.fn().mockResolvedValue(undefined),
		}),
		query: {
			users: { findFirst: vi.fn() },
			organizations: { findFirst: vi.fn() },
			organizationMembers: { findFirst: vi.fn() },
			sessions: { findFirst: vi.fn().mockResolvedValue(null) },
		},
	},
}));

vi.mock("@shipyard/shared/utils", () => ({
	encrypt: vi.fn().mockReturnValue("encrypted_token"),
	decrypt: vi.fn().mockReturnValue("decrypted_token"),
}));

vi.mock("../../src/services/auth.js", () => ({
	exchangeCodeForToken: vi.fn().mockResolvedValue("gh_token"),
	getGithubUser: vi.fn().mockResolvedValue({
		id: 12345,
		login: "testuser",
		email: "test@example.com",
		avatar_url: "https://avatar.url",
	}),
	createOrUpdateUser: vi.fn().mockResolvedValue({
		user: { id: "user-123", githubUsername: "testuser" },
		org: { id: "org-456", name: "testuser" },
	}),
	getUserWithOrg: vi.fn(),
}));

vi.mock("../../src/services/session.js", () => ({
	createSession: vi.fn().mockResolvedValue("mock-session-token"),
	getSession: vi.fn(),
	deleteSession: vi.fn().mockResolvedValue(undefined),
}));

function createTestApp() {
	const app = express();
	app.use(express.json());
	app.use(express.urlencoded({ extended: true }));
	app.use(cookieParser());
	app.use("/api/auth", createAuthRouter());
	return app;
}

describe("auth routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("POST /api/auth/github", () => {
		it("redirects to GitHub OAuth with correct parameters", async () => {
			const app = createTestApp();
			const res = await supertest(app).post("/api/auth/github").expect(302);

			const location = res.header.location;
			expect(location).toContain("https://github.com/login/oauth/authorize");
			expect(location).toContain(`client_id=${getEnv().GITHUB_CLIENT_ID}`);
			expect(location).toContain(
				`redirect_uri=${encodeURIComponent(getEnv().GITHUB_CALLBACK_URL)}`,
			);
			expect(location).toContain("scope=repo+read%3Auser");
		});
	});

	describe("GET /api/auth/me", () => {
		it("returns null when no session cookie provided", async () => {
			const app = createTestApp();
			const res = await supertest(app).get("/api/auth/me").expect(200);

			expect(res.body).toBeNull();
		});

		it("returns user and organization when valid session provided", async () => {
			const { getSession } = await import("../../src/services/session.js");
			const { getUserWithOrg } = await import("../../src/services/auth.js");

			vi.mocked(getSession).mockResolvedValueOnce({
				userId: "user-123",
				orgId: "org-456",
			});
			vi.mocked(getUserWithOrg).mockResolvedValueOnce({
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
			});

			const app = createTestApp();
			const res = await supertest(app)
				.get("/api/auth/me")
				.set("Cookie", ["session_token=valid-token"])
				.expect(200);

			expect(res.body).toEqual({
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
			});
		});

		it("returns null when session token is invalid", async () => {
			const { redis } = await import("../../src/plugins/redis.js");

			vi.mocked(redis.get).mockResolvedValueOnce(null);

			const app = createTestApp();
			const res = await supertest(app)
				.get("/api/auth/me")
				.set("Cookie", ["session_token=invalid-token"])
				.expect(200);

			expect(res.body).toBeNull();
		});
	});

	describe("POST /api/auth/logout", () => {
		it("clears session cookie and returns success", async () => {
			const app = createTestApp();
			const res = await supertest(app)
				.post("/api/auth/logout")
				.set("Cookie", ["session_token=valid-token"])
				.expect(200);

			expect(res.body).toEqual({ success: true });

			const cookies = res.header["set-cookie"];
			expect(cookies).toBeDefined();
			expect(JSON.stringify(cookies)).toContain("session_token");
			expect(JSON.stringify(cookies)).toContain("Expires=Thu, 01 Jan 1970");
		});
	});

	describe("GET /api/auth/github/callback", () => {
		it("redirects to /login when no code provided", async () => {
			const app = createTestApp();
			const res = await supertest(app)
				.get("/api/auth/github/callback")
				.expect(302);

			expect(res.header.location).toContain("/login?error=");
		});

		it("redirects to /dashboard on successful OAuth and sets session cookie", async () => {
			const { createOrUpdateUser } = await import("../../src/services/auth.js");
			const { createSession } = await import("../../src/services/session.js");

			vi.mocked(createOrUpdateUser).mockResolvedValueOnce({
				user: { id: "user-123", githubUsername: "testuser" },
				org: { id: "org-456", name: "testuser" },
			});
			vi.mocked(createSession).mockResolvedValueOnce("mock-session-token");

			const app = createTestApp();
			const res = await supertest(app)
				.get("/api/auth/github/callback")
				.query({ code: "valid_code" })
				.expect(302);

			expect(res.header.location).toBe("/dashboard");

			const cookies = res.header["set-cookie"];
			expect(cookies).toBeDefined();
			expect(JSON.stringify(cookies)).toContain("session_token");
		});

		it("redirects to /login with error when GitHub API fails", async () => {
			const { exchangeCodeForToken } = await import(
				"../../src/services/auth.js"
			);

			vi.mocked(exchangeCodeForToken).mockRejectedValueOnce(
				new Error("bad_verification_code"),
			);

			const app = createTestApp();
			const res = await supertest(app)
				.get("/api/auth/github/callback")
				.query({ code: "invalid_code" })
				.expect(302);

			expect(res.header.location).toContain("/login?error=");
		});
	});
});
