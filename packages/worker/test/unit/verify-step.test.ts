import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { countFiles } from "../../src/deployments/steps/verify-step.js";

const TEST_DIR = "/tmp/shipyard-test/verify";

beforeEach(() => {
	fs.mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
	fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("countFiles", () => {
	it("returns 0 for a missing directory", () => {
		expect(countFiles("/tmp/shipyard-test/nonexistent")).toBe(0);
	});

	it("returns 0 for an empty directory", () => {
		expect(countFiles(TEST_DIR)).toBe(0);
	});

	it("counts files in the root", () => {
		fs.writeFileSync(path.join(TEST_DIR, "index.html"), "<html></html>");
		fs.writeFileSync(path.join(TEST_DIR, "style.css"), "body {}");
		expect(countFiles(TEST_DIR)).toBe(2);
	});

	it("excludes dotfiles like .gitkeep", () => {
		fs.writeFileSync(path.join(TEST_DIR, "index.html"), "<html></html>");
		fs.writeFileSync(path.join(TEST_DIR, ".gitkeep"), "");
		expect(countFiles(TEST_DIR)).toBe(1);
	});

	it("counts files in subdirectories recursively", () => {
		fs.mkdirSync(path.join(TEST_DIR, "assets"), { recursive: true });
		fs.writeFileSync(path.join(TEST_DIR, "index.html"), "<html></html>");
		fs.writeFileSync(
			path.join(TEST_DIR, "assets", "app.js"),
			"console.log('hi')",
		);
		fs.writeFileSync(path.join(TEST_DIR, "assets", "style.css"), "body {}");
		expect(countFiles(TEST_DIR)).toBe(3);
	});

	it("excludes .git directories recursively", () => {
		fs.mkdirSync(path.join(TEST_DIR, ".git"), { recursive: true });
		fs.writeFileSync(path.join(TEST_DIR, ".git", "HEAD"), "ref: main");
		fs.writeFileSync(path.join(TEST_DIR, "index.html"), "<html></html>");
		expect(countFiles(TEST_DIR)).toBe(1);
	});
});
