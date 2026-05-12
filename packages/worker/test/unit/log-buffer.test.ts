import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LogBuffer } from "../../src/deployments/logs/log-buffer.js";

const TEST_DIR = "/tmp/shipyard-test/builds";

describe("LogBuffer", () => {
	beforeEach(() => {
		fs.mkdirSync(TEST_DIR, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(TEST_DIR, { recursive: true, force: true });
	});

	it("writes raw content to the step log file", async () => {
		const log = new LogBuffer("deploy-1", "clone");
		log.append("Cloning repo...");
		log.appendLine(" done.");

		await log.flushOnStepEnd();

		const filePath = path.join(TEST_DIR, "deploy-1", "logs", "clone.log");
		const content = fs.readFileSync(filePath, "utf-8");
		expect(content).toBe("Cloning repo... done.\n");
	});

	it("writes multiple lines", async () => {
		const log = new LogBuffer("deploy-2", "install");
		log.appendLine("Step started");
		log.appendLine("Downloading packages...");
		log.appendLine("Step finished");

		await log.flushOnStepEnd();

		const filePath = path.join(TEST_DIR, "deploy-2", "logs", "install.log");
		const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
		expect(lines).toHaveLength(3);
		expect(lines[0]).toBe("Step started");
	});

	it("creates the logs directory recursively", async () => {
		const log = new LogBuffer("deploy-3", "build");
		log.appendLine("building...");
		await log.flushOnStepEnd();

		const dir = path.join(TEST_DIR, "deploy-3", "logs");
		expect(fs.existsSync(dir)).toBe(true);
		expect(fs.existsSync(path.join(dir, "build.log"))).toBe(true);
	});

	it("handles multiple flushes without error", async () => {
		const log = new LogBuffer("deploy-4", "verify");
		log.appendLine("first");
		await log.flushOnStepEnd();

		// calling flush again on a closed stream should be a no-op
		await log.flushOnStepEnd();
	});
});
