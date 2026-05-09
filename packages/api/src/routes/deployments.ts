import { Router } from "express";
import { logger } from "../config/logger.js";
import { requireAuth } from "../middleware/auth.js";
import * as appService from "../services/apps.js";
import * as deploymentService from "../services/deployments.js";

export function createDeploymentsRouter() {
	const router = Router();

	router.use(requireAuth);

	/**
	 * Get a single deployment by ID. Verifies the deployment's app
	 * belongs to the authenticated user's organization.
	 *
	 * @auth Requires valid session cookie
	 * @param {string} req.params.id — deployment ID
	 * @returns {Deployment} 200 — deployment object
	 * @throws 404 — not_found if deployment or its app does not exist
	 */
	router.get("/:id", async (req, res) => {
		try {
			const deployment = await deploymentService.getDeployment(req.params.id);
			if (!deployment) {
				res.status(404).json({ error: "not_found" });
				return;
			}

			const app = await appService.getApp(req.orgId!, deployment.appId);
			if (!app) {
				res.status(404).json({ error: "not_found" });
				return;
			}

			res.json(deployment);
		} catch (err) {
			logger.error({ err }, "Failed to get deployment");
			res.status(500).json({ error: "internal_error" });
		}
	});

	return router;
}
