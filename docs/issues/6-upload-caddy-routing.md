# 4c: Garage upload + Caddy routing + frontend link

**Issue:** #6  
**Status:** Plan complete, ready for implementation  
**Depends on:** #5 (build worker with step pipeline)  

---

## Decisions Locked

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Upload owner | **Worker** | Has S3 client dep + bind mount access; pipeline continuity |
| Pipeline placement | **Step 5** after verify | Tracked like other steps with build_job + logs |
| Upload strategy | **PutObjectCommand per file** with bounded concurrency | SDK-native, no CLI dep |
| Retention | **Inline after upload** | Simplest MVP; no separate job needed |
| Domain routing | primary domain if set, else `{app.name}.{BASE_DOMAIN}` | Cleanest MVP, no multi-domain complexity |
| Active URL owner | **Backend builds it**, frontend renders it | Single source of truth |
| Dev domains | `*.localtest.me` | Auto-resolves to 127.0.0.1, zero config |
| URL scheme | Controlled by `AUTO_HTTPS` env var | `http://` in dev, `https://` in prod |
| `active_deployment_id` updated | **Immediately after upload success** | Before Caddy update, makes retention logic deterministic |

---

## Env Vars

### New vars to validate via env schema:

| Env | Required | Default | Description |
|-----|----------|---------|-------------|
| `GARAGE_S3_ENDPOINT` | yes | `http://garage:3900` | S3-compatible endpoint |
| `GARAGE_S3_ACCESS_KEY` | yes | — | Garage access key |
| `GARAGE_S3_SECRET_KEY` | yes | — | Garage secret key |
| `GARAGE_S3_BUCKET` | yes | `shipyard` | Bucket name |
| `CADDY_ADMIN_URL` | yes | `http://caddy:2019` | Caddy admin API URL |
| `BASE_DOMAIN` | yes | `bigboss.dev` | Base domain for fallback routing |
| `AUTO_HTTPS` | no | `false` | Whether Caddy auto-HTTPS is enabled |

### docker-compose:

Ensure worker container receives all the above. It currently only gets `GARAGE_S3_*` — needs `CADDY_ADMIN_URL`, `BASE_DOMAIN`, `AUTO_HTTPS` added.

---

## Architecture

### Post-build flow (in orchestrator, after verify succeeds)

```
┌────────────────────────────────────────────────┐
│          process-deployment.ts                  │
│                                                    │
│  clone → install → build → verify → UPLOAD        │
│                                      │             │
│                          ┌───────────┘             │
│                          ▼                         │
│               upload-step.ts                       │
│                  │ upload files                    │
│                  │ insert deployment_files         │
│                  ▼                                 │
│           Set active_deployment_id                  │
│                  │                                 │
│                  ▼                                 │
│           Retention cleanup                         │
│                  │ delete old S3 prefixes           │
│                  ▼                                 │
│           Caddy config update                       │
│                  │ POST per-route JSON              │
│                  ▼                                 │
│           deployment.status = success               │
└────────────────────────────────────────────────┘
```

### Caddy per-route API call

```
POST /config/apps/http/servers/sites/routes/app-{appId}
```

Route JSON:
```json
{
  "@id": "app-{appId}",
  "match": [{"host": ["{domain}"]}],
  "handle": [{
    "handler": "subroute",
    "routes": [
      {
        "handle": [{
          "handler": "reverse_proxy",
          "upstreams": [{"dial": "garage:3900"}],
          "rewrite": {
            "uri": "/{bucket}/users/{userId}/apps/{appId}/deployments/{deploymentId}{uri}"
          }
        }]
      }
    ]
  }],
  "handle_errors": [
    {
      "handler": "static_response",
      "status_code": 404,
      "body": ""
    }
  ],
  "terminal": true
}
```

If `AUTO_HTTPS=true`, also need TLS config. For MVP, dev uses HTTP only.

---

## File Structure

