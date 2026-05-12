# Shipyard — Self-Hosted Deployment Control Plane

## Problem Statement

Self-hosting static sites is painful. Existing tools either lock you into a SaaS with quotas and billing, or require deep DevOps knowledge. There is no self-hosted option that gives developers a simple control plane for deploying static sites without business-layer complexity. Coolify exists but is complex. Developers want something leaner — a focused deployment orchestrator for static runtimes, runnable anywhere.

## Solution

Shipyard is a self-hosted deployment control plane. It clones GitHub repos, builds projects using the selected **build pack** (static, Dockerfile, or Nixpacks), and runs the resulting containers with automatic routing via Caddy. It is not a SaaS product — there are no quotas, no billing, no per-user limits. The only constraints are infrastructure-level (CPU, memory, disk). It is a Coolify-inspired deployment orchestrator that grows from simple static sites to full application hosting.

## User Stories

### Authentication & Access

1. As a developer, I want to sign in with GitHub OAuth, so that I can access my repos without managing yet another password.
2. As a developer, I want my GitHub token stored after OAuth, so that the platform can clone my repos automatically.
3. As a developer, I want my GitHub token validated before cloning, so that I don't waste a build cycle on an invalid token.
4. As a developer, I want each user to implicitly have an organization, so that multi-tenant schema is ready when teams are added later.
5. As a developer, I want my GitHub OAuth scopes to be `repo` + `read:user`, so that the platform has the minimum access needed.
6. As a developer, I want app names to be scoped to my organization, so that two different users can both have an app named "myapp".

### App Management

1. As a developer, I want to choose a **build pack** (nixpacks, static, dockerfile, dockercompose, or dockerimage) when creating an app, so that Shipyard handles my project the right way.
2. As a developer using the **nixpacks build pack**, I want the platform to auto-detect my framework and generate the Dockerfile, so that I don't have to write one manually.
3. As a developer using the **static build pack**, I want to specify my output directory and optionally a build command, so that my pre-built assets are served via nginx.
4. As a developer using the **Dockerfile build pack**, I want Shipyard to build my Dockerfile and run the resulting container, so that I can deploy any project with a custom Docker setup.
5. As a developer using the **Docker Compose build pack**, I want Shipyard to deploy my multi-service stack from a docker-compose.yml file, so that I can run apps with bundled databases or microservices.
6. As a developer using the **Docker Image build pack**, I want to deploy a pre-built image from a registry without connecting a git repo, so that I can run existing images directly.
7. As a developer, I want to configure environment variables per app, so that secrets and config values are available at build and runtime.
8. As a developer, I want environment variables encrypted at rest (AES-256, key in env var), so that secrets are not stored in plaintext.
9. As a developer, I want to see my apps on a dashboard with deployment status and container health, so that I can quickly see what is running.
10. As a developer, I want to configure the container port Shipyard routes traffic to, so that my app is accessible at the right endpoint.
11. As a developer, I want to delete an app, so that I can clean up unused projects. Deleting an app stops the container and removes all database records.

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

1. As a developer, I want my build to run in an isolated Docker container (`node:22-alpine`), so that builds don't interfere with each other.
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

1. As a developer, I want my deployed files stored in a shared volume at `/var/lib/shipyard/sites/{appId}/`, so that Caddy can serve them directly.
2. As a developer, I want rollback to update the active deployment pointer in the database, so that Caddy can route to the correct deployment.
3. As a platform operator, I want Caddy config to be regenerated at deploy time (not at request time), so that routing is fast and DB-free.
4. As a developer, I want all deploys on `*.bigboss.dev` to route via Caddy to the correct app directory, so that my app is accessible at a predictable URL.
5. As a platform operator, I want Caddy config generated from templates with string replacement, so that the system stays simple.
6. As a developer, I want SPA fallback (every 404 serves index.html), so that client-side routing works in my React/Vue app.

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

