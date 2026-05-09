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

	/**
	 * List all apps in the authenticated user's organization.
	 *
	 * @auth Requires valid session cookie
	 * @returns {Array<App>} 200 — array of app objects
	 */
	router.get("/", async (req, res) => {
		try {
			const apps = await appService.listApps(req.orgId!);
			res.json(apps);
		} catch (err) {
			logger.error({ err }, "Failed to list apps");
			res.status(500).json({ error: "internal_error" });
		}
	});

	/**
	 * Create a new app in the authenticated user's organization.
	 *
	 * @auth Requires valid session cookie
	 * @param {object} req.body — app config validated by createAppSchema
	 * @returns {App} 201 — created app object
	 * @throws 400 — validation_error if body fails schema
	 * @throws 409 — name_taken if app name already exists in org
	 */
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

	/**
	 * Get a single app by ID within the authenticated user's organization.
	 *
	 * @auth Requires valid session cookie
	 * @param {string} req.params.id — app ID
	 * @returns {App} 200 — app object
	 * @throws 404 — not_found if app does not exist
	 */
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

	/**
	 * Update an existing app by ID.
	 *
	 * @auth Requires valid session cookie
	 * @param {string} req.params.id — app ID
	 * @param {object} req.body — partial app fields validated by updateAppSchema
	 * @returns {App} 200 — updated app object
	 * @throws 400 — validation_error if body fails schema
	 * @throws 404 — not_found if app does not exist
	 * @throws 409 — name_taken if new name conflicts with another app
	 */
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

	/**
	 * Trigger a manual deployment for an app. Creates a deployment record
	 * and enqueues a deploy job to the worker.
	 *
	 * @auth Requires valid session cookie
	 * @param {string} req.params.id — app ID
	 * @returns {Deployment} 201 — created deployment object
	 * @throws 404 — not_found if app does not exist
	 */
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

	/**
	 * List all deployments for an app, most recent first.
	 *
	 * @auth Requires valid session cookie
	 * @param {string} req.params.id — app ID
	 * @returns {Array<Deployment>} 200 — array of deployment objects
	 * @throws 404 — not_found if app does not exist
	 */
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

	/**
	 * Delete an app by ID.
	 *
	 * @auth Requires valid session cookie
	 * @param {string} req.params.id — app ID
	 * @returns {void} 204 — no content on success
	 * @throws 404 — not_found if app does not exist
	 */
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
