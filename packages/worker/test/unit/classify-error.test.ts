import { describe, expect, it } from "vitest";
import { classifyError } from "../../src/deployments/errors/classify-error.js";

describe("classifyError", () => {
	describe("clone step", () => {
		it("returns user_error for exit 128 with auth failure", () => {
			const result = classifyError(
				128,
				"remote: Repository not found.",
				"clone",
				false,
			);
			expect(result.category).toBe("user_error");
		});

		it("returns user_error for exit 128 with permission denied", () => {
			const result = classifyError(
				128,
				"Permission denied (publickey).",
				"clone",
				false,
			);
			expect(result.category).toBe("user_error");
		});

		it("returns retryable for network errors", () => {
			const result = classifyError(
				1,
				"Could not resolve host: github.com",
				"clone",
				false,
			);
			expect(result.category).toBe("retryable");
		});

		it("returns retryable for generic exit 128", () => {
			const result = classifyError(128, "fatal: some error", "clone", false);
			expect(result.category).toBe("retryable");
		});

		it("returns retryable for connection refused", () => {
			const result = classifyError(1, "Connection refused", "clone", false);
			expect(result.category).toBe("retryable");
		});
	});

	describe("install step", () => {
		it("returns system_error for ENOSPC", () => {
			const result = classifyError(
				1,
				"ENOSPC: no space left on device",
				"install",
				false,
			);
			expect(result.category).toBe("system_error");
		});

		it("returns retryable for network errors", () => {
			const result = classifyError(
				1,
				"connect ETIMEDOUT registry.npmjs.org:443",
				"install",
				false,
			);
			expect(result.category).toBe("retryable");
		});

		it("returns user_error for non-zero exit with no network patterns", () => {
			const result = classifyError(
				1,
				"npm ERR! 404 Not Found: nonexistent-package",
				"install",
				false,
			);
			expect(result.category).toBe("user_error");
		});
	});

	describe("build step", () => {
		it("returns system_error for OOM", () => {
			const result = classifyError(137, "", "build", true);
			expect(result.category).toBe("system_error");
		});

		it("returns system_error for exit 137 without OOM flag", () => {
			const result = classifyError(137, "", "build", false);
			expect(result.category).toBe("system_error");
		});

		it("returns user_error for non-zero exit", () => {
			const result = classifyError(1, "✗ Build failed in 2.3s", "build", false);
			expect(result.category).toBe("user_error");
		});
	});

	describe("verify step", () => {
		it("always returns user_error", () => {
			const result = classifyError(null, "", "verify", false);
			expect(result.category).toBe("user_error");
		});
	});

	describe("unknown step", () => {
		it("falls back to user_error", () => {
			const result = classifyError(1, "", "unknown", false);
			expect(result.category).toBe("user_error");
		});
	});
});
