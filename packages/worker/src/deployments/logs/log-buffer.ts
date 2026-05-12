import fs from "node:fs";
import path from "node:path";
import { getEnv } from "../../config/env.js";
import { logger } from "../../config/logger.js";

/**
 * Writes build step output to a file on the bind mount.
 *
 * Each step gets its own log file at:
 *   $BUILD_WORKSPACE_DIR/<deployment-id>/logs/<step>.log
 *
 * Structured events (started, completed, failed, OOM, etc.) are
 * written here as well so the full timeline is in one place.
 */
export class LogBuffer {
	private step: string;
	private logPath: string;
	private stream: fs.WriteStream | null = null;
	private linesWritten = 0;

	/**
	 * @param deploymentId - UUID of the deployment being built
	 * @param step - Step name (clone, install, build, verify)
	 */
	constructor(deploymentId: string, step: string) {
		this.step = step;
		const base = path.join(getEnv().BUILD_WORKSPACE_DIR, deploymentId, "logs");
		fs.mkdirSync(base, { recursive: true });
		this.logPath = path.join(base, `${step}.log`);
	}

	/**
	 * Appends raw output to the step log file.
	 * Uses a lazy-opened WriteStream for buffered writes.
	 */
	append(content: string) {
		if (!this.stream) {
			this.stream = fs.createWriteStream(this.logPath, { flags: "a" });
		}
		this.stream.write(content);
		if (content.endsWith("\n")) {
			this.linesWritten++;
		}
	}

	/** Appends a line (adds newline) to the step log file. */
	appendLine(content: string) {
		this.append(`${content}\n`);
	}

	/**
	 * Closes the write stream and logs summary. Should be called when
	 * a step finishes (success or failure) to ensure all data is flushed.
	 */
	async flushOnStepEnd() {
		await this.closeStream();
		logger.debug(
			{ step: this.step, path: this.logPath, lines: this.linesWritten },
			"Step log written",
		);
	}

	private async closeStream() {
		if (!this.stream) return;
		return new Promise<void>((resolve, reject) => {
			this.stream!.on("finish", () => {
				this.stream = null;
				resolve();
			});
			this.stream!.on("error", reject);
			this.stream!.end();
		});
	}
}
