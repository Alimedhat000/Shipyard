# ADR-0012: Build Pack Abstraction — Five Build Pack Types

## Status

Accepted (updated)

## Context

The original Shipyard spec scoped the project to static sites only, with a simple `package.json` dependency scan for framework detection (Vite, CRA, Next.js, Vue). During triage of Issue #3 (app creation), two things became clear:

1. The maintainer's goal is a general-purpose deployment platform (Coolify/Dokploy-like), not a static-site-only tool.
2. Platforms like Coolify use a **build pack** model where users choose how their project is built: Nixpacks (auto-detect), static (nginx), Dockerfile (custom), Docker Compose (multi-service), or pre-built Docker image.

The build pack is defined as a PostgreSQL enum on the `apps` table:

```sql
CREATE TYPE build_pack AS ENUM (
  'nixpacks',
  'static',
  'dockerfile',
  'dockercompose',
  'dockerimage'
);
```

## Decision

### Build Pack Enum

The deployment engine routes to one of five implementations based on the app's `build_pack` field:

| Value | Description | Use Case |
|-------|-------------|----------|
| `nixpacks` | Nixpacks auto-detects framework from repo, generates Dockerfile, builds and runs it | Most applications; zero-config deployments |
| `static` | nginx:alpine serves pre-built static assets | SPAs, documentation sites, plain HTML |
| `dockerfile` | User provides Dockerfile in repo, Shipyard builds and runs it | Custom builds with specific OS deps |
| `dockercompose` | User provides docker-compose.yml, Shipyard deploys the stack | Multi-service apps with bundled services |
| `dockerimage` | Pull a pre-built image from a registry and run it | Deploy without source/build pipeline |

### Build Pack Interface

```typescript
interface BuildPackResult {
  imageName: string;       // Built or pulled Docker image name
  containerPort: number;   // Port to expose
  outputDir?: string;      // For static: dir to pull assets from
  healthCheck?: string;    // Optional health check path
  composeFile?: string;    // For dockercompose: the compose file content
}
```

### Build Pack Implementations

#### 1. Nixpacks

- **Flow:** Git clone → `nixpacks build .` (generates Dockerfile) → `docker build` → `docker run`
- **Detection:** Nixpacks auto-detects framework from repo contents (Next.js, Django, Rails, Go, etc.)
- **Config:** User can override build/start commands and output directory
- **Dependency:** Requires `nixpacks` binary installed on the worker host

#### 2. Static

- **Base image:** `nginx:alpine`
- **Flow:** Clone → (optional build command) → copy assets from `output_dir` to `/usr/share/nginx/html/` → serve on port 80
- **Config:** User specifies `output_dir` (default: `/dist`), SPA fallback toggle, custom nginx config
- **No framework detection** — assumes pre-built assets

#### 3. Dockerfile

- **Flow:** Git clone → `docker build -f Dockerfile` → `docker run`
- **Config:** User commits a `Dockerfile` in their repo. Shipyard builds it as-is.
- **Port:** User configures the container port Shipyard should route to.

#### 4. Docker Compose

- **Flow:** Git clone → `docker compose -f docker-compose.yml up -d`
- **Config:** User provides `docker-compose.yml` in their repo.
- **Use case:** Apps that bundle a database, cache, or need multiple services.
- **Routing:** Caddy routes to the primary service's port.

#### 5. Docker Image

- **Flow:** `docker pull <image>` → `docker run`
- **Config:** User specifies image name + tag from a registry (Docker Hub, GHCR, etc.)
- **No repository needed** — deploy without connecting a git repo.
- **Use case:** Deploy existing images without rebuilding from source.

### User Configuration Per App

| Field | nixpacks | static | dockerfile | dockercompose | dockerimage |
|-------|----------|--------|------------|---------------|-------------|
| `output_dir` | Optional | Required | N/A | N/A | N/A |
| `build_command` | Override | Optional | N/A | N/A | N/A |
| `run_command` | Override | N/A | N/A | N/A | N/A |
| `port` | Optional | 80 | Required | Optional | Required |
| `dockerfile_path` | N/A | N/A | `./Dockerfile` | N/A | N/A |
| `image` | N/A | N/A | N/A | N/A | Required |
| `compose_file` | N/A | N/A | N/A | `docker-compose.yml` | N/A |
| `is_spa` | N/A | Configurable | N/A | N/A | N/A |
| `custom_nginx_config` | N/A | Optional | N/A | N/A | N/A |

## Consequences

- **Five build paths** share the same deployment state machine. Only execution differs.
- **No migration cost** when adding a new build pack — implement the interface, add the enum value.
- **Nixpacks is optional** — don't need the binary unless using that pack.
- **Docker Compose adds significant complexity** — multi-container lifecycle, networking, service dependencies. Post-MVP.
- **Docker Image is the simplest** — just pull and run. No build step at all.
- **Container routing required** — once you support long-lived containers, Caddy needs to reverse-proxy to them. ADR-0006 needs updating.

## Alternatives Considered

- **Three packs only (static, dockerfile, nixpacks) (rejected):** Misses dockercompose for multi-service apps and dockerimage for pre-built image deploys.
- **Merge dockerimage into dockerfile (rejected):** Different semantics — one builds from source, one pulls a pre-built artifact. Different validation, different config.
- **Skip dockercompose for MVP (accepted):** Will be implemented after the single-container packs are stable. Multi-container orchestration is a separate complexity class.
