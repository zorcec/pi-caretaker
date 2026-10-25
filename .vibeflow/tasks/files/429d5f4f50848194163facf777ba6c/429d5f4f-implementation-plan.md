# Escape hatch enforcement for ADR-0004 - implementation plan

Ticket: 429d5f4f50848194163facf777ba6c | Parent: Initial testing (d8f35c7cd6eea8d8dfb9ed5da58759)
## Goal
Make tests/escape-hatch.test.ts bite on actual enforcement rather than prose regex only, by wiring the deterministic bypass into code and pinning it. Depends on Deterministic escape hatch bypass (baac47cd) implementation ticket for the bypass logic.
## Non-goals (explicit)
No new alert classes without owner decision; no persistence of escape-hatch list; no model judgment in bypass path.
## Current state (what exists today, what throws, with file:line)
tests/escape-hatch.test.ts: regex over src/prompts/triage.md prose only. src/prompts/triage.md: guidance draft naming escape hatch. ADR-0004 accepted, pins tests/escape-hatch.test.ts. baac47cd plan attached (implementation ticket).
## Steps (ordered and concrete, naming exact files, exports and commands)
1. Land baac47cd first (bypass module + tests).
2. Add deterministic classifier/export in src (e.g. src/escape-hatch.ts or inside events.ts) listing host-dark and backups-dead as bypass classes; import in triage path.
3. Strengthen tests/escape-hatch.test.ts: assert the classifier returns bypass=true for host-dark/backups-dead without invoking triage model; assert no model call. Keep prose regex assertions (ADR pointer).
4. Add ADR-0004 pointer comment in governed source file.
5. Run pnpm check.
## Files touched (new / modified)
Modified: tests/escape-hatch.test.ts, src/prompts/triage.md (if wording), new or existing src module. New ADR only if list changes.
## ADR obligations (pointer + pin, or "none" and why)
ADR-0004 governs; add one-line ADR-0004 pointer in governed source. Pin tests/escape-hatch.test.ts (already pinned). No new ADR unless alert classes change.
## Test plan (each new test, which existing it.todo or guard it replaces, and the red proof: what fails without this change)
tests/escape-hatch.test.ts: add classifier unit test asserting bypass for "host gone dark"/"backups dead" and no bypass for others. Red proof: deleting bypass branch makes classifier return false -> test fails.
## Open decisions for the owner (never guess - list them instead)
Whether escape-hatch list lives in config vs code; promotion of new alert classes.
## Out of scope for this ticket
Telegram adapter, listener.}