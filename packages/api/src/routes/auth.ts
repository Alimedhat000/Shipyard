import { Router } from "express";
import { getEnv } from "../config/env.js";
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
} from "../services/session.js";

export function createAuthRouter() {
	const router = Router();

	router.post("/github", (_req, res) => {
		const env = getEnv();
		const url =
			`https://github.com/login/oauth/authorize` +
			`?client_id=${encodeURIComponent(env.GITHUB_CLIENT_ID)}` +
			`&redirect_uri=${encodeURIComponent(env.GITHUB_CALLBACK_URL)}` +
			`&scope=${encodeURIComponent("repo").replace(/%20/g, "+")}+${encodeURIComponent("read:user").replace(/%20/g, "+")}`;
		res.redirect(url);
	});

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
				maxAge: parseInt(env.SESSION_TTL, 10) * 1000,
				path: "/",
			});

			res.redirect("/dashboard");
		} catch (err) {
			const message = err instanceof Error ? err.message : "unknown_error";
			res.redirect(`/login?error=${encodeURIComponent(message)}`);
		}
	});

	router.get("/me", async (req, res) => {
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
	});

	router.post("/logout", async (req, res) => {
		const token = req.cookies?.session_token;

		if (token) {
			await deleteSession(token);
		}

		res.clearCookie("session_token", { path: "/" });
		res.json({ success: true });
	});

	return router;
}
