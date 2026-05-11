# 4b: Static Build Worker — Implementation Spec

**Issue:** #17
**Status:** Spec complete, ready for implementation
**Depends on:** #16 (queue infra — merged)

---

## Architecture

### Layered design ("structured procedural")

```
worker/src/deployments/
  process-deployment.ts    ← orchestrator (the brain)
  docker/
    docker-runner.ts       ← container lifecycle (dockerode)
  steps/
    clone-step.ts          ← git clone logic
    install-step.ts        ← npm/pnpm/yarn install
    build-step.ts          ← build command execution
    verify-step.ts         ← output dir validation
  logs/
    log-buffer.ts          ← buffered log sink (500ms/4KB/step-end)
  errors/
    classify-error.ts      ← exit code + stderr → failure category
  utils/
    retry.ts               ← exponential backoff wrapper
    timeout.ts             ← deadline enforcement
```

### Key principle

No interfaces, no DI, no plugin systems. Concrete modules operating on data.

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Docker SDK | **dockerode** for lifecycle; `/bin/sh -c` for commands inside | Per-step streaming, OOM inspection, clean timeout handling |
| Docker socket | **Auto-detect** (`DOCKER_HOST` env → socket candidates) | Works in dev, prod, CI without config |
| Container image | `node:18-bullseye` | Matches AC; stable Node env for static builds |
| Memory limit | 2GB | Per ADR-0001; enforced via `HostConfig.Memory` |
| Timeout | **Total** per deployment (app's `buildTimeout`, default 900s) | Simpler than per-step; schema field already exists |
| Timeout enforcement | `setTimeout → container.kill()` | Clean kill via dockerode, not shell signal |
| Workspace | Bind mount: host `/var/lib/shipyard/builds/<id>` → container `/workspace` | Host-side verification via fs; path saved for S3 upload (#6) |
| Git auth | **DB join** — worker queries `users.github_access_token` via apps org chain | Token in DB, not in queue payload; MVP-acceptable coupling |
| Install command | Schema field `install_command` with **whitelist validation** | User-configurable, safe; whitelist: `npm`, `pnpm`, `yarn`, `bun` + safe flags |
| Build command | From `app.buildCommand`; fallback `npm run build` | Explicit, deterministic, no auto-detection |
| Output dir | From `app.outputDir`; fallback `dist` | No framework probing; user configures |
| Log storage | **Buffered flush**: accumulate lines, insert in batches (500ms / 4KB / step-end) | Avoids thousands of per-chunk DB inserts during `npm install` |
| Step enum | **TS const** (`clone`, `install`, `build`, `verify`); **varchar** in DB | Build-pack-specific step names differ (nixpacks, dockerfile, etc.); DB shouldn't encode taxonomy |
| `deployment_logs.step` | varchar — add via migration | Enables per-step log filtering API |
| Container labels | `shipyard.managed=true`, `shipyard.type=build`, `shipyard.deployment-id=<id>`, `shipyard.worker-id=<id>` | Structured labels for reconciliation, debugging, future multi-worker |
| Startup cleanup | **Full reconciliation**: fail stale deployments, remove containers + workspace dirs | Operational hygiene; prevents zombie accumulation + stuck "building" state |
| Framework detection | **None in worker.** Explicit config only. | Auto-detection is non-deterministic, fragile, and creates a second build system |
| API endpoint | `GET /api/deployments/:id/logs` (standalone, not nested under apps) | Clean REST; auth checks deployment's app org ownership |

---

## Schema Changes (Migration)

### `deployment_logs` — add column

```sql
ALTER TABLE deployment_logs ADD COLUMN step varchar(50);
```

### `apps` — add column

```sql
ALTER TABLE apps ADD COLUMN install_command varchar(500);
```

### `install_command` validator (shared)

```typescript
const SAFE_BINARIES = ["npm", "pnpm", "yarn", "bun"];
const SAFE_FLAGS = [
  "--frozen-lockfile", "--no-audit", "--ignore-scripts",
  "--prefer-offline", "--no-optional", "--no-fund",
];

// Reject: ; | && > $() `` newlines
// Default: "npm install"
```

---

## Worker Environment

Add `DOCKER_HOST` support to worker env schema:

```typescript
const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  DOCKER_HOST: z.string().optional(),
  BUILD_WORKSPACE_DIR: z.string().default("/var/lib/shipyard/builds"),
  WORKER_ID: z.string().default(`worker-${hostname()}`),
});
```

### Docker socket auto-detect (in DockerRunner constructor)

1. If `DOCKER_HOST` is set, use it (remote Docker)
2. Else if `DOCKER_HOST` env var, extract socket path
3. Else if `~/.rd/docker.sock` exists (Rancher Desktop)
4. Else use `/var/run/docker.sock`
5. Else throw — Docker is required

---

## DockerRunner

```typescript
class DockerRunner {
  constructor()
  async create(options: {
    image: string;
    memory: number;         // bytes (2GB = 2 * 1024 * 1024 * 1024)
    timeout: number;        // ms
    workspaceHost: string;  // host path for bind mount
    workspaceContainer: string; // "/workspace"
    labels: Record<string, string>;
    envVars: Record<string, string>;  // decrypted app env vars
  }): Promise<Container>
  async exec(containerId: string, command: string, step: string): Promise<ExecResult>
  //   streams stdout/stderr → onData callback
  //   returns { exitCode, oomKilled }
  async stop(containerId: string): Promise<void>
  async remove(containerId: string): Promise<void>
  async inspect(containerId: string): Promise<ContainerInspectInfo>
  async listManaged(): Promise<ManagedContainer[]>
  //   filters: shipyard.managed=true
}
```

### `exec()` behaviour

- Uses `container.exec()` with `AttachStdout: true, AttachStderr: true`
- Starts with `hijack: true, stdin: false`
- Demuxes stdout/stderr via `container.modem.demuxStream(stream, stdout, stderr)`
- Calls `onData(step, chunk)` for each output chunk
- Returns `{ exitCode, oomKilled }`
- `oomKilled` is resolved by `container.inspect()` after exit (checks `State.OOMKilled`)

---

## LogBuffer

```typescript
class LogBuffer {
  constructor(deploymentId: string, step: string)
  append(content: string): void
  //   Accumulates lines in memory buffer
  async flush(): Promise<void>
  //   Inserts buffered rows into deployment_logs table
  //   Clears buffer
  async flushOnStepEnd(): Promise<void>
  //   Ensures final flush, resets internal state for next step
}
```

- Auto-flush trigger: every 500ms **or** buffer exceeds 4KB **or** step ends
- Inserts batched rows: `db.insert(deploymentLogs).values(rows)`
- Each row: `{ deploymentId, step, content, createdAt }`
- Each `flush()` is a single multi-row insert — NOT one insert per chunk

---

## Step Modules

### clone-step.ts

```
Behaviour:
  → git clone --depth 1 https://<token>@github.com/<repo>.git /workspace/repo
  → Target: /workspace/repo
  → Timeout: 60s per attempt
  → Retries: 3x (2s, 4s, 8s exponential backoff)
  → Exit 128:
      Inspect stderr for auth-related keywords
      ("Authentication failed", "Repository not found", "Permission denied")
      → Fail immediately (user error, not retryable)
  → Network errors (ECONNRESET, ETIMEDOUT, etc.):
      → Retry with backoff
  → All other exits:
      → Retry 3x then classify as system error

Input: runner, deploymentId, app (with githubRepo + token)
Output: { ok: true } | { ok: false, error: Classification, message: string }
```

### install-step.ts

```
Behaviour:
  1. Probe for lockfile in /workspace/repo (via docker exec ls):
     - pnpm-lock.yaml → use "pnpm install"
     - yarn.lock → use "yarn install"
     - package-lock.json → use "npm install"
  2. If lockfile probe fails OR unexpected:
     Fall back to app.installCommand → validated, default "npm install"
  3. Run install command inside /workspace/repo
  4. Network timeout retry 3x
  5. Non-zero exit → fail deployment immediately (user error: bad deps)
  6. ENOSPC in stderr → system error (disk full)

Input: runner, app (with installCommand)
Output: { ok: true } | { ok: false, error: Classification, message: string }
```

### build-step.ts

```
Behaviour:
  1. Determine command:
     app.buildCommand ?? "npm run build"
  2. Run inside /workspace/repo
  3. Any non-zero exit → fail immediately (user code error)
  4. After exit, inspect container:
     If State.OOMKilled → fail with OOM message, system error
  5. No retries (per ADR-0002)

Input: runner, app (with buildCommand)
Output: { ok: true } | { ok: false, error: Classification, message: string, oomKilled: boolean }
```

### verify-step.ts

```
Behaviour:
  (verification happens on the HOST via bind mount — no docker exec needed)
  1. Read directory: /var/lib/shipyard/builds/<id>/repo/<outputDir>
  2. If directory does not exist:
     → Fail: "Output directory '<outputDir>' is empty or missing"
  3. Walk recursively:
     Count files (excluding dotfiles: .gitkeep, .DS_Store, etc.)
  4. If count === 0:
     → Fail: "Output directory '<outputDir>' is empty or missing"
  5. Pass

Input: deploymentId, outputDir
Output: { ok: true, fileCount: number } | { ok: false, message: string }
```

---

## Orchestrator (process-deployment.ts)

```typescript
export async function processDeployment(deploymentId: string): Promise<void>
```

### Flow

1. **Fetch deployment + app + user token** (DB queries)
2. **Create workspace dir** on host (`/var/lib/shipyard/builds/<id>`)
3. **Create Docker container** with:
   - Image: `node:18-bullseye`
   - Memory: 2GB
   - Labels: `shipyard.*` (4 labels)
   - Bind mount: host workspace → `/workspace`
   - Env vars: decrypted from `env_vars` table → `-e KEY=VALUE` via `Env` config
4. Mark deployment: `status = "building"`, `startedAt = now`
5. Start total timeout (app.buildTimeout or 900s)
6. **Execute steps sequentially:**
   ```
   clone → install → build → verify
   ```
   - Each step:
     a. Insert build_job row: `{ deploymentId, step, status: "running", startedAt }`
     b. Create LogBuffer for this step
     c. Run step via runner.exec(step command, onData → logBuffer.append)
     d. Flush log buffer on step end
     e. Classify result: retryable? → retry loop | user error? → fail | system error? → fail + alert
     f. Update build_job: `{ status: "success"|"failed", finishedAt, attempts }`
7. **On success:** deployment.status = "success", finishedAt = now
8. **On failure:** deployment.status = "failed", finishedAt = now, error info stored
9. **On total timeout:** container.kill() → "Deployment timed out after X seconds"
10. **finally:** runner.remove(), cleanup workspace dir

### Retry loop

```typescript
async function runStepWithRetry(runner, step, ctx, maxRetries) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await executeStep(runner, step, ctx);
    if (result.ok) return result;
    if (!isRetryable(result)) return result;  // fail fast
    if (attempt < maxRetries) {
      const delay = BACKOFF[attempt];  // [2s, 4s, 8s]
      ctx.log.append(`Retrying in ${delay}s... (attempt ${attempt + 1}/${maxRetries})`);
      await sleep(delay);
    }
  }
  return { ok: false, error: "system", message: "Max retries exceeded" };
}
```

---

## classifyError

```typescript
type FailureCategory = "retryable" | "user_error" | "system_error";

function classifyError(exitCode: number, stderr: string, step: string): {
  category: FailureCategory;
  message: string;
}
```

### Rules

| Step | Exit Code | stderr pattern | Category |
|------|-----------|----------------|----------|
| clone | 128 | "Authentication failed" / "Repository not found" / "Permission denied" | user_error |
| clone | any | "Connection refused" / "Connection timed out" / "Could not resolve" | retryable |
| install | non-zero | "ENOSPC" / "No space left" | system_error |
| install | non-zero | "404 Not Found" / "404 Not Found" | user_error |
| install | non-zero | network patterns | retryable |
| install | non-zero | anything else | user_error |
| build | non-zero | — | user_error |
| build | OOMKilled | — | system_error |
| build | 137 + !OOMKilled | — | system_error (external kill) |
| verify | — | — | user_error (wrong config) |

---

## Startup Reconciliation

In `worker/src/index.ts`, before starting the BullMQ consumer:

1. List containers: `dockerode.listContainers({ filters: { label: ["shipyard.managed=true"] } })`
2. For each container:
   - Extract `shipyard.deployment-id` from labels
   - Query deployment: if status is "building" or "pending":
     - Mark status = "failed", finishedAt = now
     - Insert log: "Worker restarted during build. Container cleaned up during startup recovery."
     - Insert build_job for current step with status "failed"
   - `docker rm -f` the container
3. List workspace dirs in `BUILD_WORKSPACE_DIR`: `fs.readdir` → remove each with `fs.rmSync(dir, { recursive: true, force: true })`

---

## API: GET /api/deployments/:id/logs

### Route

```typescript
// packages/api/src/routes/deployments.ts
router.get("/:id/logs", requireAuth, async (req, res) => {
  // 1. Fetch deployment
  // 2. Verify deployment's app belongs to req.orgId
  // 3. Query deployment_logs WHERE deployment_id = ? ORDER BY created_at ASC
  // 4. Return log entries
});
```

### Response

```json
{
  "logs": [
    {
      "id": "uuid",
      "step": "clone",
      "content": "Cloning into '/workspace/repo'...",
      "createdAt": "2026-05-10T12:00:00Z"
    }
  ]
}
```

### Service

```typescript
export async function getDeploymentLogs(deploymentId: string) {
  return db
    .select()
    .from(deploymentLogs)
    .where(eq(deploymentLogs.deploymentId, deploymentId))
    .orderBy(deploymentLogs.createdAt);
}
```

---

## File Structure (to create)

```
packages/worker/src/
  deployments/
    process-deployment.ts
    docker/
      docker-runner.ts
    steps/
      clone-step.ts
      install-step.ts
      build-step.ts
      verify-step.ts
    logs/
      log-buffer.ts
    errors/
      classify-error.ts
    utils/
      retry.ts
      timeout.ts

packages/api/src/
  routes/deployments.ts    ← add GET /:id/logs
  services/deployments.ts  ← add getDeploymentLogs()
```

---

## Migration

Generate with `drizzle-kit generate` after updating schema.

Manual SQL equivalent:

```sql
-- 0005_static_build_worker
ALTER TABLE deployment_logs ADD COLUMN step varchar(50);
ALTER TABLE apps ADD COLUMN install_command varchar(500);
```

---

## Test plan

### Worker unit tests (new)
- `classifyError` for each step × exit code × stderr combination
- `LogBuffer` buffering and flush behaviour
- `retry` exponential backoff timing
- `verify-step` on various directory structures (exists + files, exists + empty, doesn't exist, dotfiles-only)

### Integration tests
- Full `processDeployment` flow with mocked `DockerRunner`
- API: GET /deployments/:id/logs returns correct data

---

## Non-goals (explicitly excluded from this issue)

- S3 / Garage upload (#6)
- Caddy routing configuration (#6)
- Dockerfile build pack
- Nixpacks build pack
- WebSocket streaming for logs
- Framework auto-detection
- Resuming builds after worker restart
- Horizontal worker scaling
