import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { getEnv } from "./config/env.js";
import { logger } from "./config/logger.js";
import { requireAuth } from "./middleware/auth.js";
import { createAppsRouter } from "./routes/apps.js";
import { createAuthRouter } from "./routes/auth.js";
import { createHealthRouter } from "./routes/health.js";

const app = express();
const env = getEnv();

app.use(
	cors({
		origin: true,
		credentials: true,
	}),
);
app.use(express.json());
app.use(cookieParser());

// Request logging
app.use((req, res, next) => {
	const start = Date.now();
	res.on("finish", () => {
		const duration = Date.now() - start;
		const level =
			res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
		logger[level](
			{
				method: req.method,
				path: req.path,
				status: res.statusCode,
				duration: `${duration}ms`,
			},
			`${req.method} ${req.path} ${res.statusCode}`,
		);
	});
	next();
});

// API routes
app.use("/api/auth", createAuthRouter());
app.use("/api/health", createHealthRouter());
app.use("/api/apps", requireAuth, createAppsRouter());

// 404 fallback
app.use((_req, res) => {
	res.status(404).json({ error: "Not found" });
});

const port = parseInt(env.PORT, 10);
const server = app.listen(port, () => {
	logger.info(`Server listening on port ${port}`);
});

// Graceful shutdown
function shutdown(signal: string) {
	logger.warn({ signal }, `Shutting down...`);
	server.close(() => {
		logger.info("Server closed");
		process.exit(0);
	});
	// Force exit after 5s
	setTimeout(() => {
		logger.error("Forced shutdown after timeout");
		process.exit(1);
	}, 5000);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;
