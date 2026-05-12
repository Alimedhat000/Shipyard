import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverFiles } from "../../src/deployments/storage/upload.js";

const TEST_DIR = "/tmp/shipyard-test/discover";

beforeEach(() => {
	fs.mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
	fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("discoverFiles", () => {
	it("returns empty array for empty directory", () => {
		expect(discoverFiles(TEST_DIR)).toEqual([]);
	});

	it("discovers flat files", () => {
		fs.writeFileSync(path.join(TEST_DIR, "index.html"), "");
		fs.writeFileSync(path.join(TEST_DIR, "style.css"), "");
		const files = discoverFiles(TEST_DIR);
		expect(files.sort()).toEqual(["index.html", "style.css"]);
	});

	it("discovers files in subdirectories with relative paths", () => {
		fs.mkdirSync(path.join(TEST_DIR, "assets"), { recursive: true });
		fs.writeFileSync(path.join(TEST_DIR, "index.html"), "");
		fs.writeFileSync(path.join(TEST_DIR, "assets", "app.js"), "");
		fs.writeFileSync(path.join(TEST_DIR, "assets", "style.css"), "");
		const files = discoverFiles(TEST_DIR);
		expect(files.sort()).toEqual([
			"assets/app.js",
			"assets/style.css",
			"index.html",
		]);
	});

	it("sorts results alphabetically", () => {
		fs.mkdirSync(path.join(TEST_DIR, "z_dir"), { recursive: true });
		fs.mkdirSync(path.join(TEST_DIR, "a_dir"), { recursive: true });
		fs.writeFileSync(path.join(TEST_DIR, "z_dir", "file.txt"), "");
		fs.writeFileSync(path.join(TEST_DIR, "a_dir", "file.txt"), "");
		fs.writeFileSync(path.join(TEST_DIR, "m_file.txt"), "");
		const files = discoverFiles(TEST_DIR);
		expect(files).toEqual(["a_dir/file.txt", "m_file.txt", "z_dir/file.txt"]);
	});
});
