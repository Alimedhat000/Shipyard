# ADR-0012: Build Pack Abstraction — Four Build Pack Types

## Status

Accepted (updated)

## Context

The original Shipyard spec scoped the project to static sites only. During triage of Issue #3 (app creation), two things became clear:

1. The maintainer's goal is a general-purpose deployment platform (Coolify/Dokploy-like).
2. Platforms like Coolify use a **build pack** model where users choose how their project is built.

Originally five build pack types were defined: `nixpacks`, `static`, `dockerfile`, `dockercompose`, `dockerimage`. The `static` and `nixpacks` packs were later merged — a "static site" is now a mode of nixpacks (isStatic=true), not a separate build path.

## Decision

### Build Pack Enum

```sql
CREATE TYPE build_pack AS ENUM (
  'nixpacks',
  'dockerfile',
  'dockercompose',
  'dockerimage'
);
```

| Value | Description | Use Case |
|-------|-------------|----------|
| `nixpacks` | Nixpacks auto-detects framework, builds image. Serves via nginx (isStatic=true) or runs as container (isStatic=false) | Most applications; zero-config deployments |
| `dockerfile` | User provides Dockerfile in repo, Shipyard builds and runs it | Custom builds with specific OS deps |
| `dockercompose` | User provides docker-compose.yml, Shipyard deploys the stack | Multi-service apps with bundled services |
| `dockerimage` | Pull a pre-built image from a registry and run it | Deploy without source/build pipeline |

### Nixpacks Strategy

Nixpacks handles both static sites and server apps:

| Mode | `isStatic` | Flow | Caddy Route |
|------|-----------|------|-------------|
| Static site | `true` (default) | nixpacks build → extract output dir → serve via nginx file_server with pass_thru SPA fallback | File route |
| Server app | `false` | nixpacks build → run long-lived container → reverse proxy | Proxy route |

**Flow:** Git clone → `nixpacks build --cache-key shipyard-{appId} --inline-cache` → (static: extract /app/{outputDir} to sites dir) or (server: runLongLived) → Caddy route

**Caching:** `--cache-key` uses a stable per-app identifier so nixpacks restores `~/.npm` and `~/.cache` between deploys. `--inline-cache` embeds Docker layer metadata for faster rebuilds.

**Subdirectory support:** `--subdirectory` clones the full repo but nixpacks builds from `{repo}/{subdirectory}`. Used for monorepos.

### SPA Fallback

Static sites with `isSpa=true` use Caddy's `file_server` with `pass_thru: true`, followed by a rewrite to `/index.html`. This avoids the broken subroute+errors pattern that doesn't work in Caddy v2.

## Consequences

- **Four build paths** share the same deployment state machine. Only execution differs.
- **Nixpacks replaces the static build pack** — one fewer strategy to maintain.
- **Build caching** speeds up repeated deploys (~60% faster on npm installs).
- **Old step files** (clone, install, build, verify, copy) are marked dead code and will be removed after nixpacks stabilises.

## Alternatives Considered

- **Keep static as separate pack (rejected):** Duplicate of nixpacks with isStatic=true. Manual step pipeline was fragile (missing package managers like pnpm).
- **Railpack instead of Nixpacks (noted):** Nixpacks is in maintenance mode, Railpack is the successor. Will migrate when Railpack matures.
- **--provider docker flag (noted):** May be needed to bypass broken Nix derivations for certain language packs like bun.
