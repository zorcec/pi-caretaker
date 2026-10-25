# Initial testing (MASTER PLAN for the whole testing tree) - implementation plan
Ticket: d8f35c7cd6eea8d8dfb9ed5da58759 | Parent: root ticket
## Goal
Sequence and coordinate the 11 children so the testing tree lands without conflicting edits, broken guards, or false-green suites; single dependency/risk view.
## Non-goals (explicit)
- This plan does not implement any child; it only orders them.
- No new framework, no persistence, no CI beyond separate child ticket.
## Current state (what exists today, what throws, with file:line)
- `vitest.config.ts` defines four projects (unit/guards/build/e2e) plus separate live config; `pnpm check` runs all four.
- `tests/scaffold.test.ts` pins current stubs and must be deleted when its ticket lands.
- `src/index.ts` never imports `src/health.ts`, so health + commit absent from dist (child 716c69ed).
- `scripts/check-adrs.mjs:138` crashes on pointerless accepted ADRs (child 9771d26d).
- `CHANGELOG.md` is a single heading, so `scripts/release.mjs` refuses every release (child 4d934850).
- `tests/e2e/webhook.e2e.test.ts` (9 todos), `tests/e2e/pipeline.e2e.test.ts` (7 todos), `tests/live/smoke.live.test.ts` (6 todos) hold placeholders.
## Children and ordering
Group A (independent, parallel, no shared files):
1. 9771d26d Fix ADR guard rule (d) crash — `scripts/check-adrs.mjs`, `tests/guards/check-adrs.test.ts`. Must land before 429d5f4f if it adds ADR pointers.
2. 716c69ed Make health reachable from packaged entry — `src/index.ts`, `tests/build/artifact.test.ts`. Low risk.
3. 4d934850 Unblock release path — `CHANGELOG.md`, `.changeset/`, release tests. Independent.
4. f0b72595 Answer CI gating question — `AGENTS.md`, `CONTRIBUTING.md`, possibly `.github/`.
5. d3322341 Decide ADR drift rule (e) — depends on 9771d26d (shares check-adrs files).
Group B (depends on Group A stubs/interfaces):
6. 6cf2146df Webhook listener e2e suite — replaces `src/events.ts` stub `handlePostEvents`; needs queue contract settled. Touches `src/events.ts`, `tests/e2e/webhook.e2e.test.ts`.
7. af48b566 Queue and triage pipeline e2e suite — implements `src/queue.ts`. Touches `src/queue.ts`, `tests/e2e/pipeline.e2e.test.ts`.
8. 429d5f4f Escape hatch enforcement for ADR-0004 — touches `src/events.ts` or new module + tests; coordinate with 6cf2146df to avoid conflicts.
Group C (depends on adapters and listener):
9. 17c69a53 Telegram adapter and Pitgram spike — `src/telegram/index.ts` (interface-only today); needs ADR-0003 pointer discipline.
10. a1ae60c1 Live e2e suite — last; needs listener + queue + telegram + vibeflow emitter. Replaces `tests/live/smoke.live.test.ts` todos.
11. 3a3e48f8 Count guard scripts in coverage — last; changes coverage config, must see final file set. Touches `vitest.config.ts`, thresholds.
## Files touched (new / modified)
- Coordinated across children; no single file owned by master. Master only writes this plan.
## ADR obligations (pointer + pin, or "none" and why)
- Master plan needs no ADR: scheduling, not binding decision. Children adding binding decisions (e.g. 429d5f4f, 17c69a53) must add their own ADR in same change.
## Test plan (each new test, which existing it.todo or guard it replaces, and the red proof: what fails without this change)
- Master has no tests. Each child ships red->green proof per its own plan.
- Gate after each group: `pnpm check` green; `pnpm build` after any `src/index.ts`/`src/health.ts`/`tsup.config.ts` change.
## Open decisions for the owner (never guess - list them instead)
- Whether webhook listener and queue can be developed in parallel given both touch `src/events.ts`/`src/queue.ts` boundaries; recommend sequential.
- Whether coverage threshold should be raised after all children land; recommend final pass.
## Out of scope for this ticket
Implementing any child, adding persistence, or changing V1 non-goals.
