# ADR-0011: Docker Build Strategy — Multi-Stage Production + Dev Overrides

## Status

Accepted

## Context

Shipyard is a monorepo with TypeScript packages. Docker images must be small for production, but support hot reload for development. Two conflicting requirements:

- **Production:** Minimal image, compiled JavaScript, production deps only.
- **Development:** Source mounted, dev deps installed, `tsx watch` for hot reload.

## Decision

### Production (`docker-compose.yaml`)

Multi-stage Dockerfiles for API and Worker:
1. `builder` stage: install all deps, compile TypeScript via `tsc`
2. `runtime` stage: `node:22-alpine` with `--prod` deps only, copy compiled JS from builder

Web uses standard multi-stage: Node builder → nginx serving `dist/`.

### Development (`docker-compose.override.yaml`)

Separate `Dockerfile.dev` per package:
- Single stage, all deps installed
- No compilation — source mounted via volumes
- Override `command` to run `tsx watch` or Vite dev server
- Ports exposed for local access

### Compose Pattern

`docker compose up` auto-loads `docker-compose.override.yaml` alongside the base file. Dev gets merged config. Production uses `docker compose -f docker-compose.yaml up` to skip overrides.

## Consequences

- Production images are ~150MB (vs 700MB with dev deps and source).
- Build context reduced to ~17kB via `.dockerignore` (was 2MB+).
- Dev workflow unchanged — `docker compose up` just works.
- Two sets of Dockerfiles to maintain (but dev files are thin).
- pnpm version pinned to `10.33.2` across all Dockerfiles for consistency.

## Alternatives Considered

- **Single Dockerfile with build args (rejected):** Complex conditional logic in Dockerfile. Harder to reason about.
- **Volume-mounted dev deps in single Dockerfile (rejected):** Still installs dev deps in production image if not careful with multi-stage.
- **Pre-built base image for workspace (considered):** Could reduce duplication but adds build step before compose.
