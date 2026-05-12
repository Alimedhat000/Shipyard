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

	const filteredRoutes = existingRoutes.filter(
		(r) => r["@id"] !== `app-${appId}`,
	);

	const updatedRoutes = [route, ...filteredRoutes];

	const res = await fetch(routesUrl, {
		method: "PUT",
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
