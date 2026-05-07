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

### Framework Detection

Handled by the **BuildPack** abstraction (`docs/adr/0012-build-pack-abstraction.md`). User selects a build pack at app creation time:

- **`static`** — nginx:alpine. No detection. User provides output directory. Assets copied into image.
- **`dockerfile`** — User provides Dockerfile in repo. No detection. Shipyard builds it.
- **`nixpacks`** — Nixpacks auto-detects framework from repo contents (Node, Python, Go, Rust, etc.) and generates a Dockerfile. User can override build/start commands.

### Build Step

An individual phase in the deployment pipeline. The exact steps depend on the **build pack**:

**Static build pack:**
1. **Clone** — `git clone --depth 1`
2. **Build** — optional user-defined build command (e.g., `npm run build`)
3. **Verify** — check output directory exists and not empty
4. **Package** — copy assets into nginx:alpine image

**Dockerfile build pack:**
1. **Clone** — `git clone --depth 1`
2. **Docker build** — `docker build -f Dockerfile`
3. **Run** — start container, route traffic

**Nixpacks build pack:**
1. **Clone** — `git clone --depth 1`
2. **Detect** — `nixpacks detect .` to detect framework
3. **Docker build** — Nixpacks generates Dockerfile, then `docker build`
4. **Run** — start container, route traffic

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

Depends on the build pack:

- **Static:** Build runs in a temporary build container (user-defined image or default). Output is packaged into an `nginx:alpine` runtime image. Long-lived.
- **Dockerfile:** User's Dockerfile is built. Resulting image runs as a long-lived container.
- **Nixpacks:** Nixpacks generates a Dockerfile. Image is built and runs as a long-lived container.

All build containers have a 15-minute timeout. Runtime containers (static, dockerfile, nixpacks) are long-lived with health checks and automatic restarts.

## Storage & Routing

### Object Storage

S3-compatible blob storage for deployed artifacts. Abstracted behind an `uploadToObjectStorage()` interface using the AWS S3 SDK with `forcePathStyle: true`. Garage for local dev; Garage (self-hosted) or Cloudflare R2 for production. No hardcoded S3-specific logic.

### S3 Path Structure

`/users/{userId}/apps/{appId}/deployments/{deploymentId}/{filepath}`

### Deployment Retention

The newest 5 deployments per App are kept in object storage. Older deployments are deleted automatically after each successful deploy. Enables rollback without unlimited storage growth.

### Deployment Retention Rules

- Keep metadata in database forever (deployments table, build_jobs table, deployment_logs)
- Delete files from object storage only (after successful deploy)
- Check before deleting: if deployment.id == app.active_deployment_id, skip delete
- Deletion is async background job (queued after deploy succeeds)

### Active Deployment

The currently-live Deployment for an App, referenced by `active_deployment_id` in the App record. Rollback changes this pointer without modifying object storage.

### SPA Fallback

Every `404` response from Caddy returns `index.html`, enabling client-side routing in React, Vue, and similar SPAs.

### Caddy Config Generation

Dynamic Caddy configuration via JSON API at deploy time (not at request time). Config is sent to Caddy's `/config/` API endpoint. After update, Caddy automatically reloads. Built-in auto-HTTPS with Let's Encrypt for wildcard certs.

## Infrastructure Philosophy

### Deployment Control Plane

Shipyard is a **deployment control plane**, not a SaaS hosting product. The platform orchestrates builds and routes traffic; it does not enforce business-layer constraints (quotas, billing, per-user rate limits). The only constraints are infrastructure-level: container memory (2GB), build timeout (15 min), and max concurrent builds (worker count). Resource usage is visible to users; blocking only occurs if the system is in genuine danger.

### Self-Hosted Model

Intended to run on a single server or small cluster via Docker Compose. Multi-tenant isolation is achieved by deploying multiple instances, not by serving multiple organizations from one deployment. No SaaS billing layer exists or will exist.

## Queue & Execution

### Queue (BullMQ)

Redis-backed job queue via BullMQ. A Job contains only the `deployment_id`; all build context is fetched from the database by the Worker. BullMQ handles retries (with exponential backoff), locking, concurrency limits, and dead-letter tracking.

### Worker

A Node.1.js process that connects to BullMQ, picks up Jobs, executes the build pipeline, updates Deployment status in the database, and regenerates the Caddy config. Stateless per-job execution.

### Heartbeat

Workers write a heartbeat to Redis. If the heartbeat disappears, the Worker is considered dead and its locks are released.

## Security

### Env Var Encryption

AES-256-GCM encryption. Key stored in a server environment variable (never in the database). Encrypt before inserting to the database. Decrypt before injecting into the build container. Values are masked in API responses.

### Webhook Validation

GitHub webhook payloads are validated by the `X-Hub-Signature-256` header (HMAC SHA-256). Unsigned webhooks are rejected.

### Path Validation

The configured output directory is validated: no path traversal (`..`), no absolute paths (`/`), must be a relative subdirectory. Prevents path traversal attacks during artifact extraction.