1. As a developer, I want all services (API, worker, Redis, Postgres, Caddy) in a Docker Compose file with dev overrides, so that onboarding is frictionless.
2. As a developer, I want database migrations via Drizzle, so that schema changes are versioned and reproducible.
3. As a developer, I want all environment variables validated via Zod against a `.env.example`, so that missing config is caught early.
4. As a developer, I want the API to hot-reload on code changes, so that I can iterate quickly.
5. As a developer, I want the worker to restart on code changes and cancel in-flight jobs (dev only), so that new code is picked up without zombie builds.

## Implementation Decisions

### Architecture

- **Control plane philosophy.** Shipyard is a self-hosted deployment control plane, not a SaaS product. There are no business-layer limits (quotas, billing, per-user storage caps, per-app rate limits). The only constraints are infrastructure-level: container memory limit (2GB), build timeout (15 min), and max concurrent builds = worker count. Resource visibility (usage dashboard) is provided; blocking only happens if the system is in genuine danger.

- **Separation of concerns.** The logical layer (deployments, rollback, app settings) is separate from the execution layer (build_jobs, queue). This allows safe retries, worker scaling, and independent state tracking.

- **Storage abstraction.** Worker copies build output to a shared volume mounted in Caddy. Future: S3-compatible storage can be added for redundancy/backup.

### Modules

1. **API Server** — Express/Fastify REST API. Auth via GitHub OAuth + session cookies stored in Redis. Endpoints for apps, deployments, envvars, logs. No business logic here — delegates to service layer.

2. **Worker** — Node.js process pulling from BullMQ. Fetches deployment from DB, clones GitHub repo, runs Docker container, extracts output, copies to shared volume, updates deployment status, regenerates Caddy config. Stateless job processing.

3. **Deployment Engine** — Core service layer. Orchestrates the build lifecycle. Handles step sequencing, error classification, retry logic, log streaming.

4. **Queue Manager** — Wrapper around BullMQ. Job creation, worker registration, lock management, retry orchestration.

5. **GitHub Service** — OAuth flow, token management, repo access validation, webhook registration, webhook signature validation.

6. **Build Container Manager** — Docker container lifecycle (create, start, exec, logs, kill, rm). Handles timeouts and cleanup.

7. **Storage Service** — Copies build output to shared volume. Handles file manifest tracking.

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
  build_pack (PostgreSQL ENUM: nixpacks | static | dockerfile | dockercompose | dockerimage)
  framework
  build_command
  output_directory
  run_command
  port (INTEGER, default 80)
  dockerfile_path (VARCHAR, default './Dockerfile')
  is_spa (BOOLEAN, default true)
  custom_nginx_config (TEXT)
  image (VARCHAR) -- for dockerimage pack: 'nginx:alpine', 'ghcr.io/user/app:latest'
  auto_deploy (BOOLEAN)
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
POST /apps                    → Create app (connect repo + select build_pack)
GET  /apps/:id               → App details including container status
PUT  /apps/:id               → Update settings (build_pack, port, commands, etc.)
DELETE /apps/:id             → Delete app (stop container, remove records)

GET  /apps/:id/logs          → Stream container logs (SSE)

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

The flow depends on the app's `build_pack`:

**Static build pack:**
```
1. Clone repo (git clone --depth 1)
2. (Optional) Run user-defined build command
3. Verify output directory exists and not empty
4. Build nginx:alpine image with assets copied to /usr/share/nginx/html/
5. Deploy container (port 80)
6. Send config to Caddy API (auto-reloads)
7. Update status: success
```

**Dockerfile build pack:**
```
1. Clone repo (git clone --depth 1)
2. docker build -f <dockerfile_path> -t shipyard-<id> .
   - Build error → fail immediately
3. Stop previous container (if any)
4. Start new container from built image
5. Health check → confirm container is responding
6. Send config to Caddy API (route to new container)
7. Update status: success
```

**Nixpacks build pack:**
```
1. Clone repo (git clone --depth 1)
2. nixpacks build . --out ./Dockerfile
   - Detection fail → fail with "could not detect framework"
3. docker build -f ./Dockerfile -t shipyard-<id> .
4. Stop previous container (if any)
5. Start new container from built image
6. Health check → confirm container is responding
7. Send config to Caddy API (route to new container)
8. Update status: success
```

### Caddy Configuration

