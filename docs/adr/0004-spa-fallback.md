# ADR-0004: SPA Fallback

## Status

Accepted (updated)

## Context

Shipyard deploys static sites (React, Vue, Svelte, etc.) that use client-side routing. When a user navigates to `/dashboard` directly, the browser requests that path. If there is no literal file, the server must return `index.html` so the SPA can boot and handle routing.

## Decision

### Caddy pass_thru

Static sites with SPA mode use Caddy's `file_server` with `pass_thru: true`:

```json
{
  "handle": [
    {"handler": "file_server", "root": "/var/lib/shipyard/sites/{appId}", "pass_thru": true},
    {"handler": "rewrite", "uri": "/index.html"},
    {"handler": "file_server", "root": "/var/lib/shipyard/sites/{appId}"}
  ]
}
```

The first `file_server` attempts to serve the file. On 404, `pass_thru: true` lets the request fall through to the next handler, which rewrites to `/index.html` and serves it via a second `file_server`.

This replaced a broken `subroute` + `errors` pattern that Caddy v2 doesn't support at the route level.

## Consequences

- Clean SPA routing without custom nginx or subrequest logic.
- One caveat: genuine 404s (missing static assets) return `index.html` with 200 status. Standard SPA behavior.

## Alternatives Considered

- **subroute + errors (rejected):** Caddy v2 doesn't support `errors` at the route level. The subroute errors pattern doesn't bubble 404s correctly.
- **Custom nginx container (not adopted for Shipyard):** Dokploy uses Traefik for SPA routing. Shipyard uses Caddy exclusively.
