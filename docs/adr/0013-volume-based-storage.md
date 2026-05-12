# ADR-0013: Volume-Based Storage for Static File Serving
## Status
Accepted
## Context
The original design (ADR-0003) used Garage (S3-compatible storage) as the primary storage layer, with Caddy reverse-proxying to Garage's S3 API. This introduced complexity:

1. **S3 authentication**: Garage's S3 API requires signed requests. Caddy's reverse proxy cannot add S3 signatures, making the proxy approach unreliable without additional auth mechanisms.

2. **Garage cluster management**: Requires layout assignment, key creation, bucket permissions, and bootstrap scripts for persistence across restarts.

3. **Multiple ports**: S3 API (3900), RPC (3901), Admin API (3903), Web API (3902) - each requires configuration and networking.

For a self-hosted deployment platform serving static sites, this adds unnecessary operational overhead.

## Decision
- **Storage**: Use a shared Docker named volume (`shipyard_sites`) mounted in both the worker and Caddy containers.
- **Upload**: After build, worker copies output to `/var/lib/shipyard/sites/{appId}/`.
- **Serving**: Caddy uses `file_server` handler pointing to the app's directory - no proxy, no auth.
- **Retention**: Not implemented for volume storage. Each deploy overwrites the previous (latest deployment always live).

## Architecture
```
Worker builds → copies to shared volume → Caddy serves via file_server
```

### Docker Compose
```yaml
volumes:
  shipyard_sites:

services:
  worker:
    volumes:
      - shipyard_sites:/var/lib/shipyard/sites

  caddy:
    volumes:
      - shipyard_sites:/var/lib/shipyard/sites:ro
```

### Caddy Route (per-app)
```json
{
  "@id": "app-{appId}",
  "match": [{ "host": ["{domain}"] }],
  "handle": [{
    "handler": "file_server",
    "root": "/var/lib/shipyard/sites/{appId}"
  }],
  "terminal": true
}
```

For SPAs: use subroute with error fallback to rewrite to `/index.html`.

## Consequences
- **Pros:**
  - Zero auth complexity - Caddy reads directly from filesystem
  - Simple deployment - no Garage cluster to manage
  - Fast serving - filesystem I/O vs network round-trip to S3
  - No retention needed - latest deployment always serves

- **Cons:**
  - No built-in redundancy - volume is server-local
  - No content hashing/deduplication (schema exists but unused)
  - Rollback loses previous deployment's files (only DB pointer changes)

## Alternatives Considered
- **Garage with Web API (port 3902)**: Requires `root_domain` config, bucket website flag, host header manipulation in Caddy - fragile.
- **Garage S3 with pre-signed URLs**: Requires generating signed URLs per request - complex and slow.
- **MinIO**: Same S3 auth complexity as Garage.

## Related
- Supersedes [ADR-0003](./0003-garage-primary-storage.md)