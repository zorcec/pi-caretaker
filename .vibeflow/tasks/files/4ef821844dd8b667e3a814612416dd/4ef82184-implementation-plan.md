# Health reachable from the packaged entry - implementation plan
Ticket: 4ef821844dd8b667e3a814612416dd | Parent: Initial implementation (0ce8c29edee87ade5c6ca89f4a3c77)
## Goal
Expose an entry-owned health accessor from the normal `src/index.ts` package bundle so installed consumers—and the HTTP listener—can obtain exactly `{status:"ok", version:"0.1.0", commit:<build SHA>}` with the tsup-injected commit.
## Non-goals (explicit)
- Do not implement the HTTP server/routes, listener activation, queue, triage, Telegram, deeper LLM/Telegram readiness, runtime git lookup, or deployment configuration.
- Do not add persistence, dedupe/correlation, dashboards, collectors, a database, or automatic infrastructure changes.
- Do not add environment configuration or `.env` files; this ticket needs no secret.
## Current state (what exists today, what throws, with file:line)
- `src/health.ts:9-30` already defines `HealthReport`, pure `buildHealth(version, commit)`, and `getHealth(version)`, whose commit is `__PI_CARETAKER_COMMIT__` or source-test fallback `dev`.
- `src/index.ts:8-22` exports only `CaretakerExtension`/`extension`; it never imports health, and `activate()` intentionally throws the separate activation TODO.
- `tsup.config.ts:7-24` obtains `git rev-parse --short HEAD`, falls back to `dev` only when unavailable, builds `src/index.ts`, and replaces `__PI_CARETAKER_COMMIT__` at build time.
- `tests/build/artifact.test.ts:42-52` explicitly builds both `src/index.ts` and `src/health.ts`; lines 68-80 prove injection only through the standalone health entry.
- `tests/build/artifact.test.ts:97-104` explains the package-entry gap and leaves the entry-level assertion as `it.todo`.
## Steps (ordered and concrete, naming exact files, exports and error codes)
1. In `src/index.ts`, import `HealthReport` and alias the module-level `getHealth(version)` from `src/health.ts`; retain the existing ADR-0001 pointer.
2. Export an entry-owned zero-argument `getHealth(): HealthReport` that delegates to the imported health function with `extension.version`. Keep the extension name/version source single and leave `extension.activate()` unchanged and still throwing.
3. Do not alter `tsup.config.ts`: its existing `entry: ["src/index.ts"]` and `define.__PI_CARETAKER_COMMIT__` are sufficient once the entry imports health. Do not read git or package metadata at runtime.
4. In `tests/build/artifact.test.ts`, extend `BuiltIndex` with `getHealth(): {status:string;version:string;commit:string}` and replace the final todo with a real assertion that `await import(index.js).getHealth()` deep-equals `{status:"ok",version:"0.1.0",commit:shortHead()}`.
5. Keep the existing standalone health injection checks unless simplifying the build fixture is demonstrably behavior-neutral; the new entry-level assertion is the required regression pin and must exercise `index.js`, not `health.js`.
6. Assert the emitted `index.d.ts` contains the public health accessor/return type so runtime and declaration surfaces cannot drift. If needed, add a direct assertion that emitted `index.js` contains no `__PI_CARETAKER_COMMIT__` placeholder.
7. Run the focused build test red before the source change, then green; run `pnpm check` and `pnpm build`, and inspect `git diff --check` and staged state before commit.
## Files touched (new / modified)
- Modified: `src/index.ts`, `tests/build/artifact.test.ts`.
- Unchanged: `src/health.ts`, `tsup.config.ts`, `package.json`.
- New/deleted: none.
## ADR obligations (pointer + pin, or "none" and why)
- No new ADR: this closes the already-documented reachability gap and implements ADR-0001's existing health/version/commit contract without adding a binding decision.
- Keep the `ADR-0001` pointer in `src/index.ts`; the converted entry-level test in `tests/build/artifact.test.ts` pins packaging while `tests/health.test.ts` remains the shape pin named by ADR-0001. No ADR/index edit is required unless implementation changes the contract rather than merely exposing it.
## Test plan (each new test, which existing it.todo it replaces, and the red proof: what fails without this change)
- Replace `tests/build/artifact.test.ts` todo “GET /health is reachable from the packaged entry, carrying the injected commit” with an import of built `index.js` and exact equality on status, extension version, and `shortHead()`; red because current `BuiltIndex` runtime has no `getHealth` export.
- Extend the existing declaration test to require the entry-level `getHealth` and `HealthReport` surface; red because current `index.d.ts` contains only the extension contract.
- Optionally strengthen the existing placeholder test to inspect `index.js` as well as `health.js`; red before wiring because the entry contains no health implementation, so pair this with the callable assertion rather than treating string absence alone as proof.
- Record red→green evidence using `pnpm vitest run --project build tests/build/artifact.test.ts`; finish with the full `pnpm check`.
## Open decisions for the owner (never guess - list them instead)
- Confirm the public entry API should be the proposed zero-argument `getHealth()` tied to `extension.version`, rather than re-exporting the lower-level `getHealth(version)` and making every consumer supply a version. The source comment says the entry supplies the version, but no function signature is currently binding.
- Confirm whether the standalone `health.js` test entry remains useful fixture coverage; the shipped tsup config emits only `index.js`, so removing that extra fixture entry later would be cleanup, not required for this ticket.
## Out of scope for this ticket
Turning the health accessor into an HTTP `GET /health` route (ticket dadd90ae), authenticating health, deeper readiness/dependency checks, changing commit fallback policy, deriving version from package metadata, changing activation, or any deployment/observability feature.
