# BigBoss — Self-Hosted Deployment Control Plane

## Problem Statement

Self-hosting static sites is painful. Existing tools either lock you into a SaaS with quotas and billing, or require deep DevOps knowledge. There is no self-hosted option that gives developers a simple control plane for deploying static sites without business-layer complexity. Coolify exists but is complex. Developers want something leaner — a focused deployment orchestrator for static runtimes, runnable anywhere.

## Solution

BigBoss is a self-hosted deployment control plane for static sites. It clones GitHub repos, runs builds in isolated Docker containers, uploads output to Garage, and routes traffic via Caddy. It is not a SaaS product — there are no quotas, no billing, no per-user limits. The only constraints are infrastructure-level (CPU, memory, disk). It is a Coolify-inspired deployment orchestrator scoped strictly to static sites.

## User Stories

### Authentication & Access

1. As a developer, I want to sign in with GitHub OAuth, so that I can access my repos without managing yet another password.
2. As a developer, I want my GitHub token stored after OAuth, so that the platform can clone my repos automatically.
3. As a developer, I want my GitHub token validated before cloning, so that I don't waste a build cycle on an invalid token.
4. As a developer, I want each user to implicitly have an organization, so that multi-tenant schema is ready when teams are added later.
5. As a developer, I want my GitHub OAuth scopes to be `repo` + `read:user`, so that the platform has the minimum access needed.
6. As a developer, I want app names to be scoped to my organization, so that two different users can both have an app named "myapp".

### App Management

1. As a developer, I want to create an app by connecting a GitHub repo, so that I can deploy it immediately.
2. As a developer, I want the platform to auto-detect my framework (Vite, CRA, Next.js, Vue), so that build command and output directory are pre-filled.
3. As a developer, I want to override the detected framework, build command, and output directory, so that I can handle non-standard setups.
4. As a developer, I want to configure environment variables per app, so that secrets and config values are available at build time.
5. As a developer, I want environment variables encrypted at rest (AES-256, key in env var), so that secrets are not stored in plaintext.
6. As a developer, I want to see my apps on a dashboard with last deployment status, so that I can quickly see what is deployed.
7. As a developer, I want to delete an app, so that I can clean up unused projects. Deleting an app removes all deployments from Garage storage and database records.

### Deployments

1. As a developer, I want to trigger a manual deploy from the latest commit, so that I can test changes immediately.
2. As a developer, I want to see a list of all deployments for an app, so that I can track history.
3. As a developer, I want to see streaming build logs in the UI, so that I can debug failures without leaving the browser.
4. As a developer, I want to cancel an in-progress build, so that I can stop a bad deploy.
5. As a developer, I want to retry a failed deployment, so that I can recover from transient errors.
6. As a developer, I want to rollback to a previous successful deployment, so that I can revert a broken release instantly.
7. As a developer, I want to see build metadata (commit SHA, message, duration, worker ID), so that I know exactly what was deployed.

### CI/CD — Auto-Deploy

1. As a developer, I want GitHub webhooks to auto-trigger deploys on push, so that I don't have to manually deploy after every commit.
2. As a developer, I want to select which branch triggers deploys, so that I can control when things go live (default: `main`).
3. As a developer, I want webhook payloads validated by GitHub signature, so that fake deploys cannot be triggered.
4. As a developer, I want rapid pushes to cancel the previous pending build and only deploy the latest commit, so that stale builds are not wasting resources.
5. As a developer, I want webhook registration to happen automatically via GitHub API after OAuth, so that I don't have to configure it manually.

### Build Pipeline

1. As a developer, I want my build to run in an isolated Docker container (`node:18-bullseye`), so that builds don't interfere with each other.
2. As a developer, I want native dependencies (sharp, node-gyp) to compile, so that common image processing libraries work.
3. As a developer, I want the build command and output directory to come from my app settings, so that the platform is flexible.
4. As a developer, I want the platform to verify the output directory exists and is not empty after build, so that silent failures are caught with clear error messages.
5. As a developer, I want builds to warn if Next.js SSR is detected (after build), so that I know to use static export mode.
6. As a developer, I want path traversal in the output directory config blocked (`..`, leading `/`), so that the system cannot be tricked into extracting outside the project.
7. As a developer, I want build logs saved to the database, so that they are available after the build completes.
8. As a developer, I want to set a build timeout (15 min default), so that hung builds don't block the queue forever.

