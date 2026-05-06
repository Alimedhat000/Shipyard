import { randomBytes } from "node:crypto";
import { sessions } from "@shipyard/shared/schema";
import type { SessionData } from "@shipyard/shared/types";
import { eq } from "drizzle-orm";
import { getEnv } from "../config/env";
import { logger } from "../config/logger.js";
import { db } from "../plugins/db";
import { redis } from "../plugins/redis";

export const SESSION_TTL_SECONDS = (() => {
	const val = parseInt(getEnv().SESSION_TTL, 10);
	if (!Number.isFinite(val) || val <= 0) {
		throw new Error(
			`Invalid SESSION_TTL: "${getEnv().SESSION_TTL}" — must be a positive integer`,
		);
	}
	return val;
})();

export const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;

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
	const token = randomBytes(32).toString("hex");
	const sessionData: SessionData = { userId, orgId };

	await redis.setex(
		`session:${token}`,
		SESSION_TTL_SECONDS,
		JSON.stringify(sessionData),
	);

	// Best-effort backup to Postgres (Redis is primary for reads/writes).
	// A failure here won't prevent login, but session won't survive Redis restarts.
	db.insert(sessions)
		.values({
			userId,
			orgId,
			token,
			expiresAt: new Date(Date.now() + SESSION_TTL_MS),
		})
		.catch((err) => {
			logger.error({ err }, "Session DB write failed");
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

	const remainingSeconds = Math.floor(
		(session.expiresAt.getTime() - Date.now()) / 1000,
	);

	await redis.setex(
		`session:${token}`,
		remainingSeconds,
		JSON.stringify(sessionData),
	);
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
