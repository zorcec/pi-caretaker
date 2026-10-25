# Webhook listener e2e suite - implementation plan
Ticket: 6cf2146df26e12db2bfb6ffb21d0b2 | Parent: Initial testing (d8f35c7cd6eea8d8dfb9ed5da58759)

## Goal
Replace the nine `it.todo` placeholders in `tests/e2e/webhook.e2e.test.ts` with real socket-level tests that boot the authenticated listener from ticket dadd90ae and exercise GET /health and POST /events against it.

## Non-goals (explicit)
- No change to listener behavior, queue implementation, or triage. This ticket only turns pending assertions into executable tests.
- No new ADR: ADR-0001 and ADR-0002 already govern the listener.

## Current state (what exists today, what throws, with file:line)
- `tests/e2e/webhook.e2e.test.ts:16-45` holds nine `it.todo` cases.
- `src/events.ts` `handlePostEvents` and `src/index.ts` `activate()` throw `not implemented` (per caretaker-codebase skill).
- Depends on listener ticket dadd90ae: `createWebhookListener` in `src/listener.ts`, plus `src/index.ts` re-export.

## Steps (ordered and concrete, naming exact files, exports and commands)
1. Confirm dadd90ae has landed: `createWebhookListener` exported from `src/listener.ts` and re-exported from `src/index.ts`; `handlePostEvents` returns the discriminated result.
2. Rewrite `tests/e2e/webhook.e2e.test.ts`, replacing each todo with a real test that starts the listener on port 0, issues requests over a real socket (fetch or node:http client), and closes the server in `afterEach`.
3. Use an injected queue double (recording/full) from `tests/setup/doubles.ts` if available, or a local in-memory double; assert enqueue counts and rejection behavior, never relying on real queue timing.
4. Delete `tests/scaffold.test.ts` here (per dadd90ae step 8) once the listener is real; retain the fixed-instruction assertion in `tests/untrusted-payload.test.ts`.
5. Run `pnpm test:e2e` then `pnpm check` and `pnpm build` (listener touches `src/index.ts`).

## Files touched (new / modified)
- Modified: `tests/e2e/webhook.e2e.test.ts`.
- Deleted: `tests/scaffold.test.ts` (shared with dadd90ae; coordinate to avoid double deletion).
- No src changes in this ticket.

## ADR obligations (pointer + pin, or "none" and why)
- none new. Existing pins `tests/events.test.ts` and `tests/untrusted-payload.test.ts` remain; this suite becomes an additional socket-level pin for ADR-0001/ADR-0002.

## Test plan (each new test, which existing it.todo it replaces, and the red proof: what fails without this change)
- Health shape todo -> GET /health deep-equals `{status,version,commit}` only; red because no server exists before dadd90ae.
- Injected commit todo -> built artifact commit !== "dev"; red because health unreachable from dist/index.js.
- Auth todo -> missing/wrong bearer -> 401, enqueue count 0; red because handler throws.
- Cap todo -> 64 KiB proceeds, 64 KiB+1 -> 413, enqueue empty; red because no stream cap.
- Invalid input todo -> bad JSON/missing message/unknown severity -> 400; red because no validation path.
- Admission todo -> valid envelope -> 202 `{queued:true}` and enqueue count 1; red because no enqueue.
- Overload todo -> full queue -> real 503, not 202; red because no overload handling.
- Method/route todo -> 405 with Allow / 404; red because no router.
- Invariant todo -> no malformed/unauthorized request ever receives 202; red because listener absent.

## Open decisions for the owner (never guess - list them instead)
- Whether the e2e suite should import from `src/` (unit-style) or from the built `dist/` artifact for the commit-injection assertion; dadd90ae suggests the latter for that case only.

## Out of scope for this ticket
- Implementing the listener, queue, triage, or Telegram. Those are separate tickets.