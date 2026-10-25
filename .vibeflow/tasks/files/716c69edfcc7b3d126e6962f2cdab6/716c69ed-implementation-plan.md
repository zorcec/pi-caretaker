# Make health reachable from the packaged entry - implementation plan

Ticket: 716c69edfcc7b3d126e6962f2cdab6 | Parent: Initial testing (d8f35c7cd6eea8d8dfb9ed5da58759)
## Goal
Make GET /health reachable from dist/index.js carrying the tsup-injected commit, by wiring src/health.ts into src/index.ts via the HTTP listener ticket. Converts the artifact.test.ts it.todo into a real assertion.
## Non-goals (explicit)
No deeper readiness checks (LLM/Telegram reachability) per ADR-0001; no persistence.
## Current state (what exists today, what throws, with file:line)
src/index.ts: activate() throws "not implemented" (stub). src/index.ts never imports src/health.ts. tests/build/artifact.test.ts: it.todo at bottom "GET /health is reachable from the packaged entry, carrying the injected commit". tsup.config.ts defines __PI_CARETAKER_COMMIT__.
## Steps (ordered and concrete, naming exact files, exports and commands)
1. Depends on Authenticated HTTP listener (dadd90ae) and Health reachable (4ef82184). Land those first.
2. In src/index.ts activate(), import getHealth/buildHealth from ./health.js and wire listener route GET /health returning getHealth(version) with version from package/extension.
3. Ensure tsup entry still includes health transitively so define substitution applies to dist/index.js; verify no __PI_CARETAKER_COMMIT__ placeholder remains.
4. Update tests/build/artifact.test.ts: replace it.todo with real assertion importing dist/index.js and calling health path / asserting getHealth exported or health reachable; keep red proof (revert import -> fails).
5. Run pnpm build explicitly + pnpm check.
## Files touched (new / modified)
Modified: src/index.ts, tests/build/artifact.test.ts. Possibly tsup.config.ts.
## ADR obligations (pointer + pin, or "none" and why)
ADR-0001 governs health shape {status, version, commit}; add pointer comment in src/index.ts. tests/health.test.ts + tests/build/artifact.test.ts pin.
## Test plan (each new test, which existing it.todo or guard it replaces, and the red proof: what fails without this change)
tests/build/artifact.test.ts: replace it.todo with assertion that dist/index.js exposes health carrying injected commit. Red proof: remove import in src/index.ts -> health unreachable -> test fails.
## Open decisions for the owner (never guess - list them instead)
Whether health is exposed via extension API or only HTTP route; version source (package.json vs hardcoded 0.1.0).
## Out of scope for this ticket
Listener auth, queue, Telegram.}