# Domain Docs — Layout

This repo uses a **single-context** layout for domain documentation.

## Layout

```
/
├── CONTEXT.md          ← Domain glossary
├── docs/
│   └── adr/           ← Architectural Decision Records
│       ├── 0001-self-hosted-control-plane.md
│       ├── 0002-step-aware-failure-handling.md
│       └── ...
```

## Single-Context Rules

- One global `CONTEXT.md` at the repository root
- All ADRs live in `docs/adr/` at the repository root
- No sub-contexts (e.g., `src/frontend/docs/adr/`)

## Consumer Rules

Skills like `improve-codebase-architecture`, `diagnose`, and `tdd` will:
1. Look for `CONTEXT.md` at the repo root
2. Look for ADRs in `docs/adr/`
3. Use the domain vocabulary from these files when discussing the project

## Adding ADRs

When creating a new ADR:
1. Add to `docs/adr/` with sequential numbering (e.g., `0010-webhook-registration.md`)
2. Update this file if layout changes