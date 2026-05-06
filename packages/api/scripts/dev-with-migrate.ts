import { spawn } from "node:child_process";
import { migrate } from "../src/db/migrate.js";

// Run migrations first
console.log("Running migrations...");
try {
	await migrate();
	console.log("Migrations complete!");
} catch (err) {
	console.error("Migration failed:", err);
	process.exit(1);
}

// Start dev server
console.log("Starting dev server...");
const dev = spawn("pnpm", ["run", "dev"], {
	stdio: "inherit",
	cwd: "/app/packages/api",
	env: process.env,
});

dev.on("exit", (code) => process.exit(code));
