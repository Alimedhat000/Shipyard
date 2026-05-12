import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		setupFiles: ["./test/setup.ts"],
		include: ["test/unit/**/*.test.ts"],
		coverage: {
			provider: "v8",
			include: ["src/deployments/**/*.ts"],
			reporter: ["text", "lcov"],
		},
	},
});
