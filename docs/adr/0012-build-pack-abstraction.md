# ADR-0012: Build Pack Abstraction — Static, Dockerfile, and Nixpacks

## Status

Accepted (updated)

## Context

The original Shipyard spec scoped the project to static sites only, with a simple `package.json` dependency scan for framework detection (Vite, CRA, Next.js, Vue). During triage of Issue #3 (app creation), two things became clear:

1. The maintainer's goal is a general-purpose deployment platform (Coolify-like), not a static-site-only tool.
2. Coolify itself uses a **build pack** model where users choose between Nixpacks (auto-detect), static (nginx), or Dockerfile (custom) at app creation time.

Shipyard's build pipeline needs an abstraction that supports all three modes without coupling the deployment engine to any single strategy.

## Decision

### Build Pack Interface

The deployment engine routes to one of three implementations based on the app's `build_pack` field:

```typescript
enum BuildPack {
  Static = "static",       // nginx:alpine, copy static assets
  Dockerfile = "dockerfile", // user-provided Dockerfile
  Nixpacks = "nixpacks",    // Nixpacks auto-detect + Dockerfile generation
}

interface BuildPackResult {
  imageName: string;       // Built Docker image name
  containerPort: number;   // Port to expose (e.g., 80 for static, 3000 for Express)
  outputDir?: string;      // For static: dir to pull assets from (optional)
  healthCheck?: string;    // Optional health check path
}
```

### Build Pack Implementations

#### 1. Static Build Pack

- **Base image:** `nginx:alpine`
- **Flow:** Build → copy user's static assets from `output_dir` to `/usr/share/nginx/html/` → serve on port 80
- **Config:** User specifies `output_dir` (default: `/dist`)
- **Options:** SPA fallback mode (all 404s → index.html), custom nginx config
- **No framework detection** — assumes pre-built assets. User runs their own build command if needed.

#### 2. Dockerfile Build Pack

- **Flow:** Git clone → `docker build -f Dockerfile` → `docker run` → route traffic to container
- **Config:** User commits a `Dockerfile` in their repo. Shipyard builds it as-is.
- **Port:** User configures the container port Shipyard should route to.
- **No framework detection** — the Dockerfile defines everything.

#### 3. Nixpacks Build Pack

- **Flow:** Git clone → `nixpacks build .` (generates Dockerfile) → `docker build` → `docker run` → route traffic
- **Detection:** Nixpacks auto-detects framework from repo contents (Next.js, Django, Rails, Go, etc.)
- **Config:** User can override build/start commands. User specifies `output_dir` for static export frameworks.
- **Dependency:** Requires `nixpacks` binary installed on the worker host.

### User Configuration Per App

| Field | Static | Dockerfile | Nixpacks |
|-------|--------|------------|----------|
| `build_pack` | `"static"` | `"dockerfile"` | `"nixpacks"` |
| `output_dir` | Required (e.g., "dist") | N/A | Optional (for static exports) |
| `build_command` | Optional | N/A | Override if needed |
| `run_command` | N/A | N/A | Override if needed |
| `port` | 80 (fixed) | Required (e.g., 3000) | Optional (auto-detected) |
| `dockerfile_path` | N/A | Default: `./Dockerfile` | N/A |

### Schema Changes

Add to `apps` table:

```sql
build_pack VARCHAR(20) NOT NULL DEFAULT 'static',  -- 'static' | 'dockerfile' | 'nixpacks'
run_command TEXT,                                    -- override for nixpacks
port INTEGER DEFAULT 80,                             -- container port to route to
dockerfile_path VARCHAR(255) DEFAULT './Dockerfile', -- for dockerfile pack
is_spa BOOLEAN DEFAULT TRUE,                         -- SPA fallback for static pack
custom_nginx_config TEXT,                            -- nginx override for static pack
```

## Consequences

- **Three distinct build paths** share the same deployment state machine (pending → building → success/failed). Only the build execution differs.
- **No migration cost** when adding a new build pack — implement the interface, add the enum value.
- **Nixpacks is optional** — don't need the binary installed unless using that pack.
- **Static pack stays lean** — no dependencies beyond nginx:alpine.
- **Dockerfile pack is the escape hatch** — users who don't want auto-detection bring their own setup.
- **Container routing required** — once you support dockerfile and nixpacks, you need to run long-lived containers and reverse-proxy to them, not just upload to Garage. This changes the Caddy routing architecture (ADR-0006 needs updating).

## Alternatives Considered

- **Static-site only (rejected):** Too narrow. The maintainer's goal is a general platform.
- **Nixpacks only with static override (rejected):** Locks users into Nixpacks dependency even for simple static sites.
- **Dockerfile only (rejected):** Too manual. No auto-detection, no static optimization.
- **Two packs (static + dockerfile, no nixpacks) (rejected):** Nixpacks provides the "auto-detect everything" UX that makes Coolify compelling.
