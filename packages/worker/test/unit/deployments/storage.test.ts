import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	activateDeployment,
	getCurrentSymlinkPath,
	getDeploymentDir,
	pruneDeployments,
} from "../../../src/deployments/storage.js";

const TEST_SITES_DIR = "/tmp/shipyard-test/storage-test";
const APP_ID = "test-app-1";

describe("deployment storage", () => {
	beforeEach(() => {
		fs.mkdirSync(TEST_SITES_DIR, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(TEST_SITES_DIR, { recursive: true, force: true });
	});

	describe("getDeploymentDir", () => {
		it("returns correct path", () => {
			const result = getDeploymentDir(TEST_SITES_DIR, APP_ID, "deploy-1");
			expect(result).toBe(path.join(TEST_SITES_DIR, APP_ID, "deploy-1"));
		});
	});

	describe("getCurrentSymlinkPath", () => {
		it("returns correct path", () => {
			const result = getCurrentSymlinkPath(TEST_SITES_DIR, APP_ID);
			expect(result).toBe(path.join(TEST_SITES_DIR, APP_ID, "current"));
		});
	});

	describe("activateDeployment", () => {
		it("creates app directory and symlink on first deploy", () => {
			const depId = "deploy-first";
			const depDir = getDeploymentDir(TEST_SITES_DIR, APP_ID, depId);
			fs.mkdirSync(depDir, { recursive: true });
			fs.writeFileSync(path.join(depDir, "index.html"), "hello");

			activateDeployment(TEST_SITES_DIR, APP_ID, depId);

			const symlinkPath = getCurrentSymlinkPath(TEST_SITES_DIR, APP_ID);
			expect(fs.existsSync(symlinkPath)).toBe(true);
			expect(fs.readlinkSync(symlinkPath)).toBe(depId);
		});

		it("replaces existing symlink on re-deploy", () => {
			const dep1Id = "deploy-v1";
			const dep2Id = "deploy-v2";
			fs.mkdirSync(getDeploymentDir(TEST_SITES_DIR, APP_ID, dep1Id), {
				recursive: true,
			});
			fs.mkdirSync(getDeploymentDir(TEST_SITES_DIR, APP_ID, dep2Id), {
				recursive: true,
			});

			activateDeployment(TEST_SITES_DIR, APP_ID, dep1Id);
			activateDeployment(TEST_SITES_DIR, APP_ID, dep2Id);

			const symlinkPath = getCurrentSymlinkPath(TEST_SITES_DIR, APP_ID);
			expect(fs.readlinkSync(symlinkPath)).toBe(dep2Id);
		});

		it("throws when deployment directory does not exist", () => {
			expect(() =>
				activateDeployment(TEST_SITES_DIR, APP_ID, "nonexistent"),
			).toThrow("Deployment directory");
		});
	});

	describe("pruneDeployments", () => {
		it("no-ops when count is within keepCount", async () => {
			const db = {
				select: vi.fn().mockReturnValue({
					from: vi.fn().mockReturnValue({
						where: vi.fn().mockReturnValue({
							orderBy: vi
								.fn()
								.mockResolvedValue([{ id: "dep-1" }, { id: "dep-2" }]),
						}),
					}),
				}),
				update: vi.fn(),
			};

			await pruneDeployments(db as any, APP_ID, TEST_SITES_DIR, 5);

			expect(db.update).not.toHaveBeenCalled();
		});

		it("prunes excess deployments and sets prunedAt", async () => {
			// orderBy(desc(createdAt)) — newest first
			const ordered = [
				"dep-new-1",
				"dep-new-2",
				"dep-old-1",
				"dep-old-2",
				"dep-old-3",
			];
			for (const id of ordered) {
				fs.mkdirSync(getDeploymentDir(TEST_SITES_DIR, APP_ID, id), {
					recursive: true,
				});
			}

			const updateWhere = vi.fn().mockResolvedValue(undefined);
			const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
			const db = {
				select: vi.fn().mockReturnValue({
					from: vi.fn().mockReturnValue({
						where: vi.fn().mockReturnValue({
							orderBy: vi.fn().mockResolvedValue(ordered.map((id) => ({ id }))),
						}),
					}),
				}),
				update: vi.fn().mockReturnValue({ set: updateSet }),
			};

			await pruneDeployments(db as any, APP_ID, TEST_SITES_DIR, 2);

			// keepCount=2 → newest 2 survive
			expect(
				fs.existsSync(getDeploymentDir(TEST_SITES_DIR, APP_ID, "dep-new-1")),
			).toBe(true);
			expect(
				fs.existsSync(getDeploymentDir(TEST_SITES_DIR, APP_ID, "dep-new-2")),
			).toBe(true);
			// old ones pruned
			expect(
				fs.existsSync(getDeploymentDir(TEST_SITES_DIR, APP_ID, "dep-old-1")),
			).toBe(false);
			expect(
				fs.existsSync(getDeploymentDir(TEST_SITES_DIR, APP_ID, "dep-old-2")),
			).toBe(false);
			expect(
				fs.existsSync(getDeploymentDir(TEST_SITES_DIR, APP_ID, "dep-old-3")),
			).toBe(false);

			expect(db.update).toHaveBeenCalledTimes(3);
			expect(updateSet).toHaveBeenCalledWith(
				expect.objectContaining({ prunedAt: expect.any(Date) }),
			);
		});

		it("handles missing deployment directories gracefully", async () => {
			const depIds = ["dep-a", "dep-b", "dep-c"];
			// Only create dir for dep-a
			fs.mkdirSync(getDeploymentDir(TEST_SITES_DIR, APP_ID, "dep-a"), {
				recursive: true,
			});

			const updateWhere = vi.fn().mockResolvedValue(undefined);
			const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
			const db = {
				select: vi.fn().mockReturnValue({
					from: vi.fn().mockReturnValue({
						where: vi.fn().mockReturnValue({
							orderBy: vi.fn().mockResolvedValue(depIds.map((id) => ({ id }))),
						}),
					}),
				}),
				update: vi.fn().mockReturnValue({ set: updateSet }),
			};

			await expect(
				pruneDeployments(db as any, APP_ID, TEST_SITES_DIR, 1),
			).resolves.toBeUndefined();

			// Should prune 2 (dep-b and dep-c), dep-a should survive (keepCount=1 means newest survives)
			expect(db.update).toHaveBeenCalledTimes(2);
		});
	});
});
