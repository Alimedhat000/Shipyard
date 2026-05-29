# ADR-0014: Symlink-Based Activation for Static Sites

Rollback needs per-deployment artifacts and atomic activation. Use per-deployment subdirectories (`sites/{appId}/{deploymentId}/`) and a symlink (`sites/{appId}/current`) pointing to the active deployment. Caddy root is permanently `sites/{appId}/current` — never changes on rollback or re-deploy.

## Status

Accepted

## Context

ADR-0013 used a flat `sites/{appId}/` directory that every deploy overwrote. Caddy's `root` pointed directly at it. Rollback required changing `apps.activeDeploymentId` in the DB plus a Caddy API call to update the root path — adding latency, a config-generation dependency, and a race window between two deploys finishing concurrently.

Issue #24 identified that files on disk were never reverted on rollback — only the DB pointer changed.

## Decision

### Storage layout

```
sites/{appId}/
├── current/                  → symlink to the active deployment
├── {deploymentId}/           → files from deployment X
├── {deploymentId}/           → files from deployment Y (pruned after KEEP_COUNT)
└── ...
```

### Activation

Deploy flow:
1. Build completes → artifacts extracted to `sites/{appId}/{deploymentId}/`
2. `ln -sfn {deploymentId} current` in `sites/{appId}/`
3. `UPDATE apps SET activeDeploymentId = $id`

Rollback flow:
1. Validate `isRollbackable`: `status === 'success' AND prunedAt IS NULL`
2. `ln -sfn {targetDeploymentId} current`
3. `UPDATE apps SET activeDeploymentId = $targetId`

### Caddy

Root permanently points to `sites/{appId}/current` — configured once at first deploy, never touched again for static sites. Caddy is uninvolved in rollback.

### First-deploy null state

Before the first successful deploy, `sites/{appId}/current` does not exist. Caddy returns 404 for the app's domain. No placeholder files or fallback routes.

### Retention

After each successful deploy, prune the app's deployment subdirectories keeping the newest `KEEP_COUNT` (configurable, default 5). Building deployments are excluded from pruning. Pruned directories are deleted, `deployments.prunedAt` is set, and per-deployment Caddy routes (see #43) are removed.

## Consequences

- **Atomic activation** — `ln -sfn` is atomic on Linux. No partial state exposed.
- **Rollback is a filesystem operation** — no Caddy API call, no config race, no latency from infra orchestration.
- **Deploy and activation are now distinct** — a deployment can succeed (artifacts exist) without being active. Activation failure is a system-level error (disk full, permissions) that throws.
- **No Caddy interaction on rollback** — eliminates the race window between concurrent deploys updating Caddy config.
- **Symlink is the single source of runtime truth** — mirrors `apps.activeDeploymentId` at the filesystem level.
- **Prune becomes the authority for artifact invalidation** — `prunedAt` column makes rollback eligibility queryable without filesystem probing.

## Considered Options

1. **Per-deployment subdirectories + Caddy root pointing to active deployment** — rollback requires Caddy API call. Slower, adds race window, couples activation to proxy orchestration. Rejected for #24.

2. **Symlink approach (selected)** — described above. Atomic, Caddy-uninvolved rollback, simple.

3. **Re-build on rollback** — re-clone the commit and rebuild. Guaranteed artifacts but slow. Useful for container rollback (Dockerfile/nixpacks server) where old images may be pruned, but unnecessary for static file rollback.

## Related

- Supersedes the rollback assumptions in ADR-0013 (consequence: "Rollback loses previous deployment's files")
- Updates ADR-0006 (rollback no longer triggers Caddy config)
- Enables #43 (multi-version routing via per-deployment routes)
- Enables #42 (preview deployments via per-branch subdirectories)
