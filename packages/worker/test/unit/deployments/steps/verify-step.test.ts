import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runVerifyStep } from "../../../../src/deployments/steps/verify-step.js";

const TEST_DIR = "/tmp/shipyard-test/verify-step";

function makeDir(relative: string) {
	const dir = path.join(TEST_DIR, relative);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

function makeFile(relative: string) {
	const dir = makeDir(path.dirname(relative));
	const full = path.join(dir, path.basename(relative));
	fs.writeFileSync(full, "content");
	return full;
}

describe("runVerifyStep", () => {
	beforeEach(() => {
		process.env.BUILD_WORKSPACE_DIR = TEST_DIR;
	});

	afterEach(() => {
		delete process.env.BUILD_WORKSPACE_DIR;
		fs.rmSync(TEST_DIR, { recursive: true, force: true });
	});

	it("returns ok when output directory exists with files", async () => {
		makeFile("deploy-1/repo/dist/index.html");
		const result = await runVerifyStep("deploy-1", "dist", {
			appendLine: () => {},
		} as any);
		expect(result.ok).toBe(true);
	});

	it("returns ok when output directory has subdirectories with files", async () => {
		makeFile("deploy-2/repo/dist/sub/index.html");
		const result = await runVerifyStep("deploy-2", "dist", {
			appendLine: () => {},
		} as any);
		expect(result.ok).toBe(true);
	});

	it("ignores .gitkeep and .DS_Store when counting files", async () => {
		const dist = makeDir("deploy-3/repo/dist");
		fs.writeFileSync(path.join(dist, ".gitkeep"), "");
		fs.writeFileSync(path.join(dist, ".DS_Store"), "");
		const result = await runVerifyStep("deploy-3", "dist", {
			appendLine: () => {},
		} as any);
		expect(result.ok).toBe(false);
	});

	it("returns not ok when output directory does not exist", async () => {
		const result = await runVerifyStep("deploy-4", "dist", {
			appendLine: () => {},
		} as any);
		expect(result.ok).toBe(false);
	});

	it("returns not ok when output directory is empty", async () => {
		makeDir("deploy-5/repo/dist");
		const result = await runVerifyStep("deploy-5", "dist", {
			appendLine: () => {},
		} as any);
		expect(result.ok).toBe(false);
	});

	it("returns ok with subdirectory set — output at repo/{subdir}/{outputDir}", async () => {
		makeFile("deploy-6/repo/frontend/dist/index.html");
		const result = await runVerifyStep(
			"deploy-6",
			"dist",
			{
				appendLine: () => {},
			} as any,
			"frontend",
		);
		expect(result.ok).toBe(true);
	});

	it("returns not ok when subdirectory is set but output at repo root", async () => {
		makeFile("deploy-7/repo/dist/index.html");
		const result = await runVerifyStep(
			"deploy-7",
			"dist",
			{
				appendLine: () => {},
			} as any,
			"frontend",
		);
		expect(result.ok).toBe(false);
	});

	it("works with multi-level subdirectory", async () => {
		makeFile("deploy-8/repo/packages/web/dist/index.html");
		const result = await runVerifyStep(
			"deploy-8",
			"dist",
			{
				appendLine: () => {},
			} as any,
			"packages/web",
		);
		expect(result.ok).toBe(true);
	});

	it("empty subdirectory preserves root behavior", async () => {
		makeFile("deploy-9/repo/dist/index.html");
		const result = await runVerifyStep(
			"deploy-9",
			"dist",
			{
				appendLine: () => {},
			} as any,
			"",
		);
		expect(result.ok).toBe(true);
	});

	it("returns not ok with subdirectory when output dir missing", async () => {
		makeDir("deploy-10/repo/frontend");
		const result = await runVerifyStep(
			"deploy-10",
			"dist",
			{
				appendLine: () => {},
			} as any,
			"frontend",
		);
		expect(result.ok).toBe(false);
	});
});
