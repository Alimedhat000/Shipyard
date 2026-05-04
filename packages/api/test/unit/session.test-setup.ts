import { vi } from "vitest";

vi.mock("../config/env.js", () => ({
	getEnv: vi.fn().mockReturnValue({
		DATABASE_URL: "postgres://localhost:5432/test",
		REDIS_URL: "redis://localhost:6379",
		GITHUB_CLIENT_ID: "test_client_id",
		GITHUB_CLIENT_SECRET: "test_client_secret",
		ENCRYPTION_KEY:
			"ded637fc26820406b811e228d84a0c26dc8b561d6d7fea7ecd0d980b2544cc61", // INFO: This is not the real key
		SESSION_TTL: "604800",
	}),
}));

vi.mock("../plugins/redis.js", () => ({
	redis: {
		setex: vi.fn().mockResolvedValue("OK"),
		get: vi.fn().mockResolvedValue(null),
		del: vi.fn().mockResolvedValue(1),
	},
}));

vi.mock("../plugins/db.js", () => ({
	db: {
		insert: vi.fn().mockReturnValue({
			values: vi.fn().mockReturnValue({
				catch: vi.fn().mockResolvedValue(undefined),
			}),
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
