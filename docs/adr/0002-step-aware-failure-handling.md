# ADR-0002: Step-Aware Failure Handling

## Status

Accepted

## Context

The initial plan described blanket retry logic — "if the build fails, retry X times." This is simple to implement but wastes resources retrying user code errors (a JavaScript syntax error will never succeed on retry) and misses opportunities to handle infrastructure errors differently from user errors.

## Decision

We implement step-aware failure handling, where each Build Step has its own failure classification and retry policy:

### Step 1: Clone (git clone --depth 1)

- **Exit code 128 (auth/not found):** Fail immediately. Pre-validated by GitHub OAuth token check before the build starts. If somehow reaches clone, it is a user error. No retry.
- **Network timeout:** Retry up to 3× with exponential backoff (2s, 4s, 8s). After 3 failures, mark as failed.

### Step 2: Install (npm install)

- **404 Not Found:** Fail immediately. The package does not exist; retrying will not change this.
- **Network timeout:** Retry up to 3×. Transient registry issues are common.
- **ENOSPC (disk full):** System error. Alert ops immediately. Fail all queued builds. No retry — retrying will not fix full disk. Root cause must be resolved externally.

### Step 3: Build (npm run build)

- **Any non-zero exit:** Fail immediately. User code error. No retry — retrying will not fix a JavaScript syntax error.
- **OOM (heap out of memory):** Fail immediately. User should optimize their build or reduce bundle size. Document the 2GB memory limit so users know.

### Step 4: Verify output

- **Output directory missing or empty:** Fail with a specific error message. Not a retry — the build command is wrong. Do not assume `dist` if blank.

### Step 5: Upload (S3 / Garage)

- **Network timeout:** Retry up to 3× with exponential backoff. Transient storage issues.
- **403 Access Denied:** System error. Alert ops. Fail all queued builds immediately. Credentials are wrong — retrying will not fix this.

## Consequences

- Each step has a clear, deterministic policy — no magical "our fault vs their fault" discrimination.
- Retry resources are not wasted on irrecoverable errors (user code, bad packages).
- System errors (disk full, bad S3 credentials) fail all builds and alert ops — the platform does not silently degrade.
- Error messages shown to users are specific (e.g., "Build succeeded but output directory 'dist/' is empty" rather than "Build failed").

## Alternatives Considered

- **Blanket retry (rejected):** Would retry user code errors, wasting worker time and delaying failure feedback.
- **AI-powered error classification (rejected):** Would parse error messages and classify — too complex for MVP, and the step taxonomy above covers all practical cases.
- **No retry (rejected):** Would make network blips require manual user retry — bad UX for a control plane.

