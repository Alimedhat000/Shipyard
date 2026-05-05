import type { NextFunction, Request, Response } from "express";
import { getSession } from "../services/session.js";

export async function requireAuth(
	req: Request,
	res: Response,
	next: NextFunction,
) {
	const token = req.cookies?.session_token;

	if (!token) {
		res.status(401).json({ error: "Unauthorized" });
		return;
	}

	const session = await getSession(token);

	if (!session) {
		res.status(401).json({ error: "Invalid or expired session" });
		return;
	}

	req.userId = session.userId;
	req.orgId = session.orgId;
	next();
}
