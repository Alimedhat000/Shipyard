# ADR-0003: MinIO as Primary Storage with S3-Compatible Abstraction
## Status
Accepted

## Context
AWS S3 is the default choice for blob storage, but it introduces dependencies (AWS account, IAM credentials, billing) that are friction for a self-hosted project. For local development and self-hosting, MinIO provides an S3-compatible API with no external dependencies. The storage layer must support both without code changes.

## Decision
- **Storage abstraction:** All storage operations go through a single interface — `uploadToObjectStorage()`. The underlying provider (MinIO or AWS S3) is configured at deployment time via environment variables.
- **Local dev:** MinIO in Docker Compose (same compose file as API, worker, Redis, Postgres).
- **Production:** AWS S3 (or compatible: MinIO on a real server, DigitalOcean Spaces, Backblaze B2).
- **Key SDK option:** `forcePathStyle: true` — required for MinIO. AWS S3 works with either style.
- **Nginx routing:** Changes only the `proxy_pass` target. No business logic changes when swapping providers.

## Consequences
- Developers can run the full stack locally with no cloud account.
- Production can use managed S3 without code changes.
- `forcePathStyle` is easy to forget — must be documented and tested in both environments.
- No CDN in front of MinIO (MVP). S3 + CloudFront is the v2 production path.
- MinIO availability means no automatic durability. The operator manages backups. Acceptable for a self-hosted tool.

## Alternatives Considered
- **AWS S3 only (rejected):** Would require every developer to have an AWS account and set up billing before writing a line of code. Too much friction.
- **Local filesystem (rejected):** Would break Nginx routing and complicate rollback.
- **Storage Interface pattern (rejected for MVP):** Extra abstraction for a project that likely won't swap providers mid-life.