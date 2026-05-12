# ADR-0003: Garage as Primary Storage with S3-Compatible Abstraction
## Status
Superseded by [ADR-0013](./0013-volume-based-storage.md)
## Context
While AWS S3 is a standard for blob storage, it introduces dependencies (AWS account, IAM credentials, billing) that are friction for a self-hosted project. For local development and self-hosted consistency, Garage provides an S3-compatible API with no external dependencies. The storage layer must support both without code changes.
## Decision
- **Storage abstraction:** All storage operations go through `uploadToObjectStorage()`. Provider (Garage or AWS S3) configured at deployment time via environment variables.
- **Local dev:** Garage in Docker Compose (same compose file as API, worker, Redis, Postgres).
- **Production:** Garage (self-hosted) or Cloudflare R2.
- **Key SDK option:** `forcePathStyle: true` — required for Garage. AWS S3 works with either style.
- **Caddy routing:** Only `reverse_proxy` target changes. No business logic changes when swapping providers.
## Consequences
- Developers can run the full stack locally with no cloud account.
- Production swaps to Cloudflare R2 without code changes.
- `forcePathStyle` is easy to forget — must be in docs and tested in both environments.
- No CDN in front of Garage (MVP). CloudFront is the v2 path.
- Garage has no automatic durability. Operator manages backups. Acceptable for a self-hosted tool.
## Alternatives Considered
- **AWS S3 only (rejected):** Requires every dev to have an AWS account before writing code.
- **MinIO (rejected):** Garage is more actively maintained for self-hosted use cases.
- **Local filesystem (rejected):** Breaks Caddy routing and complicates rollback.