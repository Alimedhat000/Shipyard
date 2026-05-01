# ADR-0006: Static Nginx Config at Deploy Time

## Status

Accepted

## Context

Nginx needs to route `myapp.bigboss.dev` to the correct MinIO prefix. Two approaches:

1. **Dynamic (request-time):** Nginx queries the database per request to resolve `active_deployment_id` → S3 path.
2. **Static (deploy-time):** Regenerate nginx.conf when a deployment succeeds or rollback happens, then `nginx -s reload`.

Dynamic requires a Lua module (OpenResty) or an auth_request subrequest to the API on every request. This adds latency and a DB dependency in the request path.

## Decision

Static config generation at deploy time:

1. Deployment succeeds (or rollback triggered)
2. Read `active_deployment_id` from DB
3. Generate nginx server block via string-replace template:

   ```
   server {
     server_name myapp.bigboss.dev;
     location / {
       proxy_pass http://minio:9000/bucket/users/.../deployments/{activeDeploymentId}/;
     }
   }
   ```

4. Write to nginx config directory
5. `nginx -s reload`

No database lookup per request. Nginx serves purely from static config.

## Consequences

- Zero latency overhead per request (no DB query, no subrequest).
- Rollback is instant from user perspective (config reload is ~milliseconds).
- Adding/removing apps requires config regeneration + reload (acceptable for low-write system).
- Adding custom domains later requires regenerating all configs (known trade-off, acceptable).
- No need for OpenResty or Lua — plain Nginx works.

## Alternatives Considered

- **Dynamic via Lua/OpenResty (rejected):** Flexible but adds complexity and per-request overhead. Overkill for a static site platform.
- **Dynamic via `auth_request` to API (rejected):** Adds API dependency in request path. If API is down, sites break.
- **Symlink-style S3 paths (rejected):** S3 doesn't support symlinks. Would require copying files, which is slow on rollback.

