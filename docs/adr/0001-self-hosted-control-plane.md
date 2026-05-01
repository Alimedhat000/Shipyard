# ADR-0001: Self-Hosted Control Plane Philosophy

## Status
Accepted

## Context
The original plan (based on a YouTube video) described a "managed service infrastructure orchestration platform, similar to Vercel or Cloudflare Pages" with per-user quotas, deploy rate limits, and storage caps. The natural path from this description leads toward a SaaS product with business-layer constraints baked into core logic.

## Decision
We rejected this model. Instead, BigBoss adopts the self-hosted deployment control plane philosophy (inspired by Coolify):

- **No per-user storage quotas or deploy rate limits.** Resource usage is visible to users (dashboard) but not artificially capped.
- **No billing layer.** There is no monetization logic in the system, nor will there ever be.
- **No business-constraint blocking.** Blocking only occurs when the system is in genuine danger (disk full, OOM, worker exhaustion).
- **Infrastructure-constrained only.** The only limits are hardware/OS-level: container memory (2GB), build timeout (15 min), max concurrent builds = worker count.

## Consequences
- The platform is a deployment orchestrator, not a hosting provider. Users own their infrastructure.
- No quota enforcement code in any layer. The queue provides backpressure naturally when workers are saturated.
- Multi-tenancy is achieved by deploying multiple instances, not by serving multiple organizations from one deployment.
- Schema is multi-org-ready (each user → one organization) so teams can be added later without migration.
- Interview positioning shifts from "I built a Vercel clone" to "I built a self-hosted deployment control plane with worker orchestration, step-aware error handling, and S3-compatible storage routing."

## Alternatives Considered
- **SaaS with quotas (rejected):** Would require per-user tracking, quota enforcement middleware, and a billing layer — all orthogonal to the core deployment engine.
- **Kubernetes operator (rejected):** Overkill for MVP. Docker Compose is sufficient for single-server deployments, which is the primary self-hosted target.
- **Managed PaaS (rejected):** Would lock users into the hosting platform. BigBoss is designed to run anywhere (local dev, VPS, bare metal).