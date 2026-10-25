# Decide ADR drift rule (e) re-affirmation - implementation plan
Ticket: d3322341e7572c56198fca7f1fd749 | Parent: Initial testing (d8f35c7cd6eea8d8dfb9ed5da58759)
## Goal
Decide whether rule (e) day-granularity drift requires re-affirmation on every governed-code commit or be relaxed, and fix the rule (d) crash so a pointerless accepted ADR reports instead of dying.
## Non-goals (explicit)
- Do not weaken rules (a)-(c) or the pin requirement.
- No persistence, no new guard framework, no remote CI.
- No silent bulk re-affirmation; each must be deliberate.
## Current state (what exists today, what throws, with file:line)
- `scripts/check-adrs.mjs:138` spreads `pointerFiles.get(id)`, undefined for an accepted decision nothing points at: process dies with TypeError before rule (d) reports (known finding).
- Rule (e) compares days: governed code committed later than its ADR fails pre-commit, so every governed-code commit must re-affirm (known finding).
- `tests/guards/check-adrs.test.ts` has an `it.todo` for rule (d); (a),(b),(c),(e) proven.
## Steps (ordered and concrete, naming exact files, exports and commands)
1. Owner decision: keep day granularity (A) or relax to N days (B). Default A.
2. Fix crash in `scripts/check-adrs.mjs`: use `pointerFiles.get(adrIdOf(f) ?? "") ?? new Set()` before spread; when empty push rule (d) message and skip drift.
3. Ensure rule (d) always reports for accepted decision with no code ref.
4. Convert `it.todo` in `tests/guards/check-adrs.test.ts` to real test: accepted decision with no governed file, commit, run guard, assert exit 1, no crash, output contains `(d)`.
5. Red proof: assert crashed === false in converted test.
6. If B chosen, add owner-approved ADR for new window and update rule (e) + tests; else add one-line comment in guard explaining policy.
7. Run `pnpm test --project guards`, `pnpm check`.
## Files touched (new / modified)
- Modified: `scripts/check-adrs.mjs`
- Modified: `tests/guards/check-adrs.test.ts`
- Possibly: `docs/decisions/0005-*.md`, `docs/decisions/index.md` (only if B)
## ADR obligations (pointer + pin, or "none" and why)
- If drift window changes, new ADR governing guard + tests with pins.
- If keeping day granularity, no new ADR; record decision in commit body.
## Test plan (each new test, which existing it.todo or guard it replaces, and the red proof: what fails without this change)
- Convert `it.todo("rule (d): reports an accepted decision with no code pointer instead of crashing")` to real case asserting exit 1 + `(d)` + crashed false. Red today because process crashes with TypeError.
- Keep existing rule (e) cases unchanged under A.
## Open decisions for the owner (never guess - list them instead)
- Keep day granularity or relax to multi-day window, and N?
- May a re-affirming touch be an empty commit or must it update the ADR doc?
## Out of scope for this ticket
Changing rules (a)-(c), ADR format, or remote CI.
