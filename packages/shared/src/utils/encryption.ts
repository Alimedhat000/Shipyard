import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

export function encrypt(text: string, key: string): string {
	const keyBuffer = Buffer.from(key, "hex");
	if (keyBuffer.length !== 32) {
		throw new Error("Key must be 32 bytes (64 hex characters)");
	}

	const iv = randomBytes(12); // GCM recommended 12 bytes
	const cipher = createCipheriv("aes-256-gcm", keyBuffer, iv);

	const encrypted = Buffer.concat([
		cipher.update(text, "utf8"),
		cipher.final(),
	]);

	const authTag = cipher.getAuthTag();

	return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

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

	const decipher = createDecipheriv("aes-256-gcm", keyBuffer, iv);
	decipher.setAuthTag(tag);

	const decrypted = Buffer.concat([
		decipher.update(ciphertext),
		decipher.final(),
	]);

	return decrypted.toString("utf8");
}
