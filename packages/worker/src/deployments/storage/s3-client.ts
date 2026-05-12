import { S3Client } from "@aws-sdk/client-s3";
import { getEnv } from "../../config/env.js";

let client: S3Client | undefined;

/**
 * Creates or returns theclient S3 client configured for Garage.
 * forcePathStyle: true is required for Garage (and works with AWS S3 too).
 */
export function getS3Client(): S3Client {
	if (client) return client;
	const env = getEnv();
	client = new S3Client({
		endpoint: env.GARAGE_S3_ENDPOINT,
		region: "garage",
		credentials: {
			accessKeyId: env.GARAGE_S3_ACCESS_KEY,
			secretAccessKey: env.GARAGE_S3_SECRET_KEY,
		},
		forcePathStyle: true,
	});
	return client;
}
