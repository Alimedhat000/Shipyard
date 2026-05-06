import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	root: path.resolve(__dirname, "src"),
	server: {
		host: "0.0.0.0",
		port: 5173,
		proxy: {
			"/api": {
				target: process.env.VITE_API_PROXY_TARGET || "http://localhost:3000",
				// Forward /api as-is — backend routes live at /api/*
			},
		},
	},
	build: {
		outDir: path.resolve(__dirname, "dist"),
		emptyOutDir: true,
	},
});
