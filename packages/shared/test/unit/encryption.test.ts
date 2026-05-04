import { decrypt, encrypt } from "@shipyard/shared";
import { describe, expect, it } from "vitest";

const TEST_KEY = "a".repeat(64); // 64 hex chars = 32 bytes

describe("encrypt", () => {
	it("should encrypt and decrypt text correctly", () => {
		const plaintext = "hello world";
		const encrypted = encrypt(plaintext, TEST_KEY);
		const decrypted = decrypt(encrypted, TEST_KEY);
		expect(decrypted).toBe(plaintext);
	});

	it("should produce different ciphertext for same input (due to random IV)", () => {
		const plaintext = "test";
		const encrypted1 = encrypt(plaintext, TEST_KEY);
		const encrypted2 = encrypt(plaintext, TEST_KEY);
		expect(encrypted1).not.toBe(encrypted2);
	});

	it("should throw if key is not 64 hex characters", () => {
		const shortKey = "abc123";
		expect(() => encrypt("test", shortKey)).toThrow("Key must be 32 bytes");
	});

	it("should return colon-delimited format: iv:tag:ciphertext", () => {
		const encrypted = encrypt("test", TEST_KEY);
		const parts = encrypted.split(":");
		expect(parts.length).toBe(3);
		expect(parts[0]).toMatch(/^[0-9a-f]+$/); // iv hex
		expect(parts[1]).toMatch(/^[0-9a-f]+$/); // tag hex
		expect(parts[2]).toMatch(/^[0-9a-f]+$/); // ciphertext hex
	});
});

describe("decrypt", () => {
	it("should decrypt previously encrypted text", () => {
		const plaintext = "my secret token";
		const encrypted = encrypt(plaintext, TEST_KEY);
		const decrypted = decrypt(encrypted, TEST_KEY);
		expect(decrypted).toBe(plaintext);
	});

	it("should throw on invalid encrypted format (missing parts)", () => {
		expect(() => decrypt("invalid", TEST_KEY)).toThrow(
			"Invalid encrypted format",
		);
	});

	it("should throw if key is not 64 hex characters", () => {
		const shortKey = "xyz";
		expect(() => decrypt("abc:def:ghi", shortKey)).toThrow(
			"Key must be 32 bytes",
		);
	});

	it("should throw on tampered auth tag", () => {
		const encrypted = encrypt("sensitive data", TEST_KEY);
		const parts = encrypted.split(":");
		parts[1] = "a".repeat(32); // tampered tag
		const tampered = parts.join(":");
		expect(() => decrypt(tampered, TEST_KEY)).toThrow();
	});

	it("should handle empty string", () => {
		const encrypted = encrypt("", TEST_KEY);
		const decrypted = decrypt(encrypted, TEST_KEY);
		expect(decrypted).toBe("");
	});

	it("should handle long text", () => {
		const longText = "a".repeat(10000);
		const encrypted = encrypt(longText, TEST_KEY);
		const decrypted = decrypt(encrypted, TEST_KEY);
		expect(decrypted).toBe(longText);
	});
});
