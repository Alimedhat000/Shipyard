import { Router } from "express";
import { getEnv } from "../config/env.js";
import { logger } from "../config/logger.js";
import {
	createOrUpdateUser,
	exchangeCodeForToken,
	getGithubUser,
	getUserWithOrg,
} from "../services/auth.js";
import {
	createSession,
	deleteSession,
	getSession,
	SESSION_TTL_MS,
} from "../services/session.js";

export function createAuthRouter() {
	const router = Router();

	/**
	 * Redirect the user to GitHub OAuth authorization page.
	 *
	 * @auth No auth required
	 * @returns 302 — redirect to GitHub
	 */
	router.get("/github", (_req, res) => {
		const env = getEnv();
		const params = new URLSearchParams({
			client_id: env.GITHUB_CLIENT_ID,
			redirect_uri: env.GITHUB_CALLBACK_URL,
			scope: "repo read:user",
		});
		res.redirect(`https://github.com/login/oauth/authorize?${params}`);
	});

	/**
	 * GitHub OAuth callback. Exchanges the code for an access token,
	 * creates/updates the user and organization, sets a session cookie,
	 * and redirects to the frontend dashboard.
	 *
	 * @auth No auth required (handles OAuth handshake)
	 * @param {string} req.query.code — authorization code from GitHub
	 * @returns 302 — redirect to dashboard on success, /login?error= on failure
	 * @throws 500 — redirect to /login?error=auth_failed
	 */
	router.get("/github/callback", async (req, res) => {
		const code = req.query.code as string | undefined;

		if (!code) {
			res.redirect("/login?error=missing_code");
			return;
		}

		try {
			const accessToken = await exchangeCodeForToken(code);
			const githubUser = await getGithubUser(accessToken);
			const { user, org } = await createOrUpdateUser(githubUser, accessToken);
			const token = await createSession(user.id, org.id);

			const env = getEnv();
			res.cookie("session_token", token, {
				httpOnly: true,
				secure: env.NODE_ENV === "production",
				sameSite: "lax",
				maxAge: SESSION_TTL_MS,
				path: "/",
			});

			const frontendUrl = env.FRONTEND_URL || "http://localhost:5173";
			res.redirect(`${frontendUrl}/dashboard`);
		} catch (err) {
			if (err instanceof Error) {
				logger.error({ err }, "OAuth callback error");
			}
			res.redirect("/login?error=auth_failed");
		}
	});

	/**
	 * Get the currently authenticated user and their organization.
	 * Returns null (not an error) when no valid session exists.
	 *
	 * @auth No auth required — returns null for unauthenticated requests
	 * @returns {object} 200 — { user, organization } or null
	 */
	router.get("/me", async (req, res) => {
		try {
			const token = req.cookies?.session_token;

			if (!token) {
				res.json(null);
				return;
			}

			const session = await getSession(token);

			if (!session) {
				res.json(null);
				return;
			}

			const data = await getUserWithOrg(session.userId);

			if (!data) {
				res.json(null);
				return;
			}

			res.json({
				user: data.user,
				organization: data.organization,
			});
		} catch {
			res.status(500).json({ error: "internal_error" });
		}
	});

	/**
	 * Log out the current user by deleting their session and clearing
	 * the session cookie.
	 *
	 * @auth No auth required — idempotent for unauthenticated requests
	 * @returns {object} 200 — { success: true }
	 */
	router.post("/logout", async (req, res) => {
		try {
			const token = req.cookies?.session_token;

			if (token) {
				await deleteSession(token);
			}

			res.clearCookie("session_token", { path: "/" });
			res.json({ success: true });
		} catch {
			res.status(500).json({ error: "internal_error" });
		}
	});

	return router;
}
