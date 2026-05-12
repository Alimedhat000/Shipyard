import path from "node:path";
import type { App } from "@shipyard/shared";
import { deploymentFiles } from "@shipyard/shared";
import { db } from "../../config/db.js";
import { getEnv } from "../../config/env.js";
import type { LogBuffer } from "../logs/log-buffer.js";
import { uploadToObjectStorage } from "../storage/upload.js";
import type { StepResult } from "./clone-step.js";

export async function runUploadStep(
	deploymentId: string,
	app: App,
	userId: string,
	outputDir: string,
	log: LogBuffer,
): Promise<StepResult> {
	const bucket = getEnv().GARAGE_S3_BUCKET;
	const prefix = `users/${userId}/apps/${app.id}/deployments/${deploymentId}`;
	const localRoot = path.join(
		getEnv().BUILD_WORKSPACE_DIR,
		deploymentId,
		"repo",
		outputDir,
	);

	log.appendLine(`Uploading to s3://${bucket}/${prefix}`);

	try {
		const files = await uploadToObjectStorage(localRoot, bucket, prefix);

		if (files.length > 0) {
			await db.insert(deploymentFiles).values(
				files.map((f) => ({
					deploymentId,
					filePath: f.filePath,
					fileSize: f.fileSize,
					contentHash: f.contentHash,
				})),
			);
		}

		log.appendLine(`Uploaded ${files.length} file(s) successfully.`);
		return { ok: true, attempts: 1 };
	} catch (err) {
		const message = err instanceof Error ? err.message : "Upload failed";
		log.appendLine(`Upload failed: ${message}`);
		return {
			ok: false,
			attempts: 1,
			error: { category: "system_error", message },
		};
	}
}
