import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

/**
 * Encrypts text using AES-256-GCM.
 * The key must be 32 bytes (64 hex characters).
 *
 * @param text - The plaintext to encrypt
 * @param key - 32-byte hex encryption key
 * @returns Encrypted string in format `iv:authTag:ciphertext` (all hex)
 * @throws Error if key is not 32 bytes
 *
 * @example
 * const encrypted = encrypt("secret token", "7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a");
 */
export function encrypt(text: string, key: string): string {
	const keyBuffer = Buffer.from(key, "hex");
	if (keyBuffer.length !== 32) {
		throw new Error("Key must be 32 bytes (64 hex characters)");
	}

	const iv = randomBytes(12);
	const cipher = createCipheriv(ALGORITHM, keyBuffer, iv);

	const encrypted = Buffer.concat([
		cipher.update(text, "utf8"),
		cipher.final(),
	]);

	const authTag = cipher.getAuthTag();

	return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypts text using AES-256-GCM.
 *
 * @param encrypted - The encrypted string in format `iv:authTag:ciphertext` (all hex)
 * @param key - 32-byte hex decryption key (must match the key used for encryption)
 * @returns The decrypted plaintext
 * @throws Error if key is not 32 bytes or if format is invalid
 *
 * @example
 * const decrypted = decrypt(encryptedText, "7f3a9b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a");
 */
export function decrypt(encrypted: string, key: string): string {
	const keyBuffer = Buffer.from(key, "hex");
	if (keyBuffer.length !== 32) {
		throw new Error("Key must be 32 bytes (64 hex characters)");
	}

	const [ivHex, tagHex, dataHex] = encrypted.split(":");

	if (!ivHex || !tagHex) {
		throw new Error("Invalid encrypted format");
	}

	const iv = Buffer.from(ivHex, "hex");
	const tag = Buffer.from(tagHex, "hex");
	const ciphertext = Buffer.from(dataHex, "hex");

	const decipher = createDecipheriv(ALGORITHM, keyBuffer, iv);
	decipher.setAuthTag(tag);

	const decrypted = Buffer.concat([
		decipher.update(ciphertext),
		decipher.final(),
	]);

	return decrypted.toString("utf8");
}
