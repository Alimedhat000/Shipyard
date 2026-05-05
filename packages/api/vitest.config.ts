import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		setupFiles: ["./test/setup.ts"],
		include: ["test/unit/**/*.test.ts", "test/integration/**/*.test.ts"],
	},
});
