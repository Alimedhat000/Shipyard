# ADR-0005: Separation of Deployment and Build Job
## Status
Accepted

## Context
The initial design had a single `deployments` table that mixed logical deployment state (commit SHA, status, logs) with execution state (worker ID, retry attempts, queue status). As the system grew, this coupling made it hard to reason about retries, worker scaling, and state tracking.

A Deployment is a logical concept: "I deployed this commit at this time." A Build Job is an execution event: "Worker X tried to build this deployment, attempt #2."

## Decision
We split into two tables:

**`deployments`** — logical state:
- id, app_id, status, commit_sha, commit_message, branch
- deployed_at, started_at, finished_at
- References `active_deployment_id` from apps table

**`build_jobs`** — execution state:
- id, deployment_id, status, attempts, worker_id
- started_at, finished_at

The queue (BullMQ) stores only `deployment_id`. The worker fetches the full deployment from the database.

## Consequences
- Safe retries: a failed Build Job can be retried without duplicating Deployment records.
- Worker scaling: any worker can pick up any job; the job is stateless (just an ID).
- Independent state tracking: deployment status (success/failed) is separate from job execution state (pending/running/retrying).
- Slightly more complex queries when joining deployment + latest job for logs/debugging.

## Alternatives Considered
- **Single table (rejected):** Simpler queries, but retries create duplicate rows or overwrite execution state. Unclear separation of concerns.
- **Job embedded in deployment as JSON (rejected):** Would work for MVP but makes querying job state (e.g., "which jobs are running?") awkward and prevents DB-level indexing on job fields.