import { getEnv } from "../../config/env.js";

export type RouteConfig = {
	domain: string;
	handle: unknown[];
	terminal: boolean;
};

/**
 * Builds a Caddy per-route JSON config for a deployment.
 *
 * The route reverse-proxies the domain to Garage S3, rewriting the URI
 * to the deployment's S3 prefix. For SPAs, 404 errors from Garage
 * are caught and rewritten to /index.html (client-side routing fallback).
 */
export function buildRouteConfig(
	domain: string,
	userId: string,
	appId: string,
	deploymentId: string,
	isSpa: boolean,
): Record<string, unknown> {
	const bucket = getEnv().GARAGE_S3_BUCKET;
	const prefix = `users/${userId}/apps/${appId}/deployments/${deploymentId}`;

	const proxy = {
		handler: "reverse_proxy" as const,
		upstreams: [{ dial: "garage:3900" }],
		rewrite: { uri: `/${bucket}/${prefix}{uri}` },
	};

	if (!isSpa) {
		return {
			"@id": `app-${appId}`,
			match: [{ host: [domain] }],
			handle: [proxy],
			terminal: true,
		};
	}

	const indexProxy = {
		handler: "reverse_proxy" as const,
		upstreams: [{ dial: "garage:3900" }],
		rewrite: { uri: `/${bucket}/${prefix}/index.html` },
	};

	return {
		"@id": `app-${appId}`,
		match: [{ host: [domain] }],
		handle: [
			{
				handler: "subroute",
				routes: [
					{
						handle: [proxy],
					},
				],
				errors: [
					{
						routes: [
							{
								handle: [
									{ handler: "rewrite" as const, uri: indexProxy.rewrite.uri },
									indexProxy,
								],
							},
						],
					},
				],
			},
		],
		terminal: true,
	};
}
