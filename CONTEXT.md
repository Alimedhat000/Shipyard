# Shipyard — Domain Glossary

## Core Entities

### App

A deployed application owned by an Organization. Contains build configuration (build command, output directory, framework, env vars) and a pointer to the active Deployment. User-facing control surface.

### Deployment

A single build-and-deploy event for an App. Tracks status through the build pipeline, stores commit metadata, and holds a reference to the output artifacts in storage.

### Build Job

The execution layer for a Deployment. A Build Job is a queue entry processed by a Worker. Separating Build Job from Deployment allows safe retries, worker scaling, and independent state tracking.

### Organization

A tenant unit. Every User belongs to exactly one Organization (their personal org in MVP). The Organization owns Apps, which own Deployments. Schema supports teams; UI is single-user in MVP.

### Environment Variable

A key-value pair attached to an App, injected into the build container at build time. Values are encrypted with AES-256 (key in server environment variable, not in database).

### App Slug

A URL-safe identifier derived from the App name, used for routing (`myapp.bigboss.dev`).

## Build Pipeline

### Build Pack

Handled by the **BuildPack** abstraction (`docs/adr/0012-build-pack-abstraction.md`). User selects a build pack at app creation time (PostgreSQL enum):

| Pack | Description |
|------|-------------|
| `nixpacks` | Nixpacks auto-detects framework and generates Dockerfile |
| `static` | nginx:alpine serves pre-built static assets |
| `dockerfile` | User-provided Dockerfile, Shipyard builds and runs |
| `dockercompose` | User-provided docker-compose.yml, multi-service stack |
| `dockerimage` | Pull a pre-built image from a registry and run it |

### Build Step

The deployment pipeline varies by **build pack**:

| Pack | Steps |
|------|-------|
| **nixpacks** | Clone → `nixpacks build .` (generates Dockerfile) → `docker build` → run |
| **static** | Clone → (optional build command) → copy assets to nginx:alpine → run |
| **dockerfile** | Clone → `docker build -f Dockerfile` → run |
| **dockercompose** | Clone → `docker compose up -d` |
| **dockerimage** | `docker pull <image>` → run (no clone) |

### Output Directory Verification Rules

- Check directory exists
- Check directory contains at least 1 file (any type, excluding dotfiles like .gitkeep)
- Recursive check: if dist/ has subdirectories with files, that's valid
- If empty: fail with "Output directory 'dist/' is empty. Verify your build command."

### Step-Aware Failure Handling

A retry policy where each Build Step has its own failure classification:

- **Retryable** — network timeout, transient errors (git clone, npm install network)
- **User error** — exit code 128 (auth), npm 404, build non-zero (no retry)
- **System error** — ENOSPC (disk full), S3 403 credentials (fail all, alert ops)

### Worker Pool

A pool of 2–3 concurrent Workers that pull Build Jobs from BullMQ. Concurrency = 1 per worker (one build at a time per worker). Workers are identical; any worker can pick up any job.

### Rapid Push Debounce

When multiple git pushes arrive for the same App, the pending Build Job is cancelled and only the latest commit is built. Prevents wasted compute on superseded commits. Matches Vercel / Netlify behavior.

### Shallow Clone

`git clone --depth 1` to minimize clone time and bandwidth. Full history is not needed for static site deployments.

### Container Lifecycle

All five build packs produce long-lived containers with health checks and automatic restarts:

| Pack | Build Phase | Runtime |
|------|-------------|---------|
| **nixpacks** | Temporary build container (15m timeout) | Long-lived from generated Dockerfile |
| **static** | Temporary build container | `nginx:alpine` serving assets |
| **dockerfile** | `docker build` on host | User's image |
| **dockercompose** | Multi-container stack | Compose-managed lifecycle |
| **dockerimage** | No build (just pull) | Pre-built image from registry |

## Storage & Routing

### Volume-Based Storage

A shared Docker named volume (`shipyard_sites`) mounted in the worker and Caddy containers. Each deployment's build output lives at `sites/{appId}/{deploymentId}/`. A symlink at `sites/{appId}/current` points to the active deployment. Caddy's `file_server` root is permanently `sites/{appId}/current`.

### Symlink Activation

A symlink at `sites/{appId}/current` points to the currently-active deployment's artifact directory. Swap the symlink atomically on deploy or rollback — no Caddy API call needed. Caddy root is set once at first deploy and never changes.

### Deployment Retention

After each successful deploy, the newest `KEEP_COUNT` (default 5) deployment subdirectories per App are kept. Older directories are deleted. Building deployments are excluded from pruning. Pruned deployments have `prunedAt` set in the database for queryable rollback eligibility.

### Active Deployment

The currently-live Deployment for an App, referenced by `active_deployment_id` in the App record. Rollback changes this pointer AND swaps the `current` symlink to the target deployment's artifact directory. See ADR-0014.

### SPA Fallback

Every `404` response from Caddy returns `index.html`, enabling client-side routing in React, Vue, and similar SPAs.

### Caddy Config Generation

Dynamic Caddy configuration via JSON API at deploy time (not at request time). Config is sent to Caddy's `/config/` API endpoint. After update, Caddy automatically reloads. Built-in auto-HTTPS with Let's Encrypt for wildcard certs.

For static sites, Caddy config is set once at first deploy (root: `sites/{appId}/current`). Subsequent deploys and rollbacks update the symlink — no Caddy API call needed. See ADR-0014.

## Infrastructure Philosophy

### Deployment Control Plane

Shipyard is a **deployment control plane**, not a SaaS hosting product. The platform orchestrates builds and routes traffic; it does not enforce business-layer constraints (quotas, billing, per-user rate limits). The only constraints are infrastructure-level: container memory (2GB), build timeout (15 min), and max concurrent builds (worker count). Resource usage is visible to users; blocking only occurs if the system is in genuine danger.

### Self-Hosted Model

Intended to run on a single server or small cluster via Docker Compose. Multi-tenant isolation is achieved by deploying multiple instances, not by serving multiple organizations from one deployment. No SaaS billing layer exists or will exist.

## Queue & Execution

### Queue (BullMQ)

Redis-backed job queue via BullMQ. A Job contains only the `deployment_id`; all build context is fetched from the database by the Worker. BullMQ handles retries (with exponential backoff), locking, concurrency limits, and dead-letter tracking.

### Worker

A Node.js process that connects to BullMQ, picks up Jobs, executes the build pipeline, updates Deployment status in the database, and generates Caddy config on first deploy (static sites) or on every deploy (server containers). Stateless per-job execution.

### Heartbeat

Workers write a heartbeat to Redis. If the heartbeat disappears, the Worker is considered dead and its locks are released.

## Security

### Env Var Encryption

AES-256-GCM encryption. Key stored in a server environment variable (never in the database). Encrypt before inserting to the database. Decrypt before injecting into the build container. Values are masked in API responses.

### Webhook Validation

GitHub webhook payloads are validated by the `X-Hub-Signature-256` header (HMAC SHA-256). Unsigned webhooks are rejected.

### Path Validation

The configured output directory is validated: no path traversal (`..`), no absolute paths (`/`), must be a relative subdirectory. Prevents path traversal attacks during artifact extraction.

