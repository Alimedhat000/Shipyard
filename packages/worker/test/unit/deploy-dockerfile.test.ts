import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrchestratorDeps } from "../../src/deployments/orchestrator.js";
import { DeploymentOrchestrator } from "../../src/deployments/orchestrator.js";

const BUILD_DIR = "/tmp/shipyard-test/dockerfile-builds";

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
		buildImage: vi.fn().mockResolvedValue(undefined),
		runLongLived: vi.fn().mockResolvedValue(43210),
		stopByName: vi.fn().mockResolvedValue(undefined),
		runOnce: vi.fn().mockResolvedValue(0),
		pruneOldImageTags: vi.fn().mockResolvedValue(undefined),
	};

	const upsertFileRoute = vi.fn().mockResolvedValue(undefined);
	const upsertProxyRoute = vi.fn().mockResolvedValue(undefined);

	return {
		db: mockDb,
		env: {
			BUILD_WORKSPACE_DIR: "/tmp/shipyard-test/dockerfile-builds",
			BASE_DOMAIN: "bigboss.dev",
			ENCRYPTION_KEY:
				"ded637fc26820406b811e228d84a0c26dc8b561d6d7fea7ecd0d980b2544cc61",
			WORKER_ID: "worker-test",
			DOCKER_NETWORK: "shipyard",
			CADDY_ADMIN_URL: "http://caddy:2019",
			AUTO_HTTPS: false,
			LOG_TO_FILE: false,
			DATABASE_URL: "postgres://localhost:5432/test",
			REDIS_URL: "redis://localhost:6379",
			NODE_ENV: "test",
			SITES_DIR: "/tmp/shipyard-test/sites",
		},
		logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		runner: mockRunner as any,
		upsertFileRoute,
		upsertProxyRoute,
	} as OrchestratorDeps;
}

function makeDockerfileAppContext() {
	return [
		{
			deployment: { id: "deploy-df-1" },
			app: {
				id: "app-df-1",
				name: "myapp-dockerfile",
				githubRepo: "user/repo",
				buildTimeout: 900,
				buildPack: "dockerfile",
				port: 3000,
				dockerfilePath: "./Dockerfile",
				outputDir: null,
				isSpa: false,
				branch: "main",
			},
			githubAccessToken: "gh_token_123",
			userId: "user-1",
		},
	];
}

function setupRepo(deploymentId: string) {
	const dir = path.join(BUILD_DIR, deploymentId, "repo");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "Dockerfile"), "FROM nginx:alpine\n");
}

function cleanupBuilds() {
	fs.rmSync(BUILD_DIR, { recursive: true, force: true });
}

describe("Dockerfile build pack", () => {
	afterEach(() => {
		cleanupBuilds();
	});

	it("routes to dockerfile path when buildPack is dockerfile", async () => {
		setupRepo("deploy-df-1");
		const deps = makeDeps([makeDockerfileAppContext(), [], []]);
		const orchestrator = new DeploymentOrchestrator(deps);

		await orchestrator.process("deploy-df-1");

		expect(deps.runner.runOnce).toHaveBeenCalledTimes(1);
		expect(deps.runner.runOnce).toHaveBeenCalledWith(
			expect.objectContaining({ image: "alpine/git" }),
		);
		expect(deps.runner.buildImage).toHaveBeenCalledTimes(1);
		expect(deps.runner.stopByName).toHaveBeenCalledWith(
			"shipyard-app-app-df-1",
		);
		expect(deps.runner.runLongLived).toHaveBeenCalledTimes(1);
		expect(deps.upsertProxyRoute).toHaveBeenCalledWith(
			"app-df-1",
			"myapp-dockerfile.bigboss.dev",
			3000,
		);
		expect(deps.upsertFileRoute).not.toHaveBeenCalled();
	});

	it("stops old container before starting new one on re-deploy", async () => {
		setupRepo("deploy-df-2");
		const deps = makeDeps([makeDockerfileAppContext(), [], []]);
		deps.runner.stopByName = vi.fn().mockResolvedValue(undefined);
		const orchestrator = new DeploymentOrchestrator(deps);

		await orchestrator.process("deploy-df-2");

		expect(deps.runner.stopByName).toHaveBeenCalledWith(
			"shipyard-app-app-df-1",
		);
		expect(deps.runner.runLongLived).toHaveBeenCalledTimes(1);
	});

	it("marks deployment as failed when clone step fails", async () => {
		setupRepo("deploy-df-3");
		const deps = makeDeps([makeDockerfileAppContext(), [], []]);
		deps.runner.runOnce = vi.fn().mockResolvedValue(128);
		const orchestrator = new DeploymentOrchestrator(deps);

		await orchestrator.process("deploy-df-3");

		expect(deps.runner.buildImage).not.toHaveBeenCalled();
		expect(deps.runner.runLongLived).not.toHaveBeenCalled();
		expect(deps.upsertProxyRoute).not.toHaveBeenCalled();
		const updates = (deps.db as any).update.mock.results;
		const lastSet = updates[updates.length - 1].value.set;
		expect(lastSet).toHaveBeenCalledWith(
			expect.objectContaining({ status: "failed" }),
		);
	});

	it("marks deployment as failed when build step fails", async () => {
		setupRepo("deploy-df-4");
		const deps = makeDeps([makeDockerfileAppContext(), [], []]);
		deps.runner.buildImage = vi
			.fn()
			.mockRejectedValue(new Error("Build failed"));
		const orchestrator = new DeploymentOrchestrator(deps);

		await orchestrator.process("deploy-df-4");

		expect(deps.runner.runLongLived).not.toHaveBeenCalled();
		expect(deps.upsertProxyRoute).not.toHaveBeenCalled();
		const updates = (deps.db as any).update.mock.results;
		const lastSet = updates[updates.length - 1].value.set;
		expect(lastSet).toHaveBeenCalledWith(
			expect.objectContaining({ status: "failed" }),
		);
	});

	it("fails on missing GitHub token — no clone container created", async () => {
		const ctx = [
			{
				deployment: { id: "deploy-df-5" },
				app: {
					id: "app-df-5",
					name: "myapp-dockerfile",
					githubRepo: "user/repo",
					buildPack: "dockerfile",
				},
				githubAccessToken: null,
				userId: "user-5",
			},
		];
		const deps = makeDeps([ctx, [], []]);
		const orchestrator = new DeploymentOrchestrator(deps);

		await orchestrator.process("deploy-df-5");

		expect(deps.runner.runOnce).not.toHaveBeenCalled();
		expect(deps.runner.buildImage).not.toHaveBeenCalled();
		expect(deps.runner.runLongLived).not.toHaveBeenCalled();
	});

	it("cleans up workspace after successful deployment", async () => {
		const deploymentId = "deploy-df-6";
		setupRepo(deploymentId);
		const deps = makeDeps([makeDockerfileAppContext(), [], []]);
		const orchestrator = new DeploymentOrchestrator(deps);

		await orchestrator.process(deploymentId);

		expect(fs.existsSync(path.join(BUILD_DIR, deploymentId))).toBe(false);
	});
});
