import type { App } from "@shipyard/shared/schema";
import type { DockerRunner } from "../docker/docker-runner.js";
import { classifyError } from "../errors/classify-error.js";
import type { LogBuffer } from "../logs/log-buffer.js";
import type { StepResult } from "./clone-step.js";

/**
 * Runs the app's build command inside the container.
 *
 * No retries — any non-zero exit is a user code error.
 * OOM detection happens via dockerode container inspect after exec completes.
 *
 * @param runner - DockerRunner to execute the build command
 * @param containerId - Container to build in
 * @param app - App config (buildCommand override)
 * @param log - LogBuffer for capturing build output
 * @returns StepResult — ok: true on success
 */
export async function runBuildStep(
	runner: DockerRunner,
	containerId: string,
	app: App,
	log: LogBuffer,
): Promise<StepResult> {
	const buildCmd = app.buildCommand ?? "npm run build";

	log.appendLine(`Building: ${buildCmd}`);

	const result = await runner.exec(
		containerId,
		`cd /workspace/repo && ${buildCmd}`,
		(chunk) => log.append(chunk),
	);

	if (result.exitCode === 0) {
		log.appendLine("Build completed successfully.");
		return { ok: true, attempts: 1 };
	}

	const classified = classifyError(
		result.exitCode,
		result.stderr,
		"build",
		result.oomKilled,
	);

	log.appendLine(`Build failed: ${classified.message}`);

	return {
		ok: false,
		attempts: 1,
		error: {
			category: classified.category,
			message: classified.message,
		},
	};
}