### Step-Aware Failure Handling

1. As a developer, I want git clone failures on network timeout to retry up to 3 times with exponential backoff, so that transient network blips don't fail my deploy.
2. As a developer, I want git clone failures with exit code 128 (auth/not found) to fail immediately without retry, so that bad tokens/repos are caught fast.
3. As a developer, I want npm install failures on "404 Not Found" to fail immediately without retry, so that bad package names are caught fast.
4. As a developer, I want npm install failures on network timeout to retry up to 3 times, so that transient registry issues don't fail my deploy.
5. As a developer, I want npm install failures on ENOSPC (disk full) to alert ops and fail all builds, so that I know when the build worker is out of disk.
6. As a developer, I want npm run build failures to fail immediately without retry, so that my code errors are surfaced immediately.
7. As a developer, I want build failures with OOM (heap out of memory) to fail with a clear message about memory limits, so that I know to optimize my build.
8. As a developer, I want S3 upload failures on network timeout to retry 3 times, so that transient storage issues don't fail my deploy.
9. As a developer, I want S3 upload failures with bad credentials (403) to alert ops and fail all builds, so that credential issues are caught and fixed.

### Container Lifecycle

1. As a platform operator, I want successful containers to be removed immediately (`docker rm -f`) after dist extraction, so that disk space is reclaimed.
2. As a platform operator, I want failed containers to have logs saved before removal, so that debugging is possible.
3. As a platform operator, I want zombie containers to be killed on worker startup, so that a crashed server doesn't leave orphaned containers.
4. As a platform operator, I want new containers spun up for retries, so that fresh state is used.
5. As a platform operator, I want each worker to run at most 1 concurrent build (concurrency = 1 in BullMQ), so that resource usage is bounded.

### Storage & Rollback

1. As a developer, I want my deployed files stored in Garage under `/users/{userId}/apps/{appId}/deployments/{deploymentId}/`, so that every deployment is isolated and addressable.
2. As a developer, I want the platform to keep the newest 5 deployments and delete older ones automatically, so that rollback is possible without unlimited storage growth.
3. As a developer, I want rollback to update the active deployment pointer in the database, so that Caddy can route to the correct deployment.
4. As a platform operator, I want Caddy config to be regenerated at deploy time (not at request time), so that routing is fast and DB-free.
5. As a developer, I want all deploys on `*.bigboss.dev` to route via Caddy to the correct S3 prefix, so that my app is accessible at a predictable URL.
6. As a platform operator, I want Caddy config generated from templates with string replacement, so that the system stays simple.
7. As a developer, I want SPA fallback (every 404 serves index.html), so that client-side routing works in my React/Vue app.
8. As a developer, I want the platform to store content hashes in a DB table (`deployment_files`) for future deduplication, so that the schema is ready when hashing is added.

### Queue & Workers

1. As a platform operator, I want jobs queued in Redis via BullMQ, so that a crash doesn't lose pending jobs.
2. As a platform operator, I want job data to be just the `deployment_id`, so that the job is stateless and workers can fetch state from the database.
3. As a platform operator, I want BullMQ to handle locking, retries, and concurrency, so that we don't reimplement queue primitives.
4. As a platform operator, I want a worker pool of 2–3 concurrent workers, so that multiple builds can run in parallel.
5. As a platform operator, I want failed jobs (after max retries) visible in the UI with a manual retry option, so that I can recover from edge cases.
6. As a platform operator, I want all workers to be identical (no specialized workers), so that any worker can pick up any job.

### Observability

1. As a platform operator, I want structured JSON logs to stdout, so that Docker can aggregate them.
2. As a platform operator, I want a `/health` endpoint on the API, so that load balancers can check health.
3. As a platform operator, I want workers to heartbeat to Redis, so that dead workers are detectable.
4. As a platform operator, I want metrics tracked (deployments/hour, success/fail rate, build duration, queue depth), so that I can monitor the system without a complex observability stack.

### Local Dev

1. As a developer, I want all services (API, worker, Redis, Postgres, Garage, Caddy) in a single Docker Compose file, so that onboarding is frictionless.
2. As a developer, I want database migrations via Drizzle, so that schema changes are versioned and reproducible.
3. As a developer, I want all environment variables validated via Zod against a `.env.example`, so that missing config is caught early.
4. As a developer, I want the API to hot-reload on code changes, so that I can iterate quickly.
5. As a developer, I want the worker to restart on code changes and cancel in-flight jobs (dev only), so that new code is picked up without zombie builds.

