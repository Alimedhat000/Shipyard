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

	it("uses simple reverse_proxy when isSpa is false", () => {
		const route = buildRouteConfig(domain, userId, appId, deploymentId, false);
		expect(route.handle).toHaveLength(1);
		const handler = (route.handle as Record<string, unknown>[])[0];
		expect(handler.handler).toBe("reverse_proxy");
		expect(handler.upstreams).toEqual([{ dial: "garage:3900" }]);
	});

	it("wraps in subroute with error fallback when isSpa is true", () => {
		const route = buildRouteConfig(domain, userId, appId, deploymentId, true);
		expect(route.handle).toHaveLength(1);
		const handler = (route.handle as Record<string, unknown>[])[0];
		expect(handler.handler).toBe("subroute");
		expect(handler.routes).toBeDefined();
		expect(handler.errors).toBeDefined();
	});

	it("includes rewrite URI with correct S3 prefix", () => {
		const route = buildRouteConfig(domain, userId, appId, deploymentId, false);
		const handler = (route.handle as Record<string, unknown>[])[0];
		const rewrite = handler.rewrite as Record<string, string>;
		expect(rewrite.uri).toContain("shipyard");
		expect(rewrite.uri).toContain(
			"users/user-1/apps/app-1/deployments/deploy-1",
		);
	});
});
