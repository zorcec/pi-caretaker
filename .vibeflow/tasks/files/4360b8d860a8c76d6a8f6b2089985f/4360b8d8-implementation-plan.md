# vibeflow as first event source - implementation plan
Ticket: 4360b8d860a8c76d6a8f6b2089985f | Parent: Initial implementation (0ce8c29edee87ade5c6ca89f4a3c77)
## Goal
Make the vibeflow CLI emit owner-approved events as one-way authenticated `POST /events` requests whose bodies round-trip through pi-caretaker's `eventEnvelopeSchema`, starting with the documented `task_moved_to_done` envelope.
## Non-goals (explicit)
- The caretaker must never read vibeflow task storage, board internals, token store, or credentials.
- No caretaker-side polling, collector, vibeflow client, shared database, persistence, retries/outbox, dedupe/correlation, dashboard, or automatic infrastructure changes; each excluded capability needs its own ADR.
- No severity inference: omit `severity` unless vibeflow genuinely has source-owned severity.
- No secrets, `.env`, tokens in fixtures/logs, or private deployment details; configuration is runtime environment only.
- No expansion to hosted-board events until event classes and ownership are explicitly approved.
## Current state (what exists today, what throws, with file:line)
- `docs/integrations/vibeflow.md:18-32` specifies a one-way POST and the example fields `source`, `event`, `message`, and `metadata`; `docs/integrations/vibeflow.md:34-39` forbids caretaker reads of vibeflow internals.
- `src/events.ts:19-29` already accepts the documented envelope, but `handlePostEvents` still throws `not implemented` at `src/events.ts:67-72`; live delivery depends on the listener ticket.
- `tests/events.test.ts:10-64` covers generic/minimal envelopes but has no vibeflow producer contract case.
- `tests/live/smoke.live.test.ts:13-15` contains the linked opt-in live `it.todo` for a real vibeflow POST receiving 202.
- The vibeflow checkout has no caretaker emitter today; the shared task-write seam is `packages/cli/src/core/operations/tasks.ts:updateTask`, but the owner has not yet decided which successful transitions warrant attention or whether this is the correct emission seam.
## Steps (ordered and concrete, naming exact files, exports and error codes)
1. Before coding, have the owner approve the initial trigger set, runtime variable names, timeout, and delivery-failure policy. Defaulting these would create product/configuration behavior not present in the ticket.
2. In the vibeflow repo, add `packages/cli/src/core/caretaker-events.ts` with one internal export, `emitCaretakerEvent(envelope)`, and the exact envelope type needed by the approved triggers. Use Node 22 `fetch`; do not add a client framework or dependency.
3. Have `emitCaretakerEvent` read the approved endpoint and bearer token only at call time from the environment, serialize JSON, set `Content-Type: application/json` and `Authorization: Bearer ...`, enforce the approved timeout, and accept success only on HTTP 202. Never include the token or full event body in errors/logs.
4. Add the approved post-success hook to `packages/cli/src/core/operations/tasks.ts` only after the task write is confirmed. For the documented first trigger, emit exactly `source: "vibeflow"`, `event: "task_moved_to_done"`, a human-readable `message`, and `metadata` containing stable board/task identifiers; omit `severity`.
5. Keep emission one-way: pass only values already available from the completed operation. Do not import pi-caretaker runtime code into production, open its storage, query it back, or read extra vibeflow records for enrichment.
6. Implement the owner's failure policy without retries or an outbox. If failures are surfaced through vibeflow operation results, use one approved exact code (proposed `CARETAKER_EVENT_FAILED`) and state that the task write already succeeded; otherwise make the failure an explicitly tested, redacted best-effort notice. Do not invent both paths.
7. Add `packages/cli/tests/unit/caretaker-events.test.ts` with a local HTTP server: assert exact path, method, headers, body, omitted severity, 202 handling, non-202/timeout handling, and redaction. Add `packages/cli/tests/unit/operations-caretaker-events.test.ts` to prove only an approved successful transition emits and failed/dry-run/unrelated updates do not.
8. In pi-caretaker, add the documented emitted body to `tests/events.test.ts` and parse it with the real `eventEnvelopeSchema`, asserting parsed values and absent severity. This is the consumer-side contract pin, not a duplicate schema implementation.
9. In linked ticket `a1ae60c1`, replace only the first `it.todo` in `tests/live/smoke.live.test.ts`: start the real local listener, run the configured vibeflow action, capture the admitted body, validate it with `eventEnvelopeSchema`, and require HTTP 202. Keep credentials/environment opt-in under `vitest.live.config.ts`, never `pnpm check`.
10. Run the focused vibeflow unit tests and its full required checks, then in pi-caretaker run `pnpm check`; run `pnpm test:live` only with explicit operator-provided environment.
## Files touched (new / modified)
- New in vibeflow: `packages/cli/src/core/caretaker-events.ts`
- Modified in vibeflow: `packages/cli/src/core/operations/tasks.ts`
- New in vibeflow: `packages/cli/tests/unit/caretaker-events.test.ts`
- New in vibeflow: `packages/cli/tests/unit/operations-caretaker-events.test.ts`
- Modified in pi-caretaker: `tests/events.test.ts`
- Modified by linked live ticket: `tests/live/smoke.live.test.ts`
- Documentation-only clarification if approved behavior differs from the example: `docs/integrations/vibeflow.md`
## ADR obligations (pointer + pin, or "none" and why)
- None in pi-caretaker if implementation stays a consumer POSTing the existing ADR-0001 envelope: `src/events.ts` already points to ADR-0001 and `tests/events.test.ts` pins it.
- If trigger policy, failure semantics, or configuration names are intended to constrain future vibeflow code, they need a vibeflow-repo ADR under that repo's own decision process; do not add an unpinned rule here.
- Any persistence/retry/outbox or caretaker-side collector needs its own ADR and is not planned.
## Test plan (each new test, which existing it.todo it replaces, and the red proof: what fails without this change)
- `packages/cli/tests/unit/caretaker-events.test.ts`: exact 202 POST contract and omission of severity; red without the new module. Non-202, timeout, and secret-redaction cases catch false success and leaks.
- `packages/cli/tests/unit/operations-caretaker-events.test.ts`: one POST after the approved transition, none before/for failed/dry-run/unrelated changes; red because `updateTask` currently has no emitter call.
- `tests/events.test.ts`: the exact documented vibeflow envelope parses through `eventEnvelopeSchema`; red proof for producer drift comes from feeding the captured producer body rather than a hand-built duplicate. If a portable captured-output seam cannot be established, this cross-repo assertion must move to the live test rather than become decorative.
- Linked `tests/live/smoke.live.test.ts`: replace “vibeflow POSTs a real envelope ... and receives 202”; red/todo until both the listener and emitter exist. No other live todo belongs to this ticket.
## Open decisions for the owner (never guess - list them instead)
- Which vibeflow transitions are worth attention initially; confirm whether only `task_moved_to_done` ships and what “done” means across local/hosted paths.
- Confirm the emission seam (`core/operations/tasks.ts:updateTask`) so CLI, MCP, and UI-originated writes neither miss events nor double-send them.
- Approve environment variable names, endpoint shape, timeout, disabled-configuration behavior, and post-write failure semantics/code.
- Choose a portable red-proof seam for validating actual producer output with pi-caretaker's schema: published package/dev dependency, captured fixture generated by producer tests, or the linked live test. Do not use a machine-relative import.
## Out of scope for this ticket
Telegram behavior, triage policy, listener implementation, hosted-board fan-out, replay, durable delivery, task-history import, polling, source credential access, and additional source adapters.