## Implementation Decisions

### Architecture

- **Control plane philosophy.** BigBoss is a self-hosted deployment control plane, not a SaaS product. There are no business-layer limits (quotas, billing, per-user storage caps, per-app rate limits). The only constraints are infrastructure-level: container memory limit (2GB), build timeout (15 min), and max concurrent builds = worker count. Resource visibility (usage dashboard) is provided; blocking only happens if the system is in genuine danger.

- **Separation of concerns.** The logical layer (deployments, rollback, app settings) is separate from the execution layer (build_jobs, queue). This allows safe retries, worker scaling, and independent state tracking.

- **Storage abstraction.** The storage layer is abstracted behind an S3-compatible interface (`uploadToObjectStorage()`). This allows swapping Garage for AWS S3 in production without changing business logic.

### Modules

1. **API Server** — Express/Fastify REST API. Auth via GitHub OAuth + session cookies stored in Redis. Endpoints for apps, deployments, envvars, logs. No business logic here — delegates to service layer.

2. **Worker** — Node.js process pulling from BullMQ. Fetches deployment from DB, clones GitHub repo, runs Docker container, extracts output, uploads to Garage, updates deployment status, regenerates Caddy config. Stateless job processing.

3. **Deployment Engine** — Core service layer. Orchestrates the build lifecycle. Handles step sequencing, error classification, retry logic, log streaming.

4. **Queue Manager** — Wrapper around BullMQ. Job creation, worker registration, lock management, retry orchestration.

5. **GitHub Service** — OAuth flow, token management, repo access validation, webhook registration, webhook signature validation.

6. **Build Container Manager** — Docker container lifecycle (create, start, exec, logs, kill, rm). Handles timeouts and cleanup.

7. **Storage Service** — S3-compatible uploads. Handles retries, manifest tracking.

8. **Caddy Config Manager** — JSON API config generation. Sends config to Caddy's `/config/` endpoint. Caddy auto-reloads with built-in auto-HTTPS.

9. **EnvVar Service** — AES-256 encryption/decryption. Injects vars into build container at build time.

10. **Database Layer** — Drizzle ORM. Migrations, schema, query helpers.

### Schema

```
users
  id (UUID, PK)
  github_id (UNIQUE)
  username
  avatar_url
  created_at

organizations
  id (UUID, PK)
  name
  created_at

organization_members
  id (UUID, PK)
  organization_id (FK)
  user_id (FK)
  role
  created_at

apps
  id (UUID, PK)
  organization_id (FK)
  name
  description
  github_repo
  branch
  framework
  build_command
  output_directory
  auto_deploy (boolean)
  active_deployment_id (FK → deployments, nullable)
  created_at
  updated_at

deployments
  id (UUID, PK)
  app_id (FK)
  status (pending | building | success | failed | cancelled)
  commit_sha
  commit_message
  branch
  deployed_at
  started_at
  finished_at

build_jobs
  id (UUID, PK)
  deployment_id (FK)
  status
  attempts
  worker_id
  started_at
  finished_at

deployment_logs
  id (UUID, PK)
  deployment_id (FK)
  content (TEXT)
  created_at

env_vars
  id (UUID, PK)
  app_id (FK)
  key
  value (encrypted)
  is_secret
  created_at

deployment_files (v2 hashing — schema ready, not implemented)
  id (UUID, PK)
  deployment_id (FK)
  file_path
  content_hash (SHA-256)
  file_size

domains (future — schema ready, not implemented)
  id (UUID, PK)
  app_id (FK)
  domain
  is_primary
  created_at
```

### API Contract

```
POST /auth/github              → GitHub OAuth redirect
GET  /auth/github/callback     → Session cookie, redirect to dashboard
GET  /auth/me                 → Current user

GET  /apps                    → List org's apps
POST /apps                    → Create app (connect repo)
GET  /apps/:id               → App details
PUT  /apps/:id               → Update settings
DELETE /apps/:id             → Delete app

GET  /apps/:id/deployments     → List app's deployments
POST /apps/:id/deployments    → Trigger deploy
GET  /deployments/:id         → Deployment details + status
GET  /deployments/:id/logs   → Full build logs
POST /deployments/:id/cancel → Cancel in-progress build
POST /deployments/:id/retry  → Retry failed deployment
POST /deployments/:id/rollback → Rollback to this deployment

GET  /apps/:id/envvars        → List env vars (values masked)
POST /apps/:id/envvars       → Create env var
PUT  /apps/:id/envvars/:id   → Update env var
DELETE /apps/:id/envvars/:id → Delete env var

GET  /health                 → Health check
```

