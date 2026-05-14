import { describe, expect, it } from "vitest";
import {
	buildReverseProxyRouteConfig,
	buildRouteConfig,
} from "../../src/deployments/caddy/config-builder.js";

describe("buildRouteConfig", () => {
	const domain = "myapp.bigboss.dev";
	const appId = "app-1";

	it("returns a route with correct @id and host match", () => {
		const route = buildRouteConfig(domain, appId, false);
		expect(route["@id"]).toBe("app-app-1");
		expect(route.match).toEqual([{ host: [domain] }]);
		expect(route.terminal).toBe(true);
	});

	it("uses file_server with correct root when isSpa is false", () => {
		const route = buildRouteConfig(domain, appId, false);
		expect(route.handle).toHaveLength(1);
		const handler = route.handle[0] as Record<string, unknown>;
		expect(handler.handler).toBe("file_server");
		expect(handler.root).toBe("/var/lib/shipyard/sites/app-1");
	});

	it("uses subroute with error fallback when isSpa is true", () => {
		const route = buildRouteConfig(domain, appId, true);
		expect(route.handle).toHaveLength(1);
		const handler = route.handle[0] as Record<string, unknown>;
		expect(handler.handler).toBe("subroute");
		expect(handler.routes).toBeDefined();
		expect(handler.errors).toBeDefined();
	});
});

describe("buildReverseProxyRouteConfig", () => {
	const domain = "myapp.bigboss.dev";
	const appId = "app-1";
	const port = 3000;

	it("returns a route with correct @id and host match", () => {
		const route = buildReverseProxyRouteConfig(domain, appId, port);
		expect(route["@id"]).toBe("app-app-1");
		expect(route.match).toEqual([{ host: [domain] }]);
		expect(route.terminal).toBe(true);
	});

	it("uses reverse_proxy handler with correct upstream port", () => {
		const route = buildReverseProxyRouteConfig(domain, appId, port);
		expect(route.handle).toHaveLength(1);
		const handler = route.handle[0] as Record<string, unknown>;
		expect(handler.handler).toBe("reverse_proxy");
		expect(handler.upstreams).toEqual([{ dial: "shipyard-app-app-1:3000" }]);
	});
});
