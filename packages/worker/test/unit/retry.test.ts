import { describe, expect, it, vi } from "vitest";
import {
	RetryExhaustedError,
	withRetry,
} from "../../src/deployments/utils/retry.js";

describe("withRetry", () => {
	it("returns the result on first success", async () => {
		const fn = vi.fn().mockResolvedValue("ok");
		const result = await withRetry(fn);
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("retries on failure and eventually succeeds", async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new Error("first"))
			.mockRejectedValueOnce(new Error("second"))
			.mockResolvedValue("ok");

		const result = await withRetry(fn, {
			maxRetries: 3,
			backoffs: [1, 1, 1],
		});
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it("throws RetryExhaustedError after exhausting retries", async () => {
		const fn = vi.fn().mockRejectedValue(new Error("always fail"));

		await expect(
			withRetry(fn, { maxRetries: 2, backoffs: [1, 1] }),
		).rejects.toThrow(RetryExhaustedError);
		expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
	});

	it("preserves the last error as cause in RetryExhaustedError", async () => {
		const fn = vi.fn().mockRejectedValue(new Error("last error"));

		try {
			await withRetry(fn, { maxRetries: 1 });
		} catch (err) {
			expect(err).toBeInstanceOf(RetryExhaustedError);
			expect((err as RetryExhaustedError).attempts).toBe(2);
			expect((err as RetryExhaustedError).cause).toBeInstanceOf(Error);
			expect(((err as RetryExhaustedError).cause as Error).message).toBe(
				"last error",
			);
		}
	});

	it("bails immediately when shouldRetry returns false", async () => {
		const fn = vi.fn().mockRejectedValue(new Error("fatal"));
		const shouldRetry = vi.fn().mockReturnValue(false);

		await expect(withRetry(fn, { maxRetries: 3, shouldRetry })).rejects.toThrow(
			"fatal",
		);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("uses custom backoff delays", async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new Error("try 1"))
			.mockRejectedValueOnce(new Error("try 2"))
			.mockResolvedValue("ok");

		const start = Date.now();
		await withRetry(fn, { maxRetries: 2, backoffs: [50, 50] });
		const elapsed = Date.now() - start;
		expect(elapsed).toBeGreaterThanOrEqual(100);
	});
});
