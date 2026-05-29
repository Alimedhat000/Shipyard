import { Router } from "express";
import { logger } from "../config/logger.js";
import { requireAuth } from "../middleware/auth.js";
import { myQueue } from "../plugins/queue.js";
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

	/**
	 * Retrieves structured log events for a deployment.
	 *
	 * Returns step-level events (started, completed, failed, OOM, etc.)
	 * ordered chronologically.
	 *
	 * @param {string} req.params.id — deployment ID
	 * @returns {{ logs: DeploymentLog[] }} 200 — log entries
	 * @throws 404 — not_found if deployment or its app does not exist
	 */
	router.get("/:id/logs", async (req, res) => {
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

			const logs = await deploymentService.getDeploymentLogs(req.params.id);
			res.json({ logs });
		} catch (err) {
			logger.error({ err }, "Failed to get deployment logs");
			res.status(500).json({ error: "internal_error" });
		}
	});

	/**
	 * Rollback to a previous deployment. Swaps the symlink atomically
	 * and updates the app's active deployment pointer.
	 *
	 * Validates the deployment is a valid rollback target:
	 * - status must be "success"
	 * - artifacts must not have been pruned
	 * - deployment directory must exist on disk
	 * - deployment must not already be active
	 *
	 * @auth Requires valid session cookie
	 * @param {string} req.params.id — deployment ID to rollback TO
	 * @returns {{ deployment, app }} 200 — updated deployment + app
	 * @throws 404 — not_found if deployment or its app does not exist
	 * @throws 409 — conflict if deployment is already active
	 * @throws 410 — gone if artifacts have been pruned
	 * @throws 422 — unprocessable if deployment status is not success
	 */
	router.post("/:id/rollback", async (req, res) => {
		try {
			const result = await deploymentService.rollbackDeployment(
				req.params.id,
				req.orgId!,
			);

			if (!result.deployment || !result.app) {
				res.status(404).json({ error: "not_found" });
				return;
			}

			await myQueue.add("rollback", {
				type: "rollback",
				deploymentId: req.params.id,
				applicationId: result.app.id,
				titleLog: "Rollback",
				descriptionLog: `Rollback to deployment ${req.params.id}`,
			});

			res.json({
				deployment: result.deployment,
				app: result.app,
			});
		} catch (err) {
			const status = (err as { statusCode?: number }).statusCode ?? 500;
			if (status === 500) {
				logger.error({ err }, "Failed to rollback deployment");
			}
			res.status(status).json({
				error: status === 500 ? "internal_error" : (err as Error).message,
			});
		}
	});

	return router;
}
