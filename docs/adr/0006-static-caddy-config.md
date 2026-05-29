# ADR-0006: Static Caddy Config at Deploy Time

## Status

Accepted (updated by ADR-0014)

## Context

Caddy needs to route `myapp.bigboss.dev` to the correct backend. Two approaches:

1. **Dynamic (request-time):** Caddy queries the database per request to resolve `active_deployment_id` → S3 path.
2. **Static (deploy-time):** Send JSON config to Caddy API when deployment succeeds or rollback happens.

Dynamic requires a Lua module (OpenResty) or an auth_request subrequest to the API on every request. This adds latency and a DB dependency in the request path.

## Race Condition Mitigation

If two deploys finish at the same time, both sending config to Caddy API, could one overwrite the other?

**Solution:** Use Caddy's per-route API (not full config):
```
PATCH /id/{route_id}   → update existing route
POST /config/apps/http/servers/srv0/routes  → create new route
```
- Each app gets unique `@id` based on `app-{appId}`
- Deploy updates ONLY that app's route, not entire config
- No lock needed — Caddy's API is atomic per-route

## Decision

Static config generation at deploy time:

1. First deploy: generate and send Caddy JSON config (replaces any previous route for `app-{appId}`)
2. Subsequent deploys: Caddy root is already `sites/{appId}/current` — no Caddy API call needed for static sites
3. Rollback: symlink swap (per ADR-0014) — no Caddy API call at all

**Static sites (isStatic=true):**
```json
{
  "@id": "app-{appId}",
  "match": [{"host": ["myapp.bigboss.dev"]}],
  "handle": [
    {"handler": "file_server", "root": "/var/lib/shipyard/sites/{appId}/current", "pass_thru": true},
    {"handler": "rewrite", "uri": "/index.html"},
    {"handler": "file_server", "root": "/var/lib/shipyard/sites/{appId}/current"}
  ],
  "terminal": true
}
```

The `pass_thru` on the first `file_server` lets unmatched requests fall through to the rewrite handler, which serves `index.html` for SPA routing. This replaces the broken subroute+errors pattern that doesn't work in Caddy v2.

**Server apps (dockerfile, nixpacks isStatic=false):**
```json
{
  "@id": "app-{appId}",
  "match": [{"host": ["myapp.bigboss.dev"]}],
  "handle": [
    {"handler": "reverse_proxy", "upstreams": [{"dial": "shipyard-app-{appId}:{port}"}]}
  ],
  "terminal": true
}
```

4. Send JSON payload to Caddy Admin API
5. Caddy auto-reloads upon receiving the config API update

## Consequences

- Zero latency overhead per request (no DB query, no subrequest).
- Rollback is instant from user perspective (symlink swap, no Caddy interaction per ADR-0014).
- Adding/removing apps requires config regeneration + reload (acceptable for low-write system).
- Adding custom domains later requires regenerating all configs (known trade-off, acceptable).
- No need for OpenResty or Lua — plain Caddy works.

## Alternatives Considered

- **Dynamic via Lua/OpenResty (rejected):** Flexible but adds complexity and per-request overhead.
- **Dynamic via `auth_request` to API (rejected):** Adds API dependency in request path.
- **subroute + errors for SPA (rejected):** Caddy v2 doesn't support `errors` at the route level. `pass_thru` on `file_server` is the correct pattern.
