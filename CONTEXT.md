# BigBoss — Domain Glossary

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

Auto-detection of the frontend framework by scanning `package.json` dependencies: `vite` → Vite, `react-scripts` → CRA, `next` → Next.js, `vue` → Vue. User can override any detected value.

### Build Step

An individual phase in the deployment pipeline:

1. **Clone** — `git clone --depth 1`
2. **Install** — `npm install`
3. **Build** — `npm run build`
4. **Verify** — check output directory exists and is not empty
5. **Upload** — sync output to object storage

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

Each build runs in an isolated `node:18-bullseye` Docker container with 2GB memory limit and a 15-minute timeout. On success or failure, the container is immediately removed (`docker rm -f`). Logs are extracted before removal.

## Storage & Routing

### Object Storage

S3-compatible blob storage for deployed artifacts. Abstracted behind an `uploadToObjectStorage()` interface using the AWS S3 SDK with `forcePathStyle: true`. Garage for local dev; Garage (self-hosted) or Cloudflare R2 for production. No hardcoded S3-specific logic.

### S3 Path Structure

`/users/{userId}/apps/{appId}/deployments/{deploymentId}/{filepath}`

### Deployment Retention

The newest 5 deployments per App are kept in object storage. Older deployments are deleted automatically after each successful deploy. Enables rollback without unlimited storage growth.

### Active Deployment

The currently-live Deployment for an App, referenced by `active_deployment_id` in the App record. Rollback changes this pointer without modifying object storage.

### SPA Fallback

Every `404` response from Caddy returns `index.html`, enabling client-side routing in React, Vue, and similar SPAs.

### Caddy Config Generation

Dynamic Caddy configuration via JSON API at deploy time (not at request time). Config is sent to Caddy's `/config/` API endpoint. After update, Caddy automatically reloads. Built-in auto-HTTPS with Let's Encrypt for wildcard certs.

## Infrastructure Philosophy

### Deployment Control Plane

BigBoss is a **deployment control plane**, not a SaaS hosting product. The platform orchestrates builds and routes traffic; it does not enforce business-layer constraints (quotas, billing, per-user rate limits). The only constraints are infrastructure-level: container memory (2GB), build timeout (15 min), and max concurrent builds (worker count). Resource usage is visible to users; blocking only occurs if the system is in genuine danger.

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

