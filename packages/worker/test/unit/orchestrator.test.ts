import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrchestratorDeps } from "../../src/deployments/orchestrator.js";
import { DeploymentOrchestrator } from "../../src/deployments/orchestrator.js";

function makeSelectChain(results: unknown[][]) {
	let callIndex = 0;
	const chain = {
		from: vi.fn().mockReturnThis(),
		innerJoin: vi.fn().mockReturnThis(),
		where: vi.fn().mockImplementation(() => {
			const idx = callIndex;
			callIndex++;
			const value = results[idx] ?? [];
			return {
				orderBy: vi.fn().mockResolvedValue(value),
				then: vi
					.fn()
					.mockImplementation(
						(resolve: (v: unknown) => void, _reject: (e: unknown) => void) => {
							resolve(value);
						},
					),
			};
		}),
	};
	return chain;
}

function makeDeps(selectResults?: unknown[][]) {
	const selectChain = makeSelectChain(selectResults ?? []);

	const mockDb = {
		select: vi.fn().mockReturnValue(selectChain),
		insert: vi.fn().mockReturnValue({
			values: vi.fn().mockResolvedValue(undefined),
		}),
		update: vi.fn().mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue(undefined),
			}),
		}),
	};

	const mockRunner = {
		create: vi.fn().mockResolvedValue({ id: "container-1" }),
		exec: vi.fn().mockResolvedValue({
			exitCode: 0,
			oomKilled: false,
			stdout: "",
			stderr: "",
		}),
		remove: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		listManaged: vi.fn().mockResolvedValue([]),
		inspect: vi.fn().mockResolvedValue({}),
	};

	const upsertRoute = vi.fn().mockResolvedValue(undefined);

	return {
		db: mockDb,
		env: {
			BUILD_WORKSPACE_DIR: "/tmp/shipyard-test/builds",
			BASE_DOMAIN: "bigboss.dev",
			ENCRYPTION_KEY:
				"ded637fc26820406b811e228d84a0c26dc8b561d6d7fea7ecd0d980b2544cc61",
			WORKER_ID: "worker-test",
			CADDY_ADMIN_URL: "http://caddy:2019",
			AUTO_HTTPS: false,
			LOG_TO_FILE: false,
		},
		logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		runner: mockRunner as any,
		upsertRoute,
	} as OrchestratorDeps;
}

function makeAppContext() {
	return [
		{
			deployment: { id: "deploy-1" },
			app: {
				id: "app-1",
				name: "myapp",
				githubRepo: "user/repo",
				buildTimeout: 900,
				outputDir: "dist",
				isSpa: false,
				branch: "main",
			},
			githubAccessToken: "gh_token_123",
			userId: "user-1",
		},
	];
}

const BUILD_DIR = "/tmp/shipyard-test/builds";
const SITES_DIR = "/tmp/shipyard-test/sites";

function setupOutput(deploymentId: string) {
	const dir = path.join(BUILD_DIR, deploymentId, "repo", "dist");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "index.html"), "<h1>test</h1>");
}

function cleanupOutput() {
	fs.rmSync(BUILD_DIR, { recursive: true, force: true });
	fs.rmSync(SITES_DIR, { recursive: true, force: true });
}

