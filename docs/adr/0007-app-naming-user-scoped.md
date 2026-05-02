# ADR-0007: App Naming — User-Scoped (Not Globally Unique)

## Status

Accepted

## Context

Vercel and similar SaaS platforms enforce globally unique app names — only one user can own "myapp" across the entire platform. This makes sense for a multi-tenant SaaS where `myapp.vercel.app` must resolve to exactly one deployment.

BigBoss is a self-hosted control plane. Each instance serves one organization (multi-tenancy via multiple instances, not via one shared deployment). Therefore, global name uniqueness is unnecessary and would impose artificial constraints on users.

## Decision

App names are scoped to the **Organization**, not globally unique:

```
organizations
  id, name

apps
  id, organization_id, name  ← unique constraint: (organization_id, name)
```

Two different organizations can both have an app named "myapp". Within the same organization, names must be unique.

The `active_deployment_id` on the app record, combined with org-scoped names, makes routing unambiguous: Caddy maps `myapp.bigboss.dev` → the app named "myapp" in the resolved organization.

## Consequences

- No artificial "name taken" errors for users in different orgs.
- Schema naturally supports teams later: add `organization_members`, multiple users in one org, same app namespace.
- Caddy routing stays simple: `server_name` maps to app slug, which is unique within the org.
- No global name registry or cross-org name conflict checks needed.

## Alternatives Considered

- **Globally unique app names (rejected):** Would mimic Vercel's SaaS model, which doesn't apply to a self-hosted control plane where each instance is its own org.
- **Global slug with randomization (rejected):** `myapp-xyz123.bigboss.dev` — bad UX, defeats the purpose of predictable URLs.
- **DNS-level separation per org (rejected):** Would require `org1.bigboss.dev` and `org2.bigboss.dev` — overkill for MVP where each user = one org.

