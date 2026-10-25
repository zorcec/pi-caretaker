# Count guard scripts in coverage - implementation plan
Ticket: 3a3e48f86962c1e13e0dcf3d622a6e | Parent: Initial testing (d8f35c7cd6eea8d8dfb9ed5da58759)
## Goal
Make scripts/*.mjs measurable by the v8 coverage provider by enabling allowJs and a TypeScript entry shim, so guard scripts count toward coverage thresholds.
## Non-goals (explicit)
No change to coverage thresholds for src/**; no rewriting guards in TS; no changing test behavior.
## Current state (what exists today, what throws, with file:line)
vitest.config.ts coverage.include lists scripts/**/*.mjs but v8 does not attribute child-process runs, so scripts score 0. tsconfig.json has allowJs false, so .mjs cannot be type-checked. scripts/check-git-identity.mjs and scripts/release.mjs already export functions behind a main() guard; scripts/check-adrs.mjs has no main guard/export.
## Steps (ordered and concrete, naming exact files, exports and commands)
1. Set tsconfig.json compilerOptions.allowJs = true.
2. Refactor scripts/check-adrs.mjs to export its check function and guard `main()` behind `process.argv[1] === fileURLToPath(import.meta.url)` (matching release.mjs pattern).
3. Add tests/unit coverage test importing the guard modules and invoking exported functions in-process.
4. Update vitest.config.ts coverage.include if needed; keep thresholds keyed to src/**.
5. Run pnpm test:coverage to confirm scripts now score > 0.
## Files touched (new / modified)
Modified: tsconfig.json, vitest.config.ts, scripts/check-adrs.mjs. New: possibly tests/unit/guards-coverage.test.ts.
## ADR obligations (pointer + pin, or "none" and why)
None new; guard scripts are not governed by an ADR.
## Test plan (each new test, which existing it.todo or guard it replaces, and the red proof: what fails without this change)
New in-process unit test calling exported guard check functions; red proof: without allowJs/export, import fails at typecheck/test time.
## Open decisions for the owner (never guess - list them instead)
Whether to require 100% function coverage on scripts/** (currently 0). Whether check-adrs.mjs refactor scope is acceptable.
## Out of scope for this ticket
Threshold changes for src/**, rewriting guards as .ts, CI gating.
