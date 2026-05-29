export type RouteConfig = {
	domain: string;
	handle: unknown[];
	terminal: boolean;
};

const SITES_ROOT = "/var/lib/shipyard/sites";

export function buildRouteConfig(
	domain: string,
	appId: string,
	isSpa: boolean,
): Record<string, unknown> {
	const root = `${SITES_ROOT}/${appId}/current`;

	if (!isSpa) {
		return {
			"@id": `app-${appId}`,
			match: [{ host: [domain] }],
			handle: [
				{
					handler: "file_server",
					root,
				},
			],
			terminal: true,
		};
	}

	return {
		"@id": `app-${appId}`,
		match: [{ host: [domain] }],
		handle: [
			{
				handler: "file_server",
				root,
				pass_thru: true,
			},
			{
				handler: "rewrite",
				uri: "/index.html",
			},
			{
				handler: "file_server",
				root,
			},
		],
		terminal: true,
	};
}

export function buildReverseProxyRouteConfig(
	domain: string,
	appId: string,
	port: number,
): Record<string, unknown> {
	return {
		"@id": `app-${appId}`,
		match: [{ host: [domain] }],
		handle: [
			{
				handler: "reverse_proxy",
				upstreams: [{ dial: `shipyard-app-${appId}:${port}` }],
			},
		],
		terminal: true,
	};
}
