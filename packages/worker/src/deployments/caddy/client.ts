import { getEnv } from "../../config/env.js";
import {
	buildReverseProxyRouteConfig,
	buildRouteConfig,
} from "./config-builder.js";

async function applyRoute(route: Record<string, unknown>, routeId: string) {
	const adminUrl = getEnv().CADDY_ADMIN_URL;
	const headers = {
		"Content-Type": "application/json",
		Origin: "http://shipyard.local",
	};

	const patchRes = await fetch(`${adminUrl}/id/${routeId}`, {
		method: "PATCH",
		headers,
		body: JSON.stringify(route),
	});

	if (patchRes.ok) return;

	if (patchRes.status === 404) {
		const postRes = await fetch(
			`${adminUrl}/config/apps/http/servers/srv0/routes`,
			{
				method: "POST",
				headers,
				body: JSON.stringify(route),
			},
		);

		if (!postRes.ok) {
			const body = await postRes.text().catch(() => "unknown");
			throw new Error(`Failed to create route: ${body}`);
		}

		return;
	}

	const body = await patchRes.text().catch(() => "unknown");
	throw new Error(`Failed to update route: ${body}`);
}

export async function upsertFileRoute(
	appId: string,
	domain: string,
	isSpa: boolean,
): Promise<void> {
	const route = buildRouteConfig(domain, appId, isSpa);
	await applyRoute(route, `app-${appId}`);
}

export async function upsertProxyRoute(
	appId: string,
	domain: string,
	port: number,
): Promise<void> {
	const route = buildReverseProxyRouteConfig(domain, appId, port);
	await applyRoute(route, `app-${appId}`);
}
