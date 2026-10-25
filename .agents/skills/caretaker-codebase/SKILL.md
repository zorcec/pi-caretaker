---
name: caretaker-codebase
description: Map of the pi-caretaker repo — where src, docs, scripts, and guards live and which hook runs when. Load when navigating or changing this repo.
---

# Caretaker Codebase

## Source (`src/`)

- `index.ts` — extension entry (stub). `events.ts` — envelope schema + size
  cap + triage boundary. `queue.ts` — bounded FIFO interface (no semantics).
  `health.ts` — `GET /health` shape, commit injected at build time.
- `telegram/` — the one owned Telegram path, interface only (ADR-0003).
- `prompts/triage.md` — triage draft: untrusted-data rule + escape hatch.

## Decisions and docs

- ADRs: `docs/decisions/` (`index.md` is the front door, `TEMPLATE.md` the
  shape). Every accepted ADR has `Pins:` tests and a one-line `ADR-NNNN`
  pointer in the code it governs.
- `docs/ops/self-hosting.md` — required host behavior, no config.
  `docs/research/` — Pitgram spike lands here first.

## Guards and hooks

- `scripts/check-adrs.mjs` + `scripts/check-git-identity.mjs` run on
  **pre-commit** (fail fast, no network). **Pre-push** runs
  typecheck + lint + test. `scripts/release.mjs` cuts releases from
  CHANGELOG and refuses empty notes.
