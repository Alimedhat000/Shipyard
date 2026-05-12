import type { App } from "@shipyard/shared/schema";
import type { DockerRunner } from "../docker/docker-runner.js";
import { classifyError } from "../errors/classify-error.js";
import type { LogBuffer } from "../logs/log-buffer.js";
import { RetryExhaustedError, withRetry } from "../utils/retry.js";
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

	log.appendLine(`Installing dependencies: ${installCmd}`);

	try {
		const result = await withRetry(
			async () => {
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
					throw Object.assign(new Error(classified.message), {
						category: classified.category,
						exitCode: r.exitCode,
						stderr: r.stderr,
					});
				}
				return r;
			},
			{
				maxRetries: 3,
				shouldRetry: (err: unknown) => {
					const e = err as { category?: string };
					return e.category === "retryable";
				},
			},
		);

		log.appendLine("Dependencies installed successfully.");
		return { ok: true };
	} catch (err) {
		if (err instanceof RetryExhaustedError) {
			const cause = err.cause as { category?: string; message?: string };
			return {
				ok: false,
				error: {
					category: (cause.category as "retryable") ?? "system_error",
					message: cause.message ?? "Install failed after 3 retries.",
				},
			};
		}
		const e = err as { category?: string; message?: string };
		return {
			ok: false,
			error: {
				category: (e.category as "user_error" | "system_error") ?? "user_error",
				message: e.message ?? "Install failed.",
			},
		};
	}
}
