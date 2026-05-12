export type StepErrorCategory = "retryable" | "user_error" | "system_error";

export class StepError extends Error {
	constructor(
		public readonly category: StepErrorCategory,
		message: string,
		public readonly exitCode?: number | null,
		public readonly stderr?: string,
	) {
		super(message);
		this.name = "StepError";
	}
}
