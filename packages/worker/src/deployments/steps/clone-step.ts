import type { App } from "@shipyard/shared/schema";
import type { DockerRunner } from "../docker/docker-runner.js";
import { classifyError } from "../errors/classify-error.js";
import type { LogBuffer } from "../logs/log-buffer.js";
import { RetryExhaustedError, withRetry } from "../utils/retry.js";

/** Result returned by a build step — ok or classified error. */
export type StepResult = {
	ok: boolean;
	error?: {
		category: "retryable" | "user_error" | "system_error";
		message: string;
	};
};

/**
 * Clones the app's GitHub repo into the build container.
 *
 * Uses the user's GitHub OAuth token for authentication.
 * Retries up to 3 times on network errors. Auth failures (exit 128 + auth stderr)
 * fail immediately — no retry.
 *
 * @param runner - DockerRunner to execute the clone command
 * @param containerId - Container to clone into
 * @param app - App config (must have githubRepo)
 * @param token - GitHub OAuth access token
 * @param log - LogBuffer for capturing clone output
 * @returns StepResult — ok: true on success
 */
export async function runCloneStep(
	runner: DockerRunner,
	containerId: string,
	app: App,
	token: string,
	log: LogBuffer,
): Promise<StepResult> {
	const repo = app.githubRepo;
	if (!repo) {
		return {
			ok: false,
			error: {
				category: "user_error",
				message: "No GitHub repo configured for this app.",
			},
		};
	}

	const cloneUrl = `https://${token}@github.com/${repo}.git`;
	const command = `git clone --depth 1 ${cloneUrl} /workspace/repo`;

	log.appendLine(`Cloning ${repo}...`);

	try {
		const result = await withRetry(
			async () => {
				const r = await runner.exec(containerId, command, (chunk) =>
					log.append(chunk),
				);
				if (r.exitCode !== 0) {
					const classified = classifyError(
						r.exitCode,
						r.stderr,
						"clone",
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

		log.appendLine(`Cloned ${repo} successfully.`);
		return { ok: true };
	} catch (err) {
		if (err instanceof RetryExhaustedError) {
			const cause = err.cause as { category?: string; message?: string };
			return {
				ok: false,
				error: {
					category: (cause.category as "retryable") ?? "system_error",
					message: cause.message ?? "Clone failed after 3 retries.",
				},
			};
		}
		const e = err as { category?: string; message?: string };
		return {
			ok: false,
			error: {
				category: (e.category as "user_error" | "system_error") ?? "user_error",
				message: e.message ?? "Clone failed.",
			},
		};
	}
}
