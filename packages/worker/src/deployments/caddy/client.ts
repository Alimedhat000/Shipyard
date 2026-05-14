import { getEnv } from "../../config/env.js";
import {
	buildReverseProxyRouteConfig,
	buildRouteConfig,
} from "./config-builder.js";

export async function upsertRoute(
	appId: string,
	domain: string,
	_userId: string,
	_deploymentId: string,
	isSpaOrPort: boolean | number,
): Promise<void> {
	const adminUrl = getEnv().CADDY_ADMIN_URL;
	const route =
		typeof isSpaOrPort === "number"
			? buildReverseProxyRouteConfig(domain, appId, isSpaOrPort)
			: buildRouteConfig(domain, appId, isSpaOrPort);
	const routeId = `app-${appId}`;

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