### Build Pipeline Flow

```
1. Queue deployment job (deployment_id)
2. Worker picks up job
3. Update status: pending → building
4. Clone repo (git clone --depth 1)
   - Network timeout → retry 3x (exp backoff: 2s, 4s, 8s)
   - Auth error (128) → fail immediately
5. Inject env vars into container
6. npm install
   - Network timeout → retry 3x
   - 404 Not Found → fail immediately
   - ENOSPC → system alert, fail all
7. npm run build
   - Any non-zero exit → fail immediately
8. Verify output directory exists and is not empty
9. Upload to Garage (full upload in MVP)
10. Keep newest 5 deployments, delete older ones
11. Update active_deployment_id in apps
12. Send config to Caddy API (auto-reloads)
13. Update status: success
14. docker rm -f (container)
```

### Caddy Configuration

- Server blocks for `*.bigboss.dev` via Caddy's built-in auto-HTTPS (Let's Encrypt)
- `reverse_proxy` to Garage endpoint
- SPA fallback: Caddy `handle_errors` with rewrite to `/index.html`
- JSON API config sent to `http://caddy:2019/config/`
- S3 path style: `http://garage:9000/bucket/users/.../`

### Docker Container

- Image: `node:18-bullseye`
- Pre-installed: node, npm, git, build-essential, python3
- Network: host or bridge (configurable)
- Memory: 2GB limit
- Timeout: 15 min (kill + fail if exceeded)
- Cleanup: `docker rm -f` on success or failure
- Startup: git clone → npm install → npm run build → extract dist

### Env Var Encryption

- Algorithm: AES-256-GCM
- Key: stored in server environment variable (not in database)
- Encrypt before insert, decrypt before container injection
- Zod schema validates env var keys (alphanumeric + underscore only)

## Testing Decisions

- **Test external behavior only.** Do not test BullMQ internals, Docker SDK calls, or Garage SDK calls. Mock these at the boundary.
- **Good tests:** Queue job creation → verify job in Redis. Trigger deploy → verify deployment status in DB. Build success → verify Garage upload, Caddy config update, status transition.
- **Modules to test in isolation:**
  - Step-aware retry logic (Deployment Engine)
  - Env var encryption/decryption
  - Path traversal validation
  - Webhook signature validation
  - Caddy config template generation
  - Framework auto-detection
- **No tests in MVP:** Docker container exec, GitHub API calls, Garage uploads (these require integration test environments)

## Out of Scope

The following are explicitly excluded from MVP and planned for v2 or later:

- Custom domains and SSL automation (Let's Encrypt)
- Webhook notifications for deployment events (email, Slack, external HTTP)
- Teams and organization permissions UI (schema exists, but single-user only)
- Content hashing for upload deduplication (schema ready, not implemented)
- CI/CD previews per branch / PR preview deployments
- Usage analytics dashboards and graphs
- Billing or payment layer (self-hosted, no SaaS)
- Per-user storage quotas or deploy rate limits
- OpenTelemetry or distributed tracing
- Database-level audit logging

## Further Notes

### v2 Expansion Path

After MVP, the natural expansion is:

- **v2:** Custom domains + Let's Encrypt, webhook notifications, content hashing
- **v3:** Teams + permissions, branch preview URLs, usage analytics

### Self-Hosted Model

BigBoss is designed to be self-hosted. The deployment target is a single server or small cluster (docker-compose up). There is no multi-tenant SaaS isolation layer — each self-hosted instance serves one organization. Multi-tenancy is achieved by deploying multiple instances, not by serving multiple organizations from one deployment.

### Interview Positioning

This project demonstrates:

- Distributed systems thinking (worker orchestration, queue management)
- Infrastructure awareness (Docker, Caddy, Garage, storage routing)
- Control plane vs data plane separation
- Step-aware error handling and retry logic
- Self-hosted deployment philosophy (vs SaaS quota enforcement)

### Naming Note

The project name "BigBoss" reflects the control-plane nature — it is the boss that orchestrates deployments, not a hosting provider.

