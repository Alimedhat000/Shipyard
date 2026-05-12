import fs from "node:fs/promises";
import path from "node:path";
import type { StepResult } from "./clone-step.js";

const SITES_DIR = process.env.SITES_DIR ?? "/var/lib/shipyard/sites";

export async function runCopyStep(
	_deploymentId: string,
	appId: string,
	outputDir: string,
): Promise<StepResult> {
	const sitesPath = path.join(SITES_DIR, appId);

	try {
		await fs.mkdir(sitesPath, { recursive: true });

		await fs.cp(outputDir, sitesPath, {
			recursive: true,
			force: true,
		});

		return { ok: true, attempts: 1 };
	} catch (err) {
		const msg = err instanceof Error ? err.message : "Unknown error";
		return {
			ok: false,
			attempts: 1,
			error: { category: "system_error", message: msg },
		};
	}
}
