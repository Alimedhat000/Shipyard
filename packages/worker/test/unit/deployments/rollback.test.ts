import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { processRollback } from "../../../src/deployments/rollback.js";

const TEST_SITES_DIR = "/tmp/shipyard-test/rollback-test";
const APP_ID = "test-app-1";

function makeDb(results: Record<string, unknown>[]) {
	const where = vi.fn().mockResolvedValue(results);
	const from = vi.fn().mockReturnValue({ where });
	return {
		select: vi.fn().mockReturnValue({ from }),
		update: vi.fn().mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue(undefined),
			}),
		}),
	};
}

describe("processRollback", () => {
	beforeEach(() => {
		fs.mkdirSync(TEST_SITES_DIR, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(TEST_SITES_DIR, { recursive: true, force: true });
	});

	it("throws when deployment is not found", async () => {
		const db = makeDb([]);

		await expect(
			processRollback(db as any, TEST_SITES_DIR, "nonexistent"),
		).rejects.toThrow("Deployment nonexistent not found");
	});

	it("throws when deployment status is not success", async () => {
		const db = makeDb([
			{
				deploymentId: "dep-1",
				appId: APP_ID,
				status: "failed",
			},
		]);

		await expect(
			processRollback(db as any, TEST_SITES_DIR, "dep-1"),
		).rejects.toThrow('Cannot rollback: deployment has status "failed"');
	});

	it("throws when deployment directory is missing", async () => {
		const db = makeDb([
			{
				deploymentId: "dep-1",
				appId: APP_ID,
				status: "success",
			},
		]);

		await expect(
			processRollback(db as any, TEST_SITES_DIR, "dep-1"),
		).rejects.toThrow(
			"Cannot rollback: deployment directory does not exist on disk",
		);
	});

	it("activates deployment and updates DB on success", async () => {
		const depDir = path.join(TEST_SITES_DIR, APP_ID, "dep-target");
		fs.mkdirSync(depDir, { recursive: true });

		const updateWhere = vi.fn().mockResolvedValue(undefined);
		const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
		const db = {
			select: vi.fn().mockReturnValue({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockResolvedValue([
						{
							deploymentId: "dep-target",
							appId: APP_ID,
							status: "success",
						},
					]),
				}),
			}),
			update: vi.fn().mockReturnValue({ set: updateSet }),
		};

		await processRollback(db as any, TEST_SITES_DIR, "dep-target");

		const symlinkPath = path.join(TEST_SITES_DIR, APP_ID, "current");
		expect(fs.readlinkSync(symlinkPath)).toBe("dep-target");

		expect(updateSet).toHaveBeenCalledWith(
			expect.objectContaining({ activeDeploymentId: "dep-target" }),
		);
		expect(updateWhere).toHaveBeenCalled();
	});
});
