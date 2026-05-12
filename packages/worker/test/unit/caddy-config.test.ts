import { describe, expect, it } from "vitest";
import { buildRouteConfig } from "../../src/deployments/caddy/config-builder.js";

describe("buildRouteConfig", () => {
	const domain = "myapp.bigboss.dev";
	const userId = "user-1";
	const appId = "app-1";
	const deploymentId = "deploy-1";

	it("returns a route with correct @id and host match", () => {
		const route = buildRouteConfig(domain, userId, appId, deploymentId, false);
		expect(route["@id"]).toBe("app-app-1");
		expect(route.match).toEqual([{ host: [domain] }]);
		expect(route.terminal).toBe(true);
	});

	it("uses file_server with correct root when isSpa is false", () => {
		const route = buildRouteConfig(domain, userId, appId, deploymentId, false);
		expect(route.handle).toHaveLength(1);
		const handler = route.handle[0] as Record<string, unknown>;
		expect(handler.handler).toBe("file_server");
		expect(handler.root).toBe("/var/lib/shipyard/sites/app-1");
	});

	it("uses subroute with error fallback when isSpa is true", () => {
		const route = buildRouteConfig(domain, userId, appId, deploymentId, true);
		expect(route.handle).toHaveLength(1);
		const handler = route.handle[0] as Record<string, unknown>;
		expect(handler.handler).toBe("subroute");
		expect(handler.routes).toBeDefined();
		expect(handler.errors).toBeDefined();
	});
});
