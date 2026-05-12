import { z } from "zod";

/** AES-256-GCM key as 64 hex characters (32 bytes). */
export const encryptionKeySchema = z
	.string()
	.regex(
		/^[0-9a-f]{64}$/i,
		"ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)",
	);
