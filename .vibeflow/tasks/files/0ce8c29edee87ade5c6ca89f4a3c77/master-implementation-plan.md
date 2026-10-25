# Initial implementation - MASTER EXECUTION PLAN

Ticket: 0ce8c29edee87ade5c6ca89f4a3c77 | Parent: root ticket
## Goal
Sequence the 8 implementation tickets so dependencies land first, parallelization is safe, and ADR drift/day-granularity guard stays green.
## Non-goals (explicit)
No persistence, dedupe, dashboards, collectors, DB, auto infra changes (V1 non-goals). No re-planning per-ticket scope.
## Current state (what exists today, what throws, with file:line)
All 8 children todo: 4360b8d8 vibeflow source, 4ef82184 health reachable, 6a8e1458 queue, 6e7eaef7 triage turn, baac47cd escape hatch bypass, dadd90ae HTTP listener, e443e5b4 activation+env, f8f1f597 telegram adapter. Stubs: src/index.ts activate() throws (TODO pi-caretaker-1), src/events.ts handlePostEvents() throws.
## Steps (ordered and concrete, naming exact files, exports and commands)
Phase 0 (parallel, no deps): e443e5b4 activation+env config; f8f1f597 telegram adapter (after Pitgram spike 17c69a53); baac47cd escape hatch bypass.
Phase 1 (depends Phase 0): dadd90ae authenticated HTTP listener (needs env config + queue interface); 6a8e1458 bounded queue (needs listener contract).
Phase 2 (depends Phase 1): 6e7eaef7 background triage turn serialized session (needs queue delivery + telegram adapter + escape hatch).
Phase 3 (depends Phase 2): 4ef82184 health reachable (wires health into index via listener); 4360b8d8 vibeflow as first event source (needs listener + triage).
Phase 4: 429d5f4f escape hatch enforcement (strengthens tests after baac47cd).
Also 17c69a53 Telegram spike must precede f8f1f597.
Each commit: pnpm check (+ pnpm build when src/index/health/tsup touched). ADR pointers added in same change.
## Files touched (new / modified)
Across children: src/index.ts, src/events.ts, src/queue.ts, src/health.ts, src/telegram/*, src/prompts/triage.md, tests/*, docs/decisions/* (if needed).
## ADR obligations (pointer + pin, or "none" and why)
ADR-0001..0004 all govern; each child adds pointer comment in governed file. New ADR only if fallback Telegram or new alert class.
## Test plan (each new test, which existing it.todo or guard it replaces, and the red proof: what fails without this change)
Replace it.todo in tests/e2e/webhook.e2e.test.ts (9) and pipeline.e2e.test.ts (7) as children land; delete tests/scaffold.test.ts when stubs replaced. Each child ships biting test (no placeholders).
## Open decisions for the owner (never guess - list them instead)
Pitgram go/no-go; version source; escape-hatch config location; whether health exposed via API or route only.
## Out of scope for this ticket
Per-ticket implementation details (see child plans).}