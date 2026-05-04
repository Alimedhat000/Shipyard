import { randomBytes } from "node:crypto";
import { sessions } from "@shipyard/shared/schema";
import type { SessionData } from "@shipyard/shared/types";
import { eq } from "drizzle-orm";
import { getEnv } from "../config/env";
import { db } from "../plugins/db";
import { redis } from "../plugins/redis";

/**
 * Creates a new session for a user.
 * Hybrid storage: Redis (primary) + Postgres (backup).
 *
 * @param userId - The user's UUID
 * @param orgId - The organization's UUID
 * @returns The session token (64 hex chars)
 *
 * @example
 * const token = await createSession(userId, orgId);
 * // Token: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a"
 */
export async function createSession(
	userId: string,
	orgId: string,
): Promise<string> {
	const TTL = parseInt(getEnv().SESSION_TTL, 10);
	const token = randomBytes(32).toString("hex");
	const sessionData: SessionData = { userId, orgId };

	await redis.setex(`session:${token}`, TTL, JSON.stringify(sessionData));

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

/**
 * Gets a session by token.
 * Hybrid read: Redis (fast path) → Postgres (fallback).
 * If found in Postgres, re-warms Redis cache.
 *
 * @param token - The session token
 * @returns Session data with userId and orgId, or null if invalid/expired
 *
 * @example
 * const session = await getSession(token);
 * // { userId: "uuid", orgId: "uuid" }
 */
export async function getSession(token: string): Promise<SessionData | null> {
	const TTL = parseInt(getEnv().SESSION_TTL, 10);

	const cached = await redis.get(`session:${token}`);
	if (cached) {
		return JSON.parse(cached) as SessionData;
	}

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

	await redis.setex(`session:${token}`, TTL, JSON.stringify(sessionData));
	return sessionData;
}

/**
 * Deletes a session from both Redis and Postgres.
 *
 * @param token - The session token to delete
 *
 * @example
 * await deleteSession(token);
 */
export async function deleteSession(token: string): Promise<void> {
	await redis.del(`session:${token}`);
	await db.delete(sessions).where(eq(sessions.token, token));
}