- Server blocks for `*.bigboss.dev` via Caddy's built-in auto-HTTPS (Let's Encrypt)
- Routes traffic based on build pack:
  - **Static:** `reverse_proxy` to the nginx container
  - **Dockerfile/Nixpacks:** `reverse_proxy` to the user's container on configured port
- SPA fallback for static sites: Caddy `handle_errors` with rewrite to `/index.html`
- JSON API config sent to `http://caddy:2019/config/`
- Each app gets a unique route — config updates are per-app (not full reload)

### Docker Container (Runtime)

Each deployed app runs as a long-lived Docker container:

- Image: depends on build pack
  - **Static:** `nginx:alpine` with user assets
  - **Dockerfile:** user-provided Dockerfile output
  - **Nixpacks:** Nixpacks-generated Dockerfile output
- Network: bridge (configurable)
- Restart policy: `unless-stopped`
- Health check: configured per app
- Logs: captured to database for streaming via API

### Env Var Encryption

- Algorithm: AES-256-GCM
- Key: stored in server environment variable (not in database)
- Encrypt before insert, decrypt before container injection
- Zod schema validates env var keys (alphanumeric + underscore only)

## Testing Decisions

- **Test external behavior only.** Do not test BullMQ internals, Docker SDK calls, or Garage SDK calls. Mock these at the boundary.
- **Good tests:** Queue job creation → verify job in Redis. Trigger deploy → verify deployment status in DB. Build success → verify volume copy, Caddy config update, status transition.
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

### Build Pack Implementation Order

| Build Pack | When | Why |
|---|---|---|
| **Static** | P0 | Simplest. nginx:alpine, copy assets. Teaches the deployment pipeline. |
| **Dockerfile** | P0 | Full control. Build any Dockerfile. Teaches container lifecycle. |
| **Docker Image** | P0 | No build pipeline needed — pull and run. Quickest path to "something running". |
| **Nixpacks** | P1 | Auto-detection. Requires nixpacks binary. Teaches framework abstraction. |
| **Docker Compose** | P1+ | Multi-container orchestration. Significant complexity. Post-MVP. |

### MVP Priority Breakdown

**P0 (Must Have):**
- GitHub OAuth, app creation, manual deploy
- **Static build pack** — nginx:alpine, SPA fallback, custom nginx config
- **Dockerfile build pack** — user-provided Dockerfile, port config, health checks
- Container lifecycle (start, stop, restart, logs)
- Caddy routing to containers (not just Garage)
- Environment variables (encrypted, injected at build + runtime)
- Basic UI (app list, create with build pack selector, deploy button, logs view)

**P1 (Should Have):**
- **Nixpacks build pack** — auto-detect framework, generate Dockerfile
- Auto-deploy webhooks
- Rollback
- Build cancellation
- Deployment history

**P2 (Nice to Have):**
- Rapid push debounce
- Streaming build logs (SSE)
- Worker heartbeat monitoring
- Deployment retention cleanup

**Cut from MVP:**
- Content hashing (schema ready, not implemented)
- Teams UI (schema ready, single-user only)
- Custom domains
- Usage analytics

### v2 Expansion Path

After MVP, the natural expansion is:

- **v2:** Custom domains + Let's Encrypt, webhook notifications, Nixpacks polish
- **v3:** Teams + permissions, branch preview URLs, usage analytics

### Self-Hosted Model

Shipyard is designed to be self-hosted. The deployment target is a single server or small cluster (`docker compose -f docker-compose.yaml up -d`). There is no multi-tenant SaaS isolation layer — each self-hosted instance serves one organization. Multi-tenancy is achieved by deploying multiple instances, not by serving multiple organizations from one deployment.

Development uses `docker compose up` which auto-loads `docker-compose.override.yaml` for hot reload, source mounting, and port exposure.

### Interview Positioning

This project demonstrates:

- Distributed systems thinking (worker orchestration, queue management)
- Infrastructure awareness (Docker, Caddy, Garage, storage routing)
- Control plane vs data plane separation
- Step-aware error handling and retry logic
- Self-hosted deployment philosophy (vs SaaS quota enforcement)

### Naming Note

The project name "Shipyard" reflects the control-plane nature — it is the boss that orchestrates deployments, not a hosting provider.

