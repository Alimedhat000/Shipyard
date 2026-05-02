# ADR-0004: SPA Fallback via Caddy

## Status

Accepted

## Context

Shipyard deploys static sites (React, Vue, Svelte, etc.) that use client-side routing. When a user navigates to `/dashboard` directly, the browser requests that path from Caddy. If there is no literal file at `/dashboard`, Caddy returns 404. The SPA's `index.html` is never loaded, and client-side routing fails.

Vercel, Netlify, and similar platforms all implement SPA fallback — serving `index.html` on any 404 — as a core feature. Without it, every SPA with client-side routing is broken on first load of any non-root path.

## Decision

Configure Caddy to serve `index.html` on all 404 responses using the `try_files` equivalent in Caddy's file_server:

```json
{
  "routes": [
    {
      "match": [{ "host": ["myapp.bigboss.dev"] }],
      "handle": [
        {
          "handler": "reverse_proxy",
          "upstreams": [{ "dial": "garage:9000" }]
        }
      ],
      "errors": {
        "routes": [
          {
            "match": [{ "status": ["404"] }],
            "handle": [
              {
                "handler": "static_response",
                "body": "{http.reverse_proxy.upstream.buf}"
              }
            ]
          }
        ]
      }
    }
  ]
}
```

Simpler approach using Caddyfile:

```
myapp.bigboss.dev {
  reverse_proxy garage:9000
  handle_errors {
    rewrite * /index.html
    file_server
  }
}
```

The JSON config is sent to Caddy's `/config/` API endpoint at deploy time. Caddy automatically reloads and applies the new config.

## Consequences

- SPAs with React Router, Vue Router, etc. work correctly on first load of any route.
- No changes needed in the build pipeline or storage layer — purely a Caddy concern.
- The SPA fallback is configured at deploy time when sending config to Caddy's API.
- This is transparent to users — they don't need to configure anything. It's a platform default.
- Caddy's built-in auto-HTTPS with Let's Encrypt handles wildcard certs (`*.bigboss.dev`) automatically.
- One caveat: any genuine 404 (missing static asset like `logo.png`) will also return `index.html` with a 200 status. This is standard SPA behavior and client-side apps handle it gracefully.

## Alternatives Considered

- **No SPA fallback (rejected):** Would break every React/Vue app with client-side routing. Unacceptable for a static site platform.
- **SPA detection + conditional fallback (rejected):** Would require knowing if the app is an SPA. Too much complexity. Apply fallback universally — it doesn't hurt non-SPA static sites.
- **Nginx with error_page (rejected):** Nginx requires template-based config generation and `nginx -s reload`. Caddy's JSON API is simpler for code-driven systems and includes auto-HTTPS.

