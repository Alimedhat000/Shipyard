import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import pino from "pino";
import { getEnv } from "./config/env.js";
import { createAuthRouter } from "./routes/auth.js";
import { createHealthRouter } from "./routes/health.js";

const logger = pino();

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
		logger.info({
			method: req.method,
			path: req.path,
			status: res.statusCode,
			duration: Date.now() - start,
		});
	});
	next();
});

// API routes
app.use("/api/auth", createAuthRouter());
app.use("/api/health", createHealthRouter());

// 404 fallback
app.use((_req, res) => {
	res.status(404).json({ error: "Not found" });
});

const port = parseInt(env.PORT, 10);

app.listen(port, () => {
	logger.info({ port }, `Shipyard API started on port ${port}`);
});

export default app;
