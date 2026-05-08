import { createAppSchema, updateAppSchema } from "@shipyard/shared/validators";
import { Router } from "express";
import { logger } from "../config/logger.js";
import * as appService from "../services/apps.js";

export function createAppsRouter() {
	const router = Router();

	router.get("/", async (req, res) => {
		try {
			const apps = await appService.listApps(req.orgId!);
			res.json(apps);
		} catch {
			res.status(500).json({ error: "internal_error" });
		}
	});

	router.post("/", async (req, res) => {
		try {
			const parsed = createAppSchema.safeParse(req.body);
			if (!parsed.success) {
				res.status(400).json({
					error: "validation_error",
					details: parsed.error.flatten().fieldErrors,
				});
				return;
			}

			const app = await appService.createApp(req.orgId!, parsed.data);

			res.status(201).json(app);
		} catch (err) {
			if ((err as { statusCode?: number }).statusCode === 409) {
				res.status(409).json({
					error: "name_taken",
					message: (err as Error).message,
				});
				return;
			}
			logger.error({ err }, "Failed to create app");
			res.status(500).json({ error: "internal_error" });
		}
	});

	router.get("/:id", async (req, res) => {
		try {
			const app = await appService.getApp(req.orgId!, req.params.id);
			if (!app) {
				res.status(404).json({ error: "not_found" });
				return;
			}
			res.json(app);
		} catch {
			res.status(500).json({ error: "internal_error" });
		}
	});

	router.put("/:id", async (req, res) => {
		try {
			const parsed = updateAppSchema.safeParse(req.body);
			if (!parsed.success) {
				res.status(400).json({
					error: "validation_error",
					details: parsed.error.flatten().fieldErrors,
				});
				return;
			}

			const app = await appService.updateApp(
				req.orgId!,
				req.params.id,
				parsed.data,
			);
			if (!app) {
				res.status(404).json({ error: "not_found" });
				return;
			}
			res.json(app);
		} catch (err) {
			if ((err as { statusCode?: number }).statusCode === 409) {
				res.status(409).json({
					error: "name_taken",
					message: (err as Error).message,
				});
				return;
			}
			logger.error({ err }, "Failed to update app");
			res.status(500).json({ error: "internal_error" });
		}
	});

	router.delete("/:id", async (req, res) => {
		try {
			const deleted = await appService.deleteApp(req.orgId!, req.params.id);
			if (!deleted) {
				res.status(404).json({ error: "not_found" });
				return;
			}
			res.status(204).send();
		} catch {
			res.status(500).json({ error: "internal_error" });
		}
	});

	return router;
}
