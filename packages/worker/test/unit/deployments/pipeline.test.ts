import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => {
	const createSpawn = () => {
		const fn = (..._args: unknown[]) => {
			const self = {
				stdout: { on: vi.fn() },
				stderr: { on: vi.fn() },
				on: vi.fn((_event: string, cb: (code: number) => void) => {
					cb(0);
					return self;
				}),
			};
			return self;
		};
		return fn;
	};
	const spawnSync = vi.fn(() => ({
		status: 0,
		stdout: Buffer.from(""),
		stderr: Buffer.from(""),
	}));
	return { spawnSync, spawn: createSpawn(), execSync: vi.fn() };
});

import type { OrchestratorDeps } from "../../../src/deployments/pipeline.js";
import { DeploymentOrchestrator } from "../../../src/deployments/pipeline.js";

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

function makeDeps(selectResults?: unknown[][], buildDir?: string) {
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
			BUILD_WORKSPACE_DIR: buildDir ?? "/tmp/shipyard-test/builds",
			BASE_DOMAIN: "bigboss.dev",
			ENCRYPTION_KEY:
				"ded637fc26820406b811e228d84a0c26dc8b561d6d7fea7ecd0d980b2544cc61",
			WORKER_ID: "worker-test",
			DOCKER_NETWORK: "shipyard",
			CADDY_ADMIN_URL: "http://caddy:2019",
			AUTO_HTTPS: false,
			LOG_TO_FILE: false,
		},
		logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		runner: mockRunner as any,
		upsertFileRoute,
		upsertProxyRoute,
	} as OrchestratorDeps;
}

describe("DeploymentOrchestrator", () => {
	describe("nixpacks static (isStatic=true)", () => {
		const BUILD_DIR = "/tmp/shipyard-test/builds";

		function makeStaticAppContext() {
			return [
				{
					deployment: { id: "deploy-nx-1" },
					app: {
						id: "app-nx-1",
						name: "myapp-nx",
						githubRepo: "user/repo",
						buildPack: "nixpacks",
						isStatic: true,
						outputDir: "dist",
						isSpa: false,
						buildTimeout: 900,
						branch: "main",
						port: 80,
					},
					githubAccessToken: "gh_token_123",
					userId: "user-1",
				},
			];
		}

		afterEach(() => {
			fs.rmSync(BUILD_DIR, { recursive: true, force: true, maxRetries: 3 });
		});

		it("routes to nixpacks static — clones repo then extracts output", async () => {
			const deps = makeDeps([makeStaticAppContext(), [], []]);
			const orchestrator = new DeploymentOrchestrator(deps);

			await orchestrator.process("deploy-nx-1");

			expect(deps.runner.runOnce).toHaveBeenCalledWith(
				expect.objectContaining({ image: "alpine/git" }),
			);
		});

		it("mark deployment as 'success' after completion", async () => {
			const deps = makeDeps([makeStaticAppContext(), [], []]);
			const orchestrator = new DeploymentOrchestrator(deps);

			await orchestrator.process("deploy-nx-1");

			const updates = (deps.db as any).update.mock.results;
			const lastSet = updates[updates.length - 1].value.set;
			expect(lastSet).toHaveBeenCalledWith(
				expect.objectContaining({ status: "success" }),
			);
		});

		it("fails on missing GitHub token — no clone", async () => {
			const ctx = [
				{
					deployment: { id: "deploy-nx-2" },
					app: {
						id: "app-nx-2",
						name: "myapp-nx",
						githubRepo: "user/repo",
						buildPack: "nixpacks",
					},
					githubAccessToken: null,
					userId: "user-2",
				},
			];
			const deps = makeDeps([ctx, [], []]);
			const orchestrator = new DeploymentOrchestrator(deps);

			await orchestrator.process("deploy-nx-2");

			expect(deps.runner.runOnce).not.toHaveBeenCalled();
		});

		it("marks deployment as failed when clone fails", async () => {
			const deps = makeDeps([makeStaticAppContext(), [], []]);
			deps.runner.runOnce = vi.fn().mockResolvedValue(128);
			const orchestrator = new DeploymentOrchestrator(deps);

			await orchestrator.process("deploy-nx-1");

			const updates = (deps.db as any).update.mock.results;
			const lastSet = updates[updates.length - 1].value.set;
			expect(lastSet).toHaveBeenCalledWith(
				expect.objectContaining({ status: "failed" }),
			);
		});
	});

	describe("nixpacks server (isStatic=false)", () => {
		const BUILD_DIR = "/tmp/shipyard-test/builds";

		function makeServerAppContext() {
			return [
				{
					deployment: { id: "deploy-nx-srv-1" },
					app: {
						id: "app-nx-srv-1",
						name: "myapp-nx-srv",
						githubRepo: "user/repo",
						buildPack: "nixpacks",
						isStatic: false,
						port: 3000,
						runCommand: "npm start",
						buildTimeout: 900,
						branch: "main",
					},
					githubAccessToken: "gh_token_123",
					userId: "user-1",
				},
			];
		}

		afterEach(() => {
			fs.rmSync(BUILD_DIR, { recursive: true, force: true, maxRetries: 3 });
		});

		it("routes to nixpacks server — clones, runs, and proxies", async () => {
			const deps = makeDeps([makeServerAppContext(), [], []]);
			const orchestrator = new DeploymentOrchestrator(deps);

			await orchestrator.process("deploy-nx-srv-1");

			expect(deps.runner.runOnce).toHaveBeenCalledWith(
				expect.objectContaining({ image: "alpine/git" }),
			);
			expect(deps.runner.stopByName).toHaveBeenCalledWith(
				"shipyard-app-app-nx-srv-1",
			);
			expect(deps.runner.runLongLived).toHaveBeenCalled();
		});
	});

	describe("dockerfile build pack", () => {
		const BUILD_DIR = "/tmp/shipyard-test/dockerfile-builds";

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

		afterEach(() => {
			fs.rmSync(BUILD_DIR, { recursive: true, force: true });
		});

		it("routes to dockerfile path when buildPack is dockerfile", async () => {
			setupRepo("deploy-df-1");
			const deps = makeDeps([makeDockerfileAppContext(), [], []], BUILD_DIR);
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
			const deps = makeDeps([makeDockerfileAppContext(), [], []], BUILD_DIR);
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
			const deps = makeDeps([makeDockerfileAppContext(), [], []], BUILD_DIR);
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
			const deps = makeDeps([makeDockerfileAppContext(), [], []], BUILD_DIR);
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
			const deps = makeDeps([ctx, [], []], BUILD_DIR);
			const orchestrator = new DeploymentOrchestrator(deps);

			await orchestrator.process("deploy-df-5");

			expect(deps.runner.runOnce).not.toHaveBeenCalled();
			expect(deps.runner.buildImage).not.toHaveBeenCalled();
			expect(deps.runner.runLongLived).not.toHaveBeenCalled();
		});

		it("cleans up workspace after successful deployment", async () => {
			const deploymentId = "deploy-df-6";
			setupRepo(deploymentId);
			const deps = makeDeps([makeDockerfileAppContext(), [], []], BUILD_DIR);
			const orchestrator = new DeploymentOrchestrator(deps);

			await orchestrator.process(deploymentId);

			expect(fs.existsSync(path.join(BUILD_DIR, deploymentId))).toBe(false);
		});
	});
});