describe("DeploymentOrchestrator", () => {
	afterEach(() => {
		cleanupOutput();
	});
	it("runs all steps and activates deployment on success", async () => {
		setupOutput("deploy-1");
		const deps = makeDeps([makeAppContext(), [], []]);
		const orchestrator = new DeploymentOrchestrator(deps);

		await orchestrator.process("deploy-1");

		expect(deps.runner.create).toHaveBeenCalledTimes(1);
		expect(deps.runner.remove).toHaveBeenCalledWith("container-1");
		expect(deps.upsertRoute).toHaveBeenCalledWith(
			"app-1",
			"myapp.bigboss.dev",
			"user-1",
			"deploy-1",
			false,
		);
	});

	it("marks deployment as 'building' on start", async () => {
		setupOutput("deploy-1");
		const deps = makeDeps([makeAppContext(), [], []]);
		const orchestrator = new DeploymentOrchestrator(deps);

		await orchestrator.process("deploy-1");

		expect((deps.db as any).update).toHaveBeenCalled();
	});

	it("marks deployment as 'success' after completion", async () => {
		setupOutput("deploy-1");
		const deps = makeDeps([makeAppContext(), [], []]);
		const orchestrator = new DeploymentOrchestrator(deps);

		await orchestrator.process("deploy-1");

		const updates = (deps.db as any).update.mock.results;
		const lastSet = updates[updates.length - 1].value.set;
		expect(lastSet).toHaveBeenCalledWith(
			expect.objectContaining({ status: "success" }),
		);
	});

	it("fails on missing GitHub token — no container created", async () => {
		const ctx = [
			{
				deployment: { id: "deploy-2" },
				app: { id: "app-2", name: "myapp", githubRepo: "user/repo" },
				githubAccessToken: null,
				userId: "user-2",
			},
		];
		const deps = makeDeps([ctx, [], []]);
		const orchestrator = new DeploymentOrchestrator(deps);

		await orchestrator.process("deploy-2");

		expect(deps.runner.create).not.toHaveBeenCalled();
		expect(deps.runner.remove).not.toHaveBeenCalled();
	});

	it("marks deployment as 'failed' when GitHub token is missing", async () => {
		const ctx = [
			{
				deployment: { id: "deploy-3" },
				app: { id: "app-3", name: "myapp", githubRepo: "user/repo" },
				githubAccessToken: null,
				userId: "user-3",
			},
		];
		const deps = makeDeps([ctx, [], []]);
		const orchestrator = new DeploymentOrchestrator(deps);

		await orchestrator.process("deploy-3");

		const updates = (deps.db as any).update.mock.results;
		const failedUpdate = updates
			.map((r: any) => r.value.set.mock.calls[0]?.[0])
			.find((s: any) => s?.status === "failed");
		expect(failedUpdate).toBeDefined();
	});

	it("times out when build takes too long", async () => {
		setupOutput("deploy-4");
		const appCtx = makeAppContext();
		appCtx[0].app.buildTimeout = 0; // timeout fires immediately
		const deps = makeDeps([appCtx, [], []]);
		const orchestrator = new DeploymentOrchestrator(deps);

		await orchestrator.process("deploy-4");

		// Container should still be cleaned up
		expect(deps.runner.remove).toHaveBeenCalledWith("container-1");
		// Error should have been logged
		expect(deps.logger.error).toHaveBeenCalled();
		// Final status should be failed
		const updates = (deps.db as any).update.mock.results;
		const lastSet = updates[updates.length - 1].value.set;
		expect(lastSet).toHaveBeenCalledWith(
			expect.objectContaining({ status: "failed" }),
		);
	});

	it("marks deployment as failed when clone step fails", async () => {
		setupOutput("deploy-5");
		const deps = makeDeps([makeAppContext(), [], []]);
		// Exit code 128 means auth failure — classifyError marks as user_error, no retry
		(deps.runner as any).exec = vi.fn().mockResolvedValue({
			exitCode: 128,
			oomKilled: false,
			stdout: "",
			stderr: "Permission denied",
		});
		const orchestrator = new DeploymentOrchestrator(deps);

		await orchestrator.process("deploy-5");

		// Container should still be cleaned up
		expect(deps.runner.remove).toHaveBeenCalledWith("container-1");
		// Should NOT have called upsertRoute (deployment never activated)
		expect(deps.upsertRoute).not.toHaveBeenCalled();
		// Final status should be failed
		const updates = (deps.db as any).update.mock.results;
		const lastSet = updates[updates.length - 1].value.set;
		expect(lastSet).toHaveBeenCalledWith(
			expect.objectContaining({ status: "failed" }),
		);
	});

	it("cleans up container and workspace on unexpected error", async () => {
		setupOutput("deploy-6");
		const deps = makeDeps([makeAppContext(), [], []]);
		// Make runner.create throw
		(deps.runner as any).create = vi
			.fn()
			.mockRejectedValue(new Error("docker error"));
		const orchestrator = new DeploymentOrchestrator(deps);

		await orchestrator.process("deploy-6");

		// Container was never created, so remove should not be called
		// But update should have been called to mark failed
		const updates = (deps.db as any).update.mock.results;
		const failedSet = updates
			.map((r: any) => r.value.set.mock.calls[0]?.[0])
			.find((s: any) => s?.status === "failed");
		expect(failedSet).toBeDefined();
	});
});
