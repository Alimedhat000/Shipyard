const DEFAULT_BACKOFFS = [2000, 4000, 8000];

/** A function that may be retried on failure. */
export type RetryableFn<T> = () => Promise<T>;

/** Predicate that decides whether an error is retryable. */
export type ShouldRetry = (err: unknown) => boolean;

/**
 * Thrown when all retry attempts are exhausted.
 * The `cause` field contains the last error thrown by the attempted function.
 */
export class RetryExhaustedError extends Error {
	constructor(
		public readonly attempts: number,
		public readonly cause: unknown,
	) {
		super(`Failed after ${attempts} attempt(s)`);
		this.name = "RetryExhaustedError";
	}
}

/**
 * Executes an async function with exponential backoff retry.
 * Default backoff: 2s, 4s, 8s. Max retries: 3.
 * Provide `shouldRetry` to bail early on non-retryable errors.
 *
 * @param fn - The async function to execute (possibly multiple times)
 * @param options.maxRetries - Maximum number of retries (default 3)
 * @param options.backoffs - Custom backoff delays in ms (default [2000, 4000, 8000])
 * @param options.shouldRetry - Predicate to determine if an error is retryable
 * @param options.onRetry - Called before each retry with (attempt, delayMs, error)
 * @returns The result of the function
 * @throws RetryExhaustedError if all attempts fail
 */
export async function withRetry<T>(
	fn: RetryableFn<T>,
	options?: {
		maxRetries?: number;
		backoffs?: number[];
		shouldRetry?: ShouldRetry;
		onRetry?: (attempt: number, delayMs: number, err: unknown) => void;
	},
): Promise<T> {
	const maxRetries = options?.maxRetries ?? 3;
	const backoffs = options?.backoffs ?? DEFAULT_BACKOFFS;
	const shouldRetry = options?.shouldRetry;
	const onRetry = options?.onRetry;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (err) {
			if (attempt >= maxRetries) {
				throw new RetryExhaustedError(attempt + 1, err);
			}
			if (shouldRetry && !shouldRetry(err)) {
				throw err;
			}
			const delay = backoffs[attempt] ?? backoffs[backoffs.length - 1];
			onRetry?.(attempt + 1, delay, err);
			await sleep(delay);
		}
	}

	throw new Error("unreachable");
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
