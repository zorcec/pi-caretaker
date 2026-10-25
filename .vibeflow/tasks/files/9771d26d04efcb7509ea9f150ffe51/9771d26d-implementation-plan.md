# Fix ADR guard rule (d) crash - implementation plan
Ticket: 9771d26d04efcb7509ea9f150ffe51 | Parent: Initial testing (d8f35c7cd6eea8d8dfb9ed5da58759)
## Goal
Make check-adrs.mjs rule (d) report an accepted decision with no code pointer instead of crashing with a TypeError.
## Non-goals (explicit)
No new rules, no changes to (a)/(b)/(c)/(e), no ADR content changes, no coverage changes.
## Current state (what exists today, what throws, with file:line)
scripts/check-adrs.mjs:138 `const governed = [...pointerFiles.get(adrIdOf(f) ?? "")];` spreads undefined for an accepted decision that nothing points at, throwing TypeError before (d) runs. tests/guards/check-adrs.test.ts:236-239 holds an it.todo documenting the bug.
## Steps (ordered and concrete, naming exact files, exports and commands)
1. Edit scripts/check-adrs.mjs line 138 to default to empty array: `const governed = [...(pointerFiles.get(adrIdOf(f) ?? "") ?? new Set())];`.
2. Convert the it.todo at tests/guards/check-adrs.test.ts:238 into a real test that builds a temp repo, removes one pointer (or creates an ADR with no reference), runs the guard as child process, asserts non-zero exit and stderr contains "(d)".
3. Run pnpm check; confirm red (without fix) then green.
## Files touched (new / modified)
Modified: scripts/check-adrs.mjs, tests/guards/check-adrs.test.ts.
## ADR obligations (pointer + pin, or "none" and why)
None: guard script itself is not governed code.
## Test plan (each new test, which existing it.todo or guard it replaces, and the red proof: what fails without this change)
Replaces it.todo "rule (d): reports an accepted decision with no code pointer instead of crashing". New test asserts exit code != 0 and stderr matches /\(d\)/. Red proof: with original line 138, process crashes with TypeError and the test (expecting "(d)" message) fails.
## Open decisions for the owner (never guess - list them instead)
None.
## Out of scope for this ticket
Rules (a),(b),(c),(e) already proven; pointer file scanning scope; coverage counting.
