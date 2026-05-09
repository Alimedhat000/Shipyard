import pino from "pino";
import { getEnv } from "../config/env.js";

const _env = getEnv();

const isDev = _env.NODE_ENV === "development";

const options: pino.LoggerOptions = {
	level: isDev ? "debug" : "info",
	formatters: {
		level: (label) => {
			return { level: label, severity: label.toUpperCase() };
		},
	},
};

if (isDev) {
	options.transport = {
		target: "pino-pretty",
		options: {
			colorize: true,
			ignore: "pid,hostname",
			translateTime: "HH:MM:ss",
		},
	};
}

export const logger = pino(options);
