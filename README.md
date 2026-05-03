# Shipyard

A self-hosted deployment control plane for static sites. Shipyard clones GitHub repos, runs builds in isolated Docker containers, uploads output to Garage (S3-compatible storage), and routes traffic via Caddy.

## Quick Start

```bash
cp .env.example .env
docker compose up --build
```

| Service | Port |
|---|---|
| Web (Vite dev) | `http://localhost:5173` |
| API | `http://localhost:3000` |
| Postgres | `localhost:5432` |
| Redis | `localhost:6379` |
| Garage S3 | `http://localhost:3900` |
| Caddy | `http://localhost:80` |

## Architecture

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│   Web    │────→│   API    │────→│  Worker  │
│ (React)  │     │ (Express)│     │ (BullMQ) │
└──────────┘     └────┬─────┘     └────┬─────┘
                      │                │
               ┌──────┴────────────────┴──────┐
               │                              │
          ┌────┴───┐    ┌────────┐    ┌──────┴──────┐
          │ Postgres│    │ Redis  │    │ Garage (S3) │
          └────────┘    └────────┘    └─────────────┘
                                        │
                                    ┌───┴───┐
                                    │ Caddy │
                                    └───────┘
```

- **API** — Express.js REST API. GitHub OAuth, session management, CRUD for apps/deployments.
- **Worker** — Background job processor. Pulls from BullMQ, runs builds in Docker, uploads to Garage.
- **Web** — React SPA served by Vite (dev) or nginx (production).
- **Garage** — Self-hosted S3-compatible object storage.
- **Caddy** — Reverse proxy with auto-HTTPS. Routes `*.yourdomain.com` to Garage.

## Development

### Hot Reload

| Service | Mechanism |
|---|---|
| API | `tsx watch` — restarts on `.ts` changes |
| Worker | `tsx watch` — restarts on `.ts` changes |
| Web | Vite HMR — instant updates for `.tsx`/`.css` |

### Commands

```bash
docker compose up              # Start all services (dev)
docker compose up --build      # Rebuild and start
docker compose down            # Stop all services
docker compose logs -f api     # Tail API logs

pnpm db:generate               # Generate Drizzle migrations
pnpm db:push                   # Push schema to database
```

### Project Structure

```
├── packages/
│   ├── api/          # Express REST API
│   ├── worker/       # BullMQ build processor
│   ├── web/          # React SPA
│   └── shared/       # Drizzle schema, types, validators
├── infra/
│   ├── caddy/        # Caddy configuration
│   └── garage.toml   # Garage S3 configuration
├── docs/
│   ├── adr/          # Architecture Decision Records
│   └── agents/       # Agent skill configuration
├── CONTEXT.md        # Domain glossary
├── PRD.md            # Product requirements
└── docker-compose.*  # Docker Compose files
```

## Production

Production uses multi-stage builds (TypeScript compiled, slim runtime image):

```bash
docker compose -f docker-compose.yaml up -d --build
```

The `docker-compose.override.yaml` is auto-loaded for development. Use `-f docker-compose.yaml` to skip dev overrides.

## Tech Stack

- **Runtime:** Node.js 22 (Alpine)
- **API:** Express.js + Drizzle ORM + Zod validation
- **Queue:** BullMQ on Redis 7
- **Database:** PostgreSQL 16
- **Storage:** Garage (S3-compatible)
- **Proxy:** Caddy 2
- **Frontend:** React + Vite
- **Monorepo:** pnpm workspaces + Turborepo