```
packages/worker/src/
  deployments/
    storage/
      s3-client.ts           ← S3Client singleton
      upload.ts              ← uploadToObjectStorage()
    steps/
      upload-step.ts         ← Step 5 build step
    caddy/
      config-builder.ts      ← generates route JSON
      client.ts              ← POSTs to Caddy admin API
```

```
packages/api/src/
  services/
    apps.ts                  ← add activeUrl to app payload
```

```
packages/web/src/
  pages/
    Dashboard.tsx            ← add Visit link in AppCard
```

---

## Implementation Order

### Phase 1 — Worker env + config
1. Add env vars to `packages/worker/src/config/env.ts`
2. Update docker-compose to inject new vars into worker
3. Update `.env.example`

### Phase 2 — S3 client + upload utility
4. Create `packages/worker/src/deployments/storage/s3-client.ts`
5. Create `packages/worker/src/deployments/storage/upload.ts`

### Phase 3 — Upload step
6. Create `packages/worker/src/deployments/steps/upload-step.ts`
7. Wire into orchestrator as Step 5

### Phase 4 — Active deployment + retention
8. After upload success: `apps.active_deployment_id = deploymentId`
9. Retention: query + delete old prefixes from S3

### Phase 5 — Caddy config
10. Create `packages/worker/src/deployments/caddy/config-builder.ts`
11. Create `packages/worker/src/deployments/caddy/client.ts`
12. Call after upload + active deployment set

### Phase 6 — Backend activeUrl
13. Compute `activeUrl` in `packages/api/src/services/apps.ts`
14. Include in app payload

### Phase 7 — Frontend link
15. Add Visit link to `AppCard` in `Dashboard.tsx`

### Phase 8 — Tests
16. Unit tests for:
    - Caddy config builder
    - Retention rules
    - Upload path generation

---

## Key Implementation Details

### uploadToObjectStorage()

```typescript
async function uploadToObjectStorage(
  localRoot: string,
  bucket: string,
  prefix: string,
  deploymentId: string,
  concurrency?: number,
): Promise<{ filePath: string; fileSize: number; contentHash: string }[]>
```

- Recursively walks `localRoot`
- Skips directories
- Computes relative path from `localRoot`
- Uploads each file with `PutObjectCommand`
- Concurrency: 5–10 via Promise pool
- Returns file metadata for `deployment_files` insert

### Retention query

```sql
SELECT id FROM deployments
WHERE app_id = ? AND status = 'success'
ORDER BY created_at DESC
OFFSET 5  -- keep newest 5
```

Then for each old deployment (skip if `deployment.id === apps.active_deployment_id`):
1. `ListObjectsV2Command` with prefix
2. `DeleteObjectsCommand` for batch
3. (Optional) delete `deployment_files` rows

### activeUrl computation (backend)

```typescript
function computeActiveUrl(app: App): string | null {
  if (!app.activeDeploymentId) return null;
  const domain = app.primaryDomain ?? `${app.name}.${env.BASE_DOMAIN}`;
  const scheme = env.AUTO_HTTPS ? "https" : "http";
  return `${scheme}://${domain}`;
}
```

### SPA fallback

Caddy `handle_errors` catches 404s from Garage reverse proxy.
Rewrite to `/index.html` to serve SPA entry point for client-side routes.

So the Caddy route JSON should be:

```json
{
  "@id": "app-{appId}",
  "match": [{"host": ["{domain}"]}],
  "handle": [
    {
      "handler": "reverse_proxy",
      "upstreams": [{"dial": "garage:3900"}],
      "rewrite": {
        "uri": "/{bucket}/users/{userId}/apps/{appId}/deployments/{deploymentId}{uri}"
      }
    }
  ],
  "terminal": true
}
```

The SPA fallback is handled by Caddy `handle_errors` directive.

---

## Dev Testing

```bash
# Build a test site
curl -H "Host: notes.localtest.me" http://localhost

# Check Caddy config
curl http://caddy:2019/config/
```
