import { getEnv } from "../../config/env.js";
import { buildRouteConfig } from "./config-builder.js";

export async function upsertRoute(
	appId: string,
	domain: string,
	userId: string,
	deploymentId: string,
	isSpa: boolean,
): Promise<void> {
	const adminUrl = getEnv().CADDY_ADMIN_URL;
	const route = buildRouteConfig(domain, userId, appId, deploymentId, isSpa);
	const routeId = `app-${appId}`;

	const routesUrl = `${adminUrl}/config/apps/http/servers/srv0/routes`;

	const existingRes = await fetch(routesUrl, {
		headers: {
			Origin: "http://shipyard.local",
		},
	});

	if (!existingRes.ok) {
		throw new Error("Failed to fetch existing routes");
	}

	const existingRoutes = (await existingRes.json()) as Array<
		Record<string, unknown>
	>;

	await fetch(`${routesUrl}/${routeId}`, {
		method: "DELETE",
		headers: { Origin: "http://shipyard.local" },
	}).catch(() => {});

	const updatedRoutes = [
		route,
		...existingRoutes.filter((r) => r["@id"] !== routeId),
	];

	const res = await fetch(routesUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Origin: "http://shipyard.local",
		},
		body: JSON.stringify(updatedRoutes),
	});

	if (!res.ok) {
		const body = await res.text().catch(() => "unknown");
		throw new Error(`Failed to update routes: ${body}`);
	}
}
