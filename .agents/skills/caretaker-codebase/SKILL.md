---
name: caretaker-codebase
description: Map of the pi-caretaker repo — where src, docs, scripts, and guards live and which hook runs when. Load when navigating or changing this repo.
---

# Caretaker Codebase

Orchestration and brevity behavior comes from the owner's **global** skill
set (`orchestrate`, `terse`, and friends live in `~/.claude/skills/` — do
not copy them here; two copies drift and a repo copy would shadow the one
the owner keeps improving). The skills in this repo are project knowledge,
so a stranger cloning it still gets the rules that matter.

## Source (`src/`) — the contract plus the listener, queue, and entry

- `index.ts` — the real Pi extension entry: default-exported factory taking
  `pi: ExtensionAPI`. Starts the listener + queue + background-turn pump on
  `session_start`, stops idempotently on `session_shutdown`, registers
  `caretaker-status` and the `caretaker_notify` model tool. Env names are
  provisional (see `src/config.ts`); the Pi API surface comes from
  `@earendil-works/pi-coding-agent` (ADR-0001, ADR-0003, ADR-0004).
- `config.ts` — the ADR-0005 operator contract (env names, requiredness,
  defaults) with `ConfigurationError` codes. Renaming a key breaks
  `tests/config.test.ts` loudly by design. Never log values.
- `events.ts` — zod envelope schema, `MAX_EVENT_BODY_BYTES` (64 KiB),
  `isBodyOversized`, triage boundary (`buildTriageRequest`,
  `TRIAGE_INSTRUCTIONS`), and the implemented `handlePostEvents`
  (bearer check → cap → parse → schema → exactly one enqueue; 202 only on
  acceptance). Security-sensitive (ADR-0001, ADR-0002).
- `queue.ts` — bounded in-memory FIFO plus the single-flight delivery pump
  (`createEventQueue`, `startDelivery`). Documented non-durable: a fresh
  instance starts empty. Sequencing/overflow/restart-loss pinned by tests.
  Security-relevant: `202`-means-queued lives or dies here.
- `health.ts` — `buildHealth` / `getHealth`; commit injected at build time
  via `tsup.config.ts` (`__PI_CARETAKER_COMMIT__`, falls back to `"dev"`).
  Actually implemented and tested — the one load-bearing runtime file.
- `telegram/index.ts` — the one owned Telegram path (ADR-0003).
  **Interface only: zero runtime exports** (pinned by test). The adapter
  (Pitgram validation first, grammY fallback) is a future ticket.
- `prompts/triage.md` — triage guidance draft: untrusted-data rule,
  notification discipline, escape hatch. Security-sensitive (ADR-0002,
  ADR-0004). Plain markdown read at runtime — treat edits like code.

## Decisions and docs (`docs/`)

- `docs/decisions/` — four binding ADRs; `index.md` is the front door,
  `TEMPLATE.md` the shape. Every accepted ADR has a `## Pins` section
  naming tests and a one-line `ADR-NNNN` pointer in the code it governs.
  The gate reads them mechanically: `check-adrs.mjs` checks dangling refs,
  pins exist, index in sync, every ADR referenced from code, and
  **day-granularity drift** (governed code newer than its ADR fails the
  commit — fix by re-reading the ADR and committing an update or
  re-affirming touch, or by superseding it).
- `docs/ops/self-hosting.md` — required host behavior (restart policy,
  persistent volume, private networking). Behavior, not config.
- `docs/integrations/vibeflow.md` — the first real event source; documents
  the one-way POST and the envelope example.
- `docs/concept/` — the source concept doc. Aspirations, not built truth;
  never cite it as what the code does.
- `docs/research/` — where the Pitgram spike lands first.

## Guards, hooks, and release (`scripts/`, `.husky/`)

- `scripts/check-adrs.mjs` + `scripts/check-git-identity.mjs` run on
  **pre-commit** (fail fast, no network). Identity has no opt-out and no
  grandfathered SHAs — the list starts empty on purpose.
- **pre-push** runs typecheck → lint → test, in that order. There is no
  remote CI: these local gates are the only gates.
- `scripts/release.mjs` cuts releases from CHANGELOG and **refuses empty
  notes**; needs `gh auth login`. `.changeset/` holds pending changesets.
- Config at root: `package.json` (five commands + `test:coverage` +
  `release`), `tsup.config.ts`, `vitest.config.ts` (single include:
  `tests/**/*.test.ts`), `eslint.config.mjs` (one rule: unused symbols —
  `tsc` cannot flag unused imports, so the linter does), `tsconfig.json`
  (strict + `noUnusedLocals`), `.nvmrc` (Node 22), `CONTRIBUTING.md`.

## Where secrets must never appear

No `.env` files, no tokens in fixtures, no credentials in logs — there is
deliberately no `.env` support; configuration arrives via the environment
at runtime. The bearer token is checked before parsing and never logged;
webhook payloads are never logged whole (secrets hide in `metadata`).
`SECURITY.md` owns the threat model: webhook token, untrusted payload,
SSH capability.

## What is NOT in this repo (and why)

No `deploy/`, no Dockerfile, no database, no dashboards, no persistence
layer — all V1 non-goals, binding without an ADR. Deployment config lives
outside; `docs/ops/` describes self-hoster behavior only. If a file you
expect is missing, check the non-goals before assuming an omission.
