import { randomBytes } from "node::crypto";
import { sessions } from "@shipyard/shared/schema";
import type { SessionData } from "@shipyard/shared/types";
import { eq } from "drizzle-orm";
import { db } from "../plugins/db";
import { redis } from "../plugins/redis";

const TTL = parseInt(process.env.SESSION_TTL || "604800", 10);

export async function createSession(
	userId: string,
	orgId: string,
): Promise<string> {
	const token = randomBytes(32).toString("hex"); // 64 hex chars
	const sessionData: SessionData = { userId, orgId };
	// Write to Redis
	await redis.setex(`session:${token}`, TTL, JSON.stringify(sessionData));
	// Async write to Postgres
	db.insert(sessions)
		.values({
			userId,
			orgId,
			token,
			expiresAt: new Date(Date.now() + TTL * 1000),
		})
		.catch((err) => {
			console.error("Session DB write failed:", err);
		});

	return token;
}

export async function getSession(token: string): Promise<SessionData | null> {
	// Check Redis first (fast path)
	const cached = await redis.get(`session:${token}`);
	if (cached) {
		return JSON.parse(cached) as SessionData;
	}
	// Fallback to Postgres
	const session = await db.query.sessions.findFirst({
		where: eq(sessions.token, token),
	});

	if (!session || session.expiresAt < new Date()) {
		return null;
	}

	const sessionData: SessionData = {
		userId: session.userId,
		orgId: session.orgId,
	};

	// Re-warm Redis
	await redis.setex(`session:${token}`, TTL, JSON.stringify(sessionData));
	return sessionData;
}

export async function deleteSession(token: string): Promise<void> {
	// Delete from Redis
	await redis.del(`session:${token}`);
	// Delete from Postgres
	await db.delete(sessions).where(eq(sessions.token, token));
}
