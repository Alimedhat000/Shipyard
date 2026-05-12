import { apps } from "@shipyard/shared/schema";
import { defined } from "@shipyard/shared/utils";
import type {
	CreateAppInput,
	UpdateAppInput,
} from "@shipyard/shared/validators";
import { and, eq } from "drizzle-orm";
import { getEnv } from "../config/env.js";
import { db } from "../plugins/db.js";

const UNIQUE_VIOLATION = "23505";

const safeColumns = {
	id: apps.id,
	name: apps.name,
	organizationId: apps.organizationId,
	githubRepo: apps.githubRepo,
	buildCommand: apps.buildCommand,
	outputDir: apps.outputDir,
	branch: apps.branch,
	buildTimeout: apps.buildTimeout,
	activeDeploymentId: apps.activeDeploymentId,
	buildPack: apps.buildPack,
	port: apps.port,
	runCommand: apps.runCommand,
	dockerfilePath: apps.dockerfilePath,
	isSpa: apps.isSpa,
	customNginxConfig: apps.customNginxConfig,
	image: apps.image,
	createdAt: apps.createdAt,
	updatedAt: apps.updatedAt,
};

function applyActiveUrl<
	T extends { name: string; activeDeploymentId: string | null },
>(item: T): T & { activeUrl: string | null } {
	const env = getEnv();
	const domain = `${item.name}.${env.BASE_DOMAIN}`;
	const scheme = env.AUTO_HTTPS ? "https" : "http";
	return {
		...item,
		activeUrl: item.activeDeploymentId ? `${scheme}://${domain}` : null,
	};
}

export async function listApps(orgId: string) {
	const rows = await db
		.select(safeColumns)
		.from(apps)
		.where(eq(apps.organizationId, orgId));
	return rows.map(applyActiveUrl);
}

export async function getApp(orgId: string, appId: string) {
	const rows = await db
		.select(safeColumns)
		.from(apps)
		.where(and(eq(apps.id, appId), eq(apps.organizationId, orgId)));
	const app = rows[0] ?? null;
	return app ? applyActiveUrl(app) : null;
}

export async function createApp(orgId: string, input: CreateAppInput) {
	try {
		const rows = await db
			.insert(apps)
			.values({
				...input,
				githubRepo: input.githubRepo ?? "",
				branch: input.branch ?? "main",
				organizationId: orgId,
			})
			.returning();
		return rows[0];
	} catch (err) {
		if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
			throw Object.assign(
				new Error("App name already exists in this organization"),
				{ statusCode: 409, code: "NAME_TAKEN" },
			);
		}
		throw err;
	}
}

export async function updateApp(
	orgId: string,
	appId: string,
	input: UpdateAppInput,
) {
	const cleaned = defined(input);
	if (Object.keys(cleaned).length === 0) {
		return getApp(orgId, appId);
	}

	try {
		const rows = await db
			.update(apps)
			.set({ ...cleaned, updatedAt: new Date() })
			.where(and(eq(apps.id, appId), eq(apps.organizationId, orgId)))
			.returning();
		return rows[0] ?? null;
	} catch (err) {
		if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
			throw Object.assign(
				new Error("App name already exists in this organization"),
				{ statusCode: 409, code: "NAME_TAKEN" },
			);
		}
		throw err;
	}
}

export async function deleteApp(orgId: string, appId: string) {
	const rows = await db
		.delete(apps)
		.where(and(eq(apps.id, appId), eq(apps.organizationId, orgId)))
		.returning({ id: apps.id });
	return rows.length > 0;
}
