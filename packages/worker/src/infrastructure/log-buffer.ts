import fs from "node:fs";
import path from "node:path";
import { getEnv } from "../config/env.js";
import { logger } from "../config/logger.js";

export class LogBuffer {
	private step: string;
	private logPath: string | null = null;
	private stream: fs.WriteStream | null = null;
	private linesWritten = 0;

	constructor(deploymentId: string, step: string) {
		this.step = step;
		if (!getEnv().LOG_TO_FILE) return;
		const base = path.join(getEnv().BUILD_WORKSPACE_DIR, deploymentId, "logs");
		fs.mkdirSync(base, { recursive: true });
		this.logPath = path.join(base, `${step}.log`);
	}

	append(content: string) {
		if (!this.stream && this.logPath) {
			this.stream = fs.createWriteStream(this.logPath, { flags: "a" });
		}
		if (this.stream) {
			this.stream.write(content);
		}
		if (content.endsWith("\n")) {
			this.linesWritten++;
		}
	}

	appendLine(content: string) {
		this.append(`${content}\n`);
	}

	async flushOnStepEnd() {
		await this.closeStream();
		if (this.logPath) {
			logger.debug(
				{ step: this.step, path: this.logPath, lines: this.linesWritten },
				"Step log written",
			);
		}
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
