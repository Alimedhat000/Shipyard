# ADR-0010: Webhook Registration & Multi-Branch Strategy
## Status
Accepted
## Context
BigBoss supports auto-deploy via GitHub webhooks. Two key questions need answering:
1. When do you register webhooks?
2. How do you handle multiple apps from the same repo with different branches?
## Decision
**Webhook Registration:**
- Register webhook at app creation time (not OAuth time)
- One webhook per unique GitHub repo (not per app)
- If user deploys same repo twice with different branches, only ONE webhook needed

**Registration Flow:**
```javascript
POST /apps
{
  github_repo: "user/repo",
  branch: "main"
}
// On app creation:
1. Check if webhook already exists for this repo
2. If not, register webhook via GitHub API
3. Save webhook_id in database
```

**Webhook Handler:**
```javascript
POST /webhooks/github
1. Validate X-Hub-Signature-256
2. Extract repo + branch from payload
3. Query: SELECT * FROM apps WHERE github_repo = X AND branch = Y AND auto_deploy = true
4. Queue deployment for ALL matching apps (can be multiple)
5. Return 200 OK (GitHub expects this)
```

**Multi-Branch Handling:**
- If user has App A (repo: user/repo, branch: main) and App B (repo: user/repo, branch: staging)
- Push to main → deploys App A only
- Push to staging → deploys App B only
- Push to feature-branch → no deploy (no matching app)
- If same repo+branch has multiple apps with auto_deploy=true → deploy ALL of them

## Consequences
- Two apps from same repo, different branches → both deploy on their respective pushes
- One webhook per repo reduces GitHub webhook limit concerns
- Webhook handler filters by branch, so webhooks are repo-scoped, not app-scoped
- If webhook registration fails (403 - no admin access), app creation still succeeds but auto_deploy is disabled

## Alternatives Considered
- **Register webhook at OAuth time (rejected):** Would register webhooks for ALL user repos, even ones they don't want to deploy
- **One webhook per app (rejected):** GitHub has webhook limit per repo (25). Users might want many apps from same repo.
- **Branch-specific webhook registration (rejected):** GitHub doesn't support branch filtering at registration time. Must filter in handler.

## Out of Scope
- Webhook retry on 5xx errors (GitHub handles this)
- Delivery logs (stored by GitHub, not BigBoss)