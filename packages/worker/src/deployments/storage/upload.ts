import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client } from "./s3-client.js";

export type UploadedFile = {
	filePath: string;
	fileSize: number;
	contentHash: string;
};

/**
 * Recursively uploads all files from a local directory to S3-compatible storage.
 *
 * Each file is uploaded under:
 *   {prefix}/{relativePath}
 *
 * Bounded concurrency via the concurrency option (default 10).
 *
 * Returns metadata for each uploaded file suitable for insertion into
 * the deployment_files table.
 */
export async function uploadToObjectStorage(
	localRoot: string,
	bucket: string,
	prefix: string,
	concurrency = 10,
): Promise<UploadedFile[]> {
	const files = discoverFiles(localRoot);

	const results: UploadedFile[] = [];
	const queue = [...files];

	async function worker() {
		while (queue.length > 0) {
			const relativePath = queue.shift()!;
			const fullPath = path.join(localRoot, relativePath);
			const result = await uploadFile(
				fullPath,
				bucket,
				`${prefix}/${relativePath}`,
			);
			results.push(result);
		}
	}

	const workers = Array.from(
		{ length: Math.min(concurrency, files.length) },
		worker,
	);
	await Promise.all(workers);

	return results;
}

export function discoverFiles(root: string): string[] {
	const files: string[] = [];
	function walk(dir: string) {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else {
				files.push(path.relative(root, full));
			}
		}
	}
	walk(root);
	return files.sort();
}

async function uploadFile(
	localPath: string,
	bucket: string,
	key: string,
): Promise<UploadedFile> {
	const content = fs.readFileSync(localPath);
	const contentHash = crypto.createHash("md5").update(content).digest("hex");

	const client = getS3Client();
	await client.send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: key,
			Body: content,
		}),
	);

	return {
		filePath: key,
		fileSize: content.length,
		contentHash,
	};
}
