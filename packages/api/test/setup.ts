import { vi } from "vitest";

const testEnv = {
	DATABASE_URL: "postgres://localhost:5432/test",
	REDIS_URL: "redis://localhost:6379",
	GARAGE_S3_ENDPOINT: "http://localhost:39080",
	GARAGE_S3_ACCESS_KEY: "test",
	GARAGE_S3_SECRET_KEY: "test",
	GARAGE_S3_BUCKET: "test",
	CADDY_ADMIN_URL: "http://localhost:2019",
	GITHUB_CLIENT_ID: "test_client_id",
	GITHUB_CLIENT_SECRET: "test_client_secret",
	GITHUB_CALLBACK_URL: "http://localhost:3000/api/auth/github/callback",
	API_SECRET: "test_api_secret",
	SESSION_SECRET: "test_session_secret",
	ENCRYPTION_KEY:
		"ded637fc26820406b811e228d84a0c26dc8b561d6d7fea7ecd0d980b2544cc61",
	SESSION_TTL: "604800",
	BASE_DOMAIN: "bigboss.dev",
	AUTO_HTTPS: "false",
	NODE_ENV: "test",
	FRONTEND_URL: "http://localhost:5173",
};

Object.entries(testEnv).forEach(([key, value]) => {
	process.env[key] = value;
});

vi.mock("ioredis", () => {
	const RedisMock = vi.fn().mockImplementation(() => ({
		setex: vi.fn().mockResolvedValue("OK"),
		get: vi.fn().mockResolvedValue(null),
		del: vi.fn().mockResolvedValue(1),
		connect: vi.fn().mockResolvedValue(undefined),
		ping: vi.fn().mockResolvedValue("PONG"),
		lazyConnect: false,
		on: vi.fn(),
	}));
	return { default: RedisMock };
});

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
	client: {},
}));

export { testEnv };
