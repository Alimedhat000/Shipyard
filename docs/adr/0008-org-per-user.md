# ADR-0008: Organization-Per-User (MVP) with Teams Designed In

## Status

Accepted

## Context

Every user needs to own apps. The schema question: do we put `user_id` directly on the `apps` table, or introduce an `organizations` table with `organization_members`?

Putting `user_id` on apps is simpler for MVP. But adding it later requires a migration: create organizations, assign users, move `user_id` to `organization_id`. This is a non-trivial schema change that touches every query.

## Decision

Design for teams from day one:

- Every user automatically gets one personal Organization on signup.
- `apps.organization_id` (not `user_id`) owns the app.
- `organization_members` links users to orgs (role: owner, member, etc.).
- MVP UI is single-user — but the schema already supports teams.

This is inspired by GitHub's model: users _have_ organizations, they don't _become_ them.

## Consequences

- No migration needed when teams are added in v2. The schema is already multi-user ready.
- Slightly more complex queries in MVP: `apps` JOIN `organization_members` to find a user's apps. Acceptable trade-off.
- `organization_id` scoping means two users can both have an app named "myapp" (different orgs). This matches our self-hosted model: one instance = one org.
- The "personal org" concept is invisible to the user in MVP. It's just their account.

## Alternatives Considered

- **`user_id` directly on apps (rejected):** Simpler MVP, but requires a painful migration when teams ship. The cost of changing our mind later is high.
- **No orgs at all, just users (rejected):** Would prevent teams entirely without a full rewrite. BigBoss is a control plane — orgs are a core concept.
- **GitHub-style "user is an org" (rejected):** Would make the `users` table double as orgs. Messy when real orgs are added later.

