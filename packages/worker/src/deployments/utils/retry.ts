const DEFAULT_BACKOFFS = [2000, 4000, 8000];

export type RetryableFn<T> = () => Promise<T>;

export type ShouldRetry = (err: unknown) => boolean;

export class RetryExhaustedError extends Error {
	constructor(
		public readonly attempts: number,
		public readonly cause: unknown,
	) {
		super(`Failed after ${attempts} attempt(s)`);
		this.name = "RetryExhaustedError";
	}
}

export async function withRetry<T>(
	fn: RetryableFn<T>,
	options?: {
		maxRetries?: number;
		backoffs?: number[];
		shouldRetry?: ShouldRetry;
	},
): Promise<T> {
	const maxRetries = options?.maxRetries ?? 3;
	const backoffs = options?.backoffs ?? DEFAULT_BACKOFFS;
	const shouldRetry = options?.shouldRetry;

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
			await sleep(delay);
		}
	}

	throw new Error("unreachable");
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
