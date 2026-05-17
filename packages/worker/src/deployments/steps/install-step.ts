import { StepError } from "@shipyard/shared";
import type { App } from "@shipyard/shared/schema";
import type { DockerRunner } from "../../infrastructure/docker/docker-runner.js";
import type { LogBuffer } from "../../infrastructure/log-buffer.js";
import { RetryExhaustedError, withRetry } from "../../infrastructure/retry.js";
import { classifyError } from "../errors/classify-error.js";
import type { StepResult } from "./clone-step.js";

/**
 * Probes the cloned repo for lockfiles to determine which package manager to use.
 * Priority: pnpm-lock.yaml → yarn.lock → package-lock.json → null
 */
async function detectLockfile(
	runner: DockerRunner,
	containerId: string,
): Promise<string | null> {
	const candidates = [
		{ file: "pnpm-lock.yaml", cmd: "pnpm install" },
		{ file: "yarn.lock", cmd: "yarn install" },
		{ file: "package-lock.json", cmd: "npm install" },
	];

	for (const c of candidates) {
		const result = await runner.exec(
			containerId,
			`test -f /workspace/repo/${c.file} && echo "found" || echo "not_found"`,
		);
		if (result.stdout.trim() === "found") return c.cmd;
	}

	return null;
}

/**
 * Installs dependencies for the app.
 *
 * Auto-detects lockfile to pick the right package manager (pnpm → yarn → npm).
 * Falls back to app.installCommand or "npm install".
 * Retries up to 3 times on network errors.
 *
 * @param runner - DockerRunner to execute the install command
 * @param containerId - Container to install in
 * @param app - App config (optional installCommand override)
 * @param log - LogBuffer for capturing install output
 * @returns StepResult — ok: true on success
 */
export async function runInstallStep(
	runner: DockerRunner,
	containerId: string,
	app: App,
	log: LogBuffer,
): Promise<StepResult> {
	const lockfileCmd = await detectLockfile(runner, containerId);
	const installCmd = lockfileCmd ?? app.installCommand ?? "npm install";

	let attempts = 0;

	log.appendLine(`Installing dependencies: ${installCmd}`);

	try {
		const _result = await withRetry(
			async () => {
				attempts++;
				const r = await runner.exec(
					containerId,
					`cd /workspace/repo && ${installCmd}`,
					(chunk) => log.append(chunk),
				);
				if (r.exitCode !== 0) {
					const classified = classifyError(
						r.exitCode,
						r.stderr,
						"install",
						r.oomKilled,
					);
					throw new StepError(
						classified.category,
						classified.message,
						r.exitCode,
						r.stderr,
					);
				}
				return r;
			},
			{
				maxRetries: 3,
				shouldRetry: (err: unknown) => {
					return err instanceof StepError && err.category === "retryable";
				},
				onRetry: (attempt, delay) => {
					log.appendLine(`Retry ${attempt}/3 in ${delay}ms...`);
				},
			},
		);

		log.appendLine("Dependencies installed successfully.");
		return { ok: true, attempts };
	} catch (err) {
		if (err instanceof RetryExhaustedError) {
			const cause =
				err.cause instanceof StepError
					? err.cause
					: new StepError("system_error", "Install failed after 3 retries.");
			return {
				ok: false,
				attempts,
				error: { category: cause.category, message: cause.message },
			};
		}
		const stepErr =
			err instanceof StepError
				? err
				: new StepError(
						"user_error",
						err instanceof Error ? err.message : "Install failed.",
					);
		return {
			ok: false,
			attempts,
			error: { category: stepErr.category, message: stepErr.message },
		};
	}
}
