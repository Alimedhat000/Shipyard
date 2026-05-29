# ADR-0013: Volume-Based Storage for Static File Serving
## Status
Accepted (updated by ADR-0014)
## Context
The original design (ADR-0003) used Garage (S3-compatible storage) as the primary storage layer, with Caddy reverse-proxying to Garage's S3 API. This introduced complexity:

1. **S3 authentication**: Garage's S3 API requires signed requests. Caddy's reverse proxy cannot add S3 signatures, making the proxy approach unreliable without additional auth mechanisms.

2. **Garage cluster management**: Requires layout assignment, key creation, bucket permissions, and bootstrap scripts for persistence across restarts.

3. **Multiple ports**: S3 API (3900), RPC (3901), Admin API (3903), Web API (3902) - each requires configuration and networking.

For a self-hosted deployment platform serving static sites, this adds unnecessary operational overhead.

## Decision
- **Storage**: Use a shared Docker named volume (`shipyard_sites`) mounted in both the worker and Caddy containers.
- **Upload**: After build, worker copies output to `/var/lib/shipyard/sites/{appId}/{deploymentId}/`.
- **Activation**: A symlink at `sites/{appId}/current` points to the active deployment's directory. Swap the symlink on rollback or re-deploy.
- **Serving**: Caddy's `file_server` root points to `sites/{appId}/current` — set once at first deploy, unchanged on rollback.
- **Retention**: Per-deployment subdirectories are pruned after each successful deploy (keep newest `KEEP_COUNT`, default 5). Building deployments excluded.

## Architecture
```
Worker builds → extracts to sites/{appId}/{deploymentId}/
  → ln -sfn {deploymentId} current → Caddy serves via sites/{appId}/current
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

### Symlink layout
```
sites/{appId}/
├── current/                  → symlink to active deployment
├── {deploymentIdX}/          → files from deployment X
├── {deploymentIdY}/          → files from deployment Y (pruned after KEEP_COUNT)
└── ...
```

### Caddy Route (per-app)
```json
{
  "@id": "app-{appId}",
  "match": [{ "host": ["{domain}"] }],
  "handle": [{
    "handler": "file_server",
    "root": "/var/lib/shipyard/sites/{appId}/current"
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
  - Symlink activation — atomic, no Caddy API call on rollback per ADR-0014
  - Per-deployment artifact isolation — immutable historical builds

- **Cons:**
  - No built-in redundancy - volume is server-local
  - No content hashing/deduplication (schema exists but unused)
  - Per-deployment retention requires pruning (background job per deploy)

## Alternatives Considered
- **Garage with Web API (port 3902)**: Requires `root_domain` config, bucket website flag, host header manipulation in Caddy - fragile.
- **Garage S3 with pre-signed URLs**: Requires generating signed URLs per request - complex and slow.
- **MinIO**: Same S3 auth complexity as Garage.

## Related
- Supersedes [ADR-0003](./0003-garage-primary-storage.md)