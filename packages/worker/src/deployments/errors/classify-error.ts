/** Build step failure category — determines retry behaviour in the orchestrator. */
export type FailureCategory = "retryable" | "user_error" | "system_error";

export type ClassifiedError = {
	category: FailureCategory;
	message: string;
};

const NETWORK_PATTERNS = [
	"Connection refused",
	"Connection timed out",
	"connect ETIMEDOUT",
	"connect ECONNREFUSED",
	"connect ECONNRESET",
	"Could not resolve",
	"ENOTFOUND",
	"getaddrinfo",
	"network timeout",
	"network error",
];

const AUTH_PATTERNS = [
	"Authentication failed",
	"Repository not found",
	"Permission denied",
	"access denied",
	"could not read Username",
];

function matchesAny(text: string, patterns: string[]): boolean {
	return patterns.some((p) => text.toLowerCase().includes(p.toLowerCase()));
}

/**
 * Classifies a build step error into retryable, user_error, or system_error.
 *
 * Rules per step (from ADR-0002):
 * - clone: exit 128 + auth stderr → user_error; network patterns → retryable; else → retryable
 * - install: ENOSPC → system_error; network → retryable; else → user_error
 * - build: OOM → system_error; exit 137 → system_error; else → user_error
 * - verify: any failure → user_error (wrong outputDir config)
 *
 * @param exitCode - Exit code from the exec'd command (null if unknown)
 * @param stderr - Combined stderr output
 * @param step - Step name ("clone", "install", "build", "verify")
 * @param oomKilled - Whether Docker detected OOM kill on the container
 * @returns Classified error with category and user-facing message
 */
export function classifyError(
	exitCode: number | null,
	stderr: string,
	step: string,
	oomKilled: boolean,
): ClassifiedError {
	const stepLower = step.toLowerCase();

	if (stepLower === "clone") {
		if (exitCode === 128 && matchesAny(stderr, AUTH_PATTERNS)) {
			return {
				category: "user_error",
				message:
					"Git authentication failed. Check repo access or GitHub token.",
			};
		}
		if (matchesAny(stderr, NETWORK_PATTERNS)) {
			return {
				category: "retryable",
				message: "Network error during clone. Will retry.",
			};
		}
		if (exitCode !== 0 && exitCode !== null) {
			return {
				category: "retryable",
				message: `Git clone failed with exit code ${exitCode}. Will retry.`,
			};
		}
	}

	if (stepLower === "install") {
		if (matchesAny(stderr, ["ENOSPC", "No space left on device"])) {
			return {
				category: "system_error",
				message: "Disk full on build container. Contact administrator.",
			};
		}
		if (matchesAny(stderr, NETWORK_PATTERNS)) {
			return {
				category: "retryable",
				message: "Network error during install. Will retry.",
			};
		}
		if (exitCode !== 0 && exitCode !== null) {
			return {
				category: "user_error",
				message: "Dependency installation failed. Check your dependencies.",
			};
		}
	}

	if (stepLower === "build") {
		if (oomKilled) {
			return {
				category: "system_error",
				message:
					"Build ran out of memory (OOM). The 2GB memory limit was exceeded. Optimize your build or reduce bundle size.",
			};
		}
		if (exitCode === 137) {
			return {
				category: "system_error",
				message: "Build process was killed unexpectedly (exit 137).",
			};
		}
		if (exitCode !== 0 && exitCode !== null) {
			return {
				category: "user_error",
				message: "Build failed. Check your build command and code.",
			};
		}
	}

	if (stepLower === "verify") {
		return {
			category: "user_error",
			message:
				"Output directory is empty or missing. Check your outputDir config.",
		};
	}

	return {
		category: "user_error",
		message: `Step "${step}" failed with exit code ${exitCode}.`,
	};
}
