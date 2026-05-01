# ADR-0009: Env Var Encryption — App-Level AES-256

## Status

Accepted

## Context

Environment variables (including secrets like API keys) are stored per-app in the `env_vars` table. The value must be encrypted at rest. Three approaches:

1. **DB-level encryption** — Postgres `pgcrypto` or similar. The database handles encryption/decryption.
2. **HashiCorp Vault** — Enterprise-grade secret management. Separate service, rotation, auditing.
3. **App-level encryption** — Encrypt/decrypt in the application using AES-256-GCM before DB insert, using a key stored in a server environment variable.

## Decision

**App-level AES-256-GCM encryption.**

- Key stored in server environment variable (`ENCRYPTION_MASTER_KEY`), never in the database.
- Encrypt before inserting to `env_vars.value`.
- Decrypt before injecting into the build container.
- Values are masked in API responses (show `*****` instead of decrypted value).

## Consequences

- **Portable across databases.** No dependency on Postgres `pgcrypto` or any DB-specific feature. Can swap DB engines without changing encryption logic.
- **Full control over algorithm and key rotation.** Key lives in the server env, can be rotated by updating the env var and re-encypting values.
- **Simple to implement.** Node.js `crypto` module handles AES-256-GCM. No external service (Vault) to run and manage.
- **Key compromise = all secrets exposed.** This is acceptable for a self-hosted tool where the operator controls the server environment.
- **No audit log of secret access.** Acceptable for MVP; can be added later.

## Alternatives Considered

- **HashiCorp Vault (rejected):** Overkill for a self-hosted MVP. Requires running and managing an additional service. Adds operational complexity with no proportional benefit.
- **DB-level encryption via `pgcrypto` (rejected):** Ties encryption to Postgres. Loses portability. Also means the database has the key (via extension config), which is less secure than app-level where the DB never sees plaintext or the key.
- **No encryption (rejected):** Unacceptable. Secrets in plaintext in the database is a security failure.

