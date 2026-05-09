import { createAppSchema, updateAppSchema } from "@shipyard/shared/validators";
import { Router } from "express";
import { logger } from "../config/logger.js";
import { requireAuth } from "../middleware/auth.js";
import { myQueue } from "../plugins/queue.js";
import * as appService from "../services/apps.js";
import * as deploymentService from "../services/deployments.js";

export function createAppsRouter() {
	const router = Router();

	router.use(requireAuth);

	router.get("/", async (req, res) => {
		try {
			const apps = await appService.listApps(req.orgId!);
			res.json(apps);
		} catch (err) {
			logger.error({ err }, "Failed to list apps");
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
		} catch (err) {
			logger.error({ err }, "Failed to get app");
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

	router.post("/:id/deployments", async (req, res) => {
		try {
			const app = await appService.getApp(req.orgId!, req.params.id);
			if (!app) {
				res.status(404).json({ error: "not_found" });
				return;
			}

			const deployment = await deploymentService.createDeploymentWithBuildJob(
				req.params.id,
			);

			await myQueue.add("deploy", {
				deploymentId: deployment.id,
				applicationId: req.params.id,
				titleLog: "Manual deploy",
				descriptionLog: `Deployment triggered manually for app ${req.params.id}`,
			});

			logger.info(
				{ deploymentId: deployment.id, appId: req.params.id },
				"Deployment created and queued",
			);

			res.status(201).json(deployment);
		} catch (err) {
			logger.error({ err }, "Failed to create deployment");
			res.status(500).json({ error: "internal_error" });
		}
	});

	router.get("/:id/deployments", async (req, res) => {
		try {
			const app = await appService.getApp(req.orgId!, req.params.id);
			if (!app) {
				res.status(404).json({ error: "not_found" });
				return;
			}

			const list = await deploymentService.listDeployments(req.params.id);
			res.json(list);
		} catch (err) {
			logger.error({ err }, "Failed to list deployments");
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
		} catch (err) {
			logger.error({ err }, "Failed to delete app");
			res.status(500).json({ error: "internal_error" });
		}
	});

	return router;
}
