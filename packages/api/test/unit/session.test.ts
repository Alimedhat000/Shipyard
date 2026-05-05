import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createSession,
	deleteSession,
	getSession,
} from "../../src/services/session.js";

vi.mock("../../src/plugins/db.js", () => ({
	db: {
		insert: vi.fn().mockReturnValue({
			values: vi.fn().mockResolvedValue(undefined),
			returning: vi.fn().mockResolvedValue([{ id: "test-session-id" }]),
		}),
		delete: vi.fn().mockReturnValue({
			where: vi.fn().mockResolvedValue(undefined),
		}),
		query: {
			sessions: {
				findFirst: vi.fn().mockResolvedValue(null),
			},
		},
	},
}));

vi.mock("../../src/plugins/redis.js", () => ({
	redis: {
		setex: vi.fn().mockResolvedValue("OK"),
		get: vi.fn().mockResolvedValue(null),
		del: vi.fn().mockResolvedValue(1),
	},
}));

vi.mock("@shipyard/shared/schema", () => ({
	sessions: {
		id: {},
		token: {},
		userId: {},
		orgId: {},
		expiresAt: {},
	},
}));

vi.mock("drizzle-orm", () => ({
	eq: vi.fn().mockImplementation((col, val) => ({ __type: "eq", col, val })),
}));

describe("session service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("createSession", () => {
		it("creates a session and returns a token", async () => {
			const token = await createSession("user-id", "org-id");

			expect(token).toBeDefined();
			expect(token).toHaveLength(64);
		});

		it("writes session to Redis with TTL", async () => {
			const { redis } = await import("../../src/plugins/redis.js");
			await createSession("user-id", "org-id");

			expect(redis.setex).toHaveBeenCalledWith(
				expect.stringContaining("session:"),
				expect.any(Number),
				expect.any(String),
			);
		});

		it("writes session to Postgres as backup", async () => {
			const { db } = await import("../../src/plugins/db.js");
			await createSession("user-id", "org-id");

			expect(db.insert).toHaveBeenCalled();
		});
	});

	describe("getSession", () => {
		it("returns null for invalid token", async () => {
			const session = await getSession("invalid-token");
			expect(session).toBeNull();
		});

		it("returns session from Redis cache hit", async () => {
			const { redis } = await import("../../src/plugins/redis.js");
			vi.mocked(redis.get).mockResolvedValueOnce(
				JSON.stringify({ userId: "user-id", orgId: "org-id" }),
			);

			const session = await getSession("cached-token");

			expect(session).toEqual({ userId: "user-id", orgId: "org-id" });
		});

		it("falls back to Postgres on Redis miss", async () => {
			const { db } = await import("../../src/plugins/db.js");
			vi.mocked(db.query.sessions.findFirst).mockResolvedValueOnce({
				userId: "user-id",
				orgId: "org-id",
				token: "test-token",
				expiresAt: new Date(Date.now() + 100000),
			});

			const session = await getSession("db-token");

			expect(session).toEqual({ userId: "user-id", orgId: "org-id" });
		});

		it("re-warms Redis after Postgres fallback", async () => {
			const { db } = await import("../../src/plugins/db.js");
			const { redis } = await import("../../src/plugins/redis.js");
			vi.mocked(db.query.sessions.findFirst).mockResolvedValueOnce({
				userId: "user-id",
				orgId: "org-id",
				token: "test-token",
				expiresAt: new Date(Date.now() + 100000),
			});

			await getSession("db-token");

			expect(redis.setex).toHaveBeenCalledWith(
				"session:db-token",
				expect.any(Number),
				JSON.stringify({ userId: "user-id", orgId: "org-id" }),
			);
		});

		it("returns null for expired session in Postgres", async () => {
			const { db } = await import("../../src/plugins/db.js");
			vi.mocked(db.query.sessions.findFirst).mockResolvedValueOnce({
				userId: "user-id",
				orgId: "org-id",
				token: "expired-token",
				expiresAt: new Date(Date.now() - 100000),
			});

			const session = await getSession("expired-token");
			expect(session).toBeNull();
		});
	});

	describe("deleteSession", () => {
		it("deletes session from Redis and Postgres", async () => {
			const { redis } = await import("../../src/plugins/redis.js");
			const { db } = await import("../../src/plugins/db.js");

			await deleteSession("token-to-delete");

			expect(redis.del).toHaveBeenCalledWith("session:token-to-delete");
			expect(db.delete).toHaveBeenCalled();
		});
	});
});
