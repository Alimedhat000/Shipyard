import { describe, expect, it } from "vitest";
import {
	buildReverseProxyRouteConfig,
	buildRouteConfig,
} from "../../../src/infrastructure/caddy/config-builder.js";

describe("Caddy config builder", () => {
	describe("buildRouteConfig", () => {
		it("builds a file server route for non-SPA apps", () => {
			const route = buildRouteConfig("example.com", "app-1", false);
			expect(route["@id"]).toBe("app-app-1");
			expect(route.terminal).toBe(true);
			expect(route.match).toEqual([{ host: ["example.com"] }]);
			expect(route.handle).toHaveLength(1);
			expect(route.handle[0]).toMatchObject({
				handler: "file_server",
				root: "/var/lib/shipyard/sites/app-1/current",
			});
		});

		it("builds an SPA route with fallback to index.html", () => {
			const route = buildRouteConfig("spa.example.com", "app-2", true);
			expect(route["@id"]).toBe("app-app-2");
			expect(route.terminal).toBe(true);
			expect(route.handle).toHaveLength(3);
			expect(route.handle[0]).toMatchObject({
				handler: "file_server",
				root: "/var/lib/shipyard/sites/app-2/current",
				pass_thru: true,
			});
			expect(route.handle[1]).toMatchObject({
				handler: "rewrite",
				uri: "/index.html",
			});
			expect(route.handle[2]).toMatchObject({
				handler: "file_server",
				root: "/var/lib/shipyard/sites/app-2/current",
			});
		});

		it("accepts a boolean for isSpa", () => {
			const route = buildRouteConfig("x.com", "app-3", true);
			expect(route.terminal).toBe(true);
		});
	});

	describe("buildReverseProxyRouteConfig", () => {
		it("builds a reverse proxy route with port", () => {
			const route = buildReverseProxyRouteConfig(
				"api.example.com",
				"app-42",
				3000,
			);
			expect(route["@id"]).toBe("app-app-42");
			expect(route.match).toEqual([{ host: ["api.example.com"] }]);
			expect(route.handle[0]).toMatchObject({
				handler: "reverse_proxy",
				upstreams: [{ dial: "shipyard-app-app-42:3000" }],
			});
			expect(route.terminal).toBe(true);
		});

		it("accepts a numeric port", () => {
			const route = buildReverseProxyRouteConfig("x.com", "app-99", 8080);
			expect(route.handle[0].upstreams[0].dial).toBe(
				"shipyard-app-app-99:8080",
			);
		});
	});
});
