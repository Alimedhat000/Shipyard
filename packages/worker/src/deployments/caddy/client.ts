import { getEnv } from "../../config/env.js";
import { buildRouteConfig } from "./config-builder.js";

/**
 * Sends a per-route config to the Caddy admin API.
 *
 * POSTs to /config/apps/http/servers/sites/routes/{routeId}
 * If the route already exists, it will be replaced atomically.
 */
export async function updateCaddyRoute(
	domain: string,
	userId: string,
	appId: string,
	deploymentId: string,
	isSpa: boolean,
): Promise<void> {
	const route = buildRouteConfig(domain, userId, appId, deploymentId, isSpa);
	const routeId = `app-${appId}`;
	const url = `${getEnv().CADDY_ADMIN_URL}/config/apps/http/servers/sites/routes/${routeId}`;

	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(route),
	});

	if (!res.ok) {
		const body = await res
			.text()
			.then((t) => t.slice(0, 500))
			.catch(() => "unknown");
		throw new Error(
			`Caddy API returned ${res.status} for route ${routeId}: ${body}`,
		);
	}
}
