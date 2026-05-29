import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_ORG_ID = "test-org-id";
const TEST_SITES_DIR = path.join(
	os.tmpdir(),
	"shipyard-test",
	"deployments-api",
);

vi.mock("../../src/config/env.js", () => ({
	getEnv: () => ({
		DATABASE_URL: "postgres://test:test@localhost:5432/test",
		REDIS_URL: "redis://localhost:6379",
		CADDY_ADMIN_URL: "http://localhost:2019",
		GITHUB_CLIENT_ID: "test",
		GITHUB_CLIENT_SECRET: "test",
		GITHUB_CALLBACK_URL: "http://localhost:3000/auth/github/callback",
		API_SECRET: "test-secret",
		SESSION_SECRET: "test-session-secret",
		ENCRYPTION_KEY:
			"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
		BASE_DOMAIN: "test.dev",
		AUTO_HTTPS: false,
		SESSION_TTL: "604800",
		NODE_ENV: "test",
		PORT: "3000",
		SITES_DIR: TEST_SITES_DIR,
	}),
}));

vi.mock("drizzle-orm", () => ({
	eq: vi.fn().mockImplementation((col: unknown, val: unknown) => ({
		__type: "eq",
		col,
		val,
	})),
	asc: vi.fn(),
	desc: vi.fn(),
}));

vi.mock("@shipyard/shared/schema", () => ({
	deployments: {
		id: {},
		appId: {},
		commitSha: {},
		commitMessage: {},
		branch: {},
		status: {},
		detectedFramework: {},
		outputDir: {},
		startedAt: {},
		finishedAt: {},
		prunedAt: {},
		createdAt: {},
	},
	apps: {
		id: {},
		name: {},
		organizationId: {},
		activeDeploymentId: {},
	},
	buildJobs: { id: {} },
	deploymentLogs: { id: {} },
}));

vi.mock("../../src/plugins/db.js", () => ({
	db: {
		select: vi.fn(),
		update: vi.fn(),
	},
}));

function makeSelect(result: unknown[]) {
	const where = vi.fn().mockResolvedValue(result);
	const from = vi.fn().mockReturnValue({ where });
	return { from, where };
}

describe("deployment service", () => {
	let deploymentService: typeof import("../../src/services/deployments.js");

	beforeEach(async () => {
		vi.clearAllMocks();
		fs.mkdirSync(path.join(TEST_SITES_DIR, "app-1", "dep-1"), {
			recursive: true,
		});
		fs.mkdirSync(path.join(TEST_SITES_DIR, "app-1", "dep-active"), {
			recursive: true,
		});
		fs.mkdirSync(path.join(TEST_SITES_DIR, "app-1", "dep-target"), {
			recursive: true,
		});
		deploymentService = await import("../../src/services/deployments.js");
	});

	afterEach(() => {
		fs.rmSync(TEST_SITES_DIR, { recursive: true, force: true });
	});

	describe("rollbackDeployment", () => {
		it("returns null for unknown deployment", async () => {
			const { db } = await import("../../src/plugins/db.js");
			const depSelect = makeSelect([]);
			vi.mocked(db.select).mockReturnValue({ from: depSelect.from });

			const result = await deploymentService.rollbackDeployment(
				"unknown-id",
				TEST_ORG_ID,
			);

			expect(result).toEqual({ deployment: null, app: null });
		});

		it("throws 422 when deployment status is not success", async () => {
			const { db } = await import("../../src/plugins/db.js");
			const depSelect = makeSelect([
				{
					id: "dep-1",
					appId: "app-1",
					status: "failed",
					prunedAt: null,
				},
			]);
			vi.mocked(db.select).mockReturnValue({ from: depSelect.from });

			await expect(
				deploymentService.rollbackDeployment("dep-1", TEST_ORG_ID),
			).rejects.toMatchObject({
				message: expect.stringContaining("failed"),
				statusCode: 422,
			});
		});

		it("throws 410 when deployment artifacts have been pruned", async () => {
			const { db } = await import("../../src/plugins/db.js");
			const depSelect = makeSelect([
				{
					id: "dep-1",
					appId: "app-1",
					status: "success",
					prunedAt: new Date("2025-01-01"),
				},
			]);
			vi.mocked(db.select).mockReturnValue({ from: depSelect.from });

			await expect(
				deploymentService.rollbackDeployment("dep-1", TEST_ORG_ID),
			).rejects.toMatchObject({
				message: "Cannot rollback: deployment artifacts have been pruned",
				statusCode: 410,
			});
		});

		it("returns null when app belongs to different organization", async () => {
			const { db } = await import("../../src/plugins/db.js");
			const depSelect = makeSelect([
				{
					id: "dep-1",
					appId: "app-1",
					status: "success",
					prunedAt: null,
				},
			]);
			const appSelect = makeSelect([
				{
					id: "app-1",
					organizationId: "other-org-id",
					activeDeploymentId: "dep-old",
				},
			]);
			vi.mocked(db.select)
				.mockReturnValueOnce({ from: depSelect.from })
				.mockReturnValueOnce({ from: appSelect.from });

			const result = await deploymentService.rollbackDeployment(
				"dep-1",
				TEST_ORG_ID,
			);

			expect(result).toEqual({ deployment: null, app: null });
		});

		it("throws 409 when deployment is already active", async () => {
			const { db } = await import("../../src/plugins/db.js");
			const depSelect = makeSelect([
				{
					id: "dep-active",
					appId: "app-1",
					status: "success",
					prunedAt: null,
				},
			]);
			const appSelect = makeSelect([
				{
					id: "app-1",
					organizationId: TEST_ORG_ID,
					activeDeploymentId: "dep-active",
				},
			]);
			vi.mocked(db.select)
				.mockReturnValueOnce({ from: depSelect.from })
				.mockReturnValueOnce({ from: appSelect.from });

			await expect(
				deploymentService.rollbackDeployment("dep-active", TEST_ORG_ID),
			).rejects.toMatchObject({
				message: "Deployment is already active",
				statusCode: 409,
			});
		});

		it("returns deployment and app on successful validation", async () => {
			const { db } = await import("../../src/plugins/db.js");
			const depData = {
				id: "dep-target",
				appId: "app-1",
				status: "success",
				prunedAt: null,
			};
			const appData = {
				id: "app-1",
				organizationId: TEST_ORG_ID,
				activeDeploymentId: "dep-old",
			};
			const depSelect = makeSelect([depData]);
			const appSelect = makeSelect([appData]);

			vi.mocked(db.select)
				.mockReturnValueOnce({ from: depSelect.from })
				.mockReturnValueOnce({ from: appSelect.from });

			const result = await deploymentService.rollbackDeployment(
				"dep-target",
				TEST_ORG_ID,
			);

			expect(result.deployment).toBeDefined();
			expect(result.app).toBeDefined();
			expect((result.deployment as any).id).toBe("dep-target");
			expect((result.app as any).id).toBe("app-1");
		});
	});
});
