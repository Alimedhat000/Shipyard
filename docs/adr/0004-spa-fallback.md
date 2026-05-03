# ADR-0004: SPA Fallback via nginx and Caddy

## Status

Accepted (updated)

## Context

Shipyard deploys static sites (React, Vue, Svelte, etc.) that use client-side routing. When a user navigates to `/dashboard` directly, the browser requests that path. If there is no literal file, the server must return `index.html` so the SPA can boot and handle routing.

The API previously served `public/index.html` as a fallback, but this mixed concerns — the API should not serve static files. The separation is:

- **Web container** (nginx) serves the SPA built output
- **Caddy** reverse-proxies user domains to Garage storage
- **API** serves only REST endpoints

## Decision

### Development

Vite dev server handles SPA fallback natively. The API has no static file serving.

### Production

nginx in the web container serves the SPA via `try_files $uri $uri/ /index.html`. The `nginx.conf` proxies `/api/` and `/health` to the API container.

Caddy routes custom domains to Garage storage with its own `handle_errors` for SPA fallback when serving from object storage.

## Consequences

- Clean separation: API never deals with static files.
- Web container is self-contained SPA serving with its own nginx.
- Caddy handles domain routing independently.
- One caveat: genuine 404s (missing static assets) return `index.html` with 200 status. Standard SPA behavior.

## Alternatives Considered

- **API serves SPA (rejected):** Mixed concerns. API container becomes responsible for frontend.
- **Single Caddy for everything (considered for v2):** Caddy could serve the SPA and proxy API. Simpler topology but requires Caddy config complexity.
