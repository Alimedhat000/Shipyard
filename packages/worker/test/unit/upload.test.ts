import fs from "node:fs";
import path from "node:path";

process.env.SITES_DIR = "/tmp/shipyard-test/sites";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCopyStep } from "../../src/deployments/steps/copy-step.js";

const TEST_SITES_DIR = process.env.SITES_DIR;
const TEST_OUTPUT_DIR = "/tmp/shipyard-test/output";

describe.skip("runCopyStep", () => {
	const appId = "test-app-123";

	beforeEach(() => {
		fs.mkdirSync(TEST_SITES_DIR!, { recursive: true });
		fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(TEST_SITES_DIR!, { recursive: true, force: true });
		fs.rmSync(TEST_OUTPUT_DIR, { recursive: true, force: true });
	});

	it("copies files to sites directory", async () => {
		fs.writeFileSync(path.join(TEST_OUTPUT_DIR, "index.html"), "<h1>Test</h1>");
		fs.writeFileSync(
			path.join(TEST_OUTPUT_DIR, "style.css"),
			"body { margin: 0 }",
		);

		const result = await runCopyStep("deploy-123", appId, TEST_OUTPUT_DIR);

		expect(result.ok).toBe(true);
		expect(result.attempts).toBe(1);

		const sitesPath = path.join(TEST_SITES_DIR!, appId);
		expect(fs.existsSync(path.join(sitesPath, "index.html"))).toBe(true);
		expect(fs.existsSync(path.join(sitesPath, "style.css"))).toBe(true);
	});

	it("handles nested directories", async () => {
		fs.mkdirSync(path.join(TEST_OUTPUT_DIR, "assets", "images"), {
			recursive: true,
		});
		fs.writeFileSync(path.join(TEST_OUTPUT_DIR, "index.html"), "");
		fs.writeFileSync(path.join(TEST_OUTPUT_DIR, "assets", "app.js"), "");
		fs.writeFileSync(
			path.join(TEST_OUTPUT_DIR, "assets", "images", "logo.png"),
			"",
		);

		const result = await runCopyStep("deploy-123", appId, TEST_OUTPUT_DIR);

		expect(result.ok).toBe(true);

		const sitesPath = path.join(TEST_SITES_DIR!, appId);
		expect(fs.existsSync(path.join(sitesPath, "index.html"))).toBe(true);
		expect(fs.existsSync(path.join(sitesPath, "assets", "app.js"))).toBe(true);
		expect(
			fs.existsSync(path.join(sitesPath, "assets", "images", "logo.png")),
		).toBe(true);
	});
});
