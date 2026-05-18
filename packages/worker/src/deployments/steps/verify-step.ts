import fs from "node:fs";
import path from "node:path";
import { getEnv } from "../../config/env.js";
import type { LogBuffer } from "../../infrastructure/log-buffer.js";
import type { StepResult } from "./clone-step.js";

/** Filenames to exclude from output file count. */
const DOTFILES = new Set([".gitkeep", ".DS_Store", ".git"]);

/**
 * Recursively counts non-dotfiles in a directory.
 * Returns 0 if the directory doesn't exist or can't be read.
 */
export function countFiles(dir: string): number {
	let count = 0;
	try {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (DOTFILES.has(entry.name)) continue;
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				count += countFiles(fullPath);
			} else {
				count++;
			}
		}
	} catch {
		return 0;
	}
	return count;
}

/**
 * Verifies the build output directory exists and contains files.
 *
 * Runs on the **host** filesystem via the bind mount — no docker exec needed.
 * Excludes dotfiles from the count (".gitkeep", ".DS_Store", ".git").
 * Subdirectories with files count as valid (recursive check).
 *
 * @param deploymentId - UUID for locating the workspace on the bind mount
 * @param outputDir - Relative output path (e.g. "dist", "build", "out")
 * @param log - LogBuffer for verification messages
 * @returns StepResult — ok: true if directory has at least 1 non-dotfile
 */
export async function runVerifyStep(
	deploymentId: string,
	outputDir: string,
	log: LogBuffer,
	subdirectory = "",
): Promise<StepResult> {
	const workspace = path.join(
		getEnv().BUILD_WORKSPACE_DIR,
		deploymentId,
		"repo",
	);
	const target = subdirectory
		? path.resolve(workspace, subdirectory, outputDir)
		: path.resolve(workspace, outputDir);

	log.appendLine(`Verifying output directory: ${outputDir}`);

	if (!fs.existsSync(target)) {
		const msg = `Output directory '${outputDir}' is empty or missing.`;
		log.appendLine(msg);
		return {
			ok: false,
			attempts: 1,
			error: { category: "user_error", message: msg },
		};
	}

	const fileCount = countFiles(target);

	if (fileCount === 0) {
		const msg = `Output directory '${outputDir}' is empty or missing.`;
		log.appendLine(msg);
		return {
			ok: false,
			attempts: 1,
			error: { category: "user_error", message: msg },
		};
	}

	log.appendLine(
		`Output directory '${outputDir}' verified: ${fileCount} file(s).`,
	);
	return { ok: true, attempts: 1 };
}
