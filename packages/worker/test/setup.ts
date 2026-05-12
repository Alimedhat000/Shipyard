import { vi } from "vitest";

const testEnv = {
	DATABASE_URL: "postgres://localhost:5432/test",
	REDIS_URL: "redis://localhost:6379",
	NODE_ENV: "test",
	DOCKER_HOST: "unix:///var/run/docker.sock",
	BUILD_WORKSPACE_DIR: "/tmp/shipyard-test/builds",
	WORKER_ID: "worker-test",
	ENCRYPTION_KEY:
		"ded637fc26820406b811e228d84a0c26dc8b561d6d7fea7ecd0d980b2544cc61",
};

Object.entries(testEnv).forEach(([key, value]) => {
	process.env[key] = value;
});

vi.mock("../src/config/db.js", () => ({
	db: {
		insert: vi.fn().mockReturnValue({
			values: vi.fn().mockResolvedValue(undefined),
			returning: vi.fn().mockResolvedValue([{ id: "test-id" }]),
		}),
		update: vi.fn().mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue(undefined),
			}),
		}),
		select: vi.fn().mockReturnValue({
			from: vi.fn().mockReturnValue({
				innerJoin: vi.fn().mockReturnThis(),
				where: vi.fn().mockResolvedValue([]),
				orderBy: vi.fn().mockResolvedValue([]),
			}),
			where: vi.fn().mockResolvedValue([]),
		}),
	},
	client: {},
}));

export { testEnv };
