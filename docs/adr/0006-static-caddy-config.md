# ADR-0006: Static Caddy Config at Deploy Time

## Status

Accepted

## Context

Caddy needs to route `myapp.bigboss.dev` to the correct Garage prefix. Two approaches:

1. **Dynamic (request-time):** Caddy queries the database per request to resolve `active_deployment_id` → S3 path.
2. **Static (deploy-time):** Send JSON config to Caddy API when deployment succeeds or rollback happens.

Dynamic requires a Lua module (OpenResty) or an auth_request subrequest to the API on every request. This adds latency and a DB dependency in the request path.

## Race Condition Mitigation

If two deploys finish at the same time, both sending config to Caddy API, could one overwrite the other?

**Solution:** Use Caddy's per-route API (not full config):
```
POST /config/apps/http/servers/{server_name}/routes/{route_id}
```
- Each app gets unique route_id based on app.id
- Deploy updates ONLY that app's route, not entire config
- No lock needed — Caddy's API is atomic per-route

**Alternative (if simpler for MVP):**
- Single-threaded Caddy config writer (queue config updates)
- Workers call queueCaddyUpdate(appId) after deploy
- Background job processes queue serially
- No concurrent writes to Caddy API

We'll use per-route updates for simplicity.

## Decision

Static config generation at deploy time:

1. Deployment succeeds (or rollback triggered)
2. Read `active_deployment_id` from DB
3. Generate Caddy JSON config via string-replace template:

   ```json
   {
     "apps": {
       "http": {
         "servers": {
           "sites": {
             "listen": [":443"],
             "routes": [{
               "match": [{"host": ["myapp.bigboss.dev"]}],
               "handle": [{
                 "handler": "reverse_proxy",
                  "upstreams": [{"dial": "garage:3900"}]
               }]
             }]
           }
         }
       }
     }
   }
   ```

4. Send JSON payload to Caddy Admin API (`POST /config/`)
5. `Caddy auto-reloads upon receiving the config API update`

No database lookup per request. Caddy serves purely from static config.

## Consequences

- Zero latency overhead per request (no DB query, no subrequest).
- Rollback is instant from user perspective (config reload is ~milliseconds).
- Adding/removing apps requires config regeneration + reload (acceptable for low-write system).
- Adding custom domains later requires regenerating all configs (known trade-off, acceptable).
- No need for OpenResty or Lua — plain Caddy works.

## Alternatives Considered

- **Dynamic via Lua/OpenResty (rejected):** Flexible but adds complexity and per-request overhead. Overkill for a static site platform.
- **Dynamic via `auth_request` to API (rejected):** Adds API dependency in request path. If API is down, sites break.
- **Symlink-style S3 paths (rejected):** S3 doesn't support symlinks. Would require copying files, which is slow on rollback.

