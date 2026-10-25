# Deterministic escape hatch bypass - implementation plan
Ticket: baac47cd1a877ee387ad6edeb7e9f1 | Parent: Initial implementation (0ce8c29edee87ade5c6ca89f4a3c77)
## Goal
Implement ADR-0004 as an executable, owner-reviewed rule set: host-dark and backups-dead events are recognized before any model turn, sent exactly once through `TelegramAdapter.notify`, and never offered to triage.
## Non-goals (explicit)
- No model-based classification, free-text semantic matching, deduplication, correlation, persistence, retry store, collector, dashboard, database, or infrastructure action.
- Do not add a second Telegram sender or broaden the must-notify list beyond the two ADR-approved classes.
- Do not implement the queue, HTTP listener, Pi session, Telegram transport, or extension activation owned by sibling tickets.
## Current state (what exists today, what throws, with file:line)
- `src/prompts/triage.md:22-29` only describes the hatch; no runtime matcher or bypass exists.
- `tests/escape-hatch.test.ts:4-23` pins phrases with regex, so it passes even when the model is still the only decision-maker.
- `src/events.ts:19-29` defines the available envelope fields; no field values are reserved for host-dark or backups-dead.
- `src/events.ts:50-55` always constructs a model request and has no pre-triage branch.
- `tests/e2e/pipeline.e2e.test.ts:17-19` has the intended behavioral case as `it.todo`.
- `src/telegram/index.ts:13-16` provides the sole outbound `notify` path; its implementation belongs to another ticket.
## Steps (ordered and concrete, naming exact files, exports and error codes)
1. Before coding, obtain the owner's canonical wire identifiers and matching field for the two classes, plus the exact deterministic notification format. Do not infer classes from arbitrary `message` text or severity.
2. Add `src/escape-hatch.ts` with an `ADR-0004` pointer and exports `EscapeHatchKind`, `EscapeHatchRule`, `MUST_NOTIFY_RULES`, `matchEscapeHatch(envelope)`, `formatEscapeHatchNotification(match, envelope)`, and `routeEscapeHatch(envelope, telegram, continueToTriage)`. Keep the rules as a short readonly in-repo list, not environment-driven mutable policy.
3. Make `routeEscapeHatch` check once before `continueToTriage`: on a match, await exactly one `telegram.notify(...)` and return `{ bypassedTriage: true, kind }`; otherwise call the continuation exactly once and return `{ bypassedTriage: false }`.
4. Propagate `notify` rejection to the caller; do not fall through to the model, claim delivery, or add retries. This ticket adds no HTTP status/error code and must not alter `202` admission semantics.
5. At the background-pipeline integration seam introduced by ticket `6e7eaef7`, call `routeEscapeHatch` before `buildTriageRequest`/the session turn. If that seam has not landed, keep this ticket blocked rather than creating a competing pipeline.
6. Replace the prose-only ADR pin: remove `tests/escape-hatch.test.ts` after its behavioral assertions move to `tests/e2e/pipeline.e2e.test.ts`; retain prompt wording as documentation, not enforcement.
7. Add a user-visible changeset for the guaranteed notification behavior, run the focused red/green proof, then `pnpm check` and `pnpm build`.
## Files touched (new / modified)
- New: `src/escape-hatch.ts`
- Modified: background pipeline source created by ticket `6e7eaef7`; `tests/e2e/pipeline.e2e.test.ts`; `docs/decisions/0004-deterministic-escape-hatch.md`; `docs/decisions/index.md`; `.changeset/<generated-name>.md`
- Deleted after migration: `tests/escape-hatch.test.ts`
## ADR obligations (pointer + pin, or "none" and why)
- No new ADR: ADR-0004 already binds this behavior and names both approved classes.
- Put a one-line `ADR-0004` pointer beside `MUST_NOTIFY_RULES` and the pre-triage branch.
- Reaffirm/update ADR-0004 in the same change, replace its pin with `tests/e2e/pipeline.e2e.test.ts`, and update the index row so the mechanical pin/index/date guard remains satisfied.
## Test plan (each new test, which existing it.todo it replaces, and the red proof: what fails without this change)
- Replace pipeline `it.todo` “escape hatch: a must-notify event notifies exactly once even when the model answers \"ignore\"” with one parameterized case per approved class. Admit through the real queue/pipeline, configure the triage double to ignore, await drain, assert one exact Telegram text, and assert `llm.requests` is empty. Red proof: current code has no pipeline/bypass and produces zero notifications (or consults the model).
- Add a non-match case around `routeEscapeHatch`: assert zero direct notifications and one continuation call with the original envelope. Red proof: an overbroad matcher or unconditional notify fails exact counts.
- Add near-miss identifiers for each class and assert they do not bypass. Red proof: substring/regex matching fails.
- Temporarily invert/remove each configured rule during red proof and observe its parameterized must-notify case fail; restore it before final validation.
## Open decisions for the owner (never guess - list them instead)
- Which envelope field and exact case-sensitive values canonically mean host-dark and backups-dead?
- What exact Telegram text/field subset is safe and useful for deterministic notifications? Should untrusted `message` be quoted verbatim as data or omitted?
- Must configuration be fixed in source for V1, or supplied through a validated environment value? The latter changes operator configuration and needs an explicit contract.
## Out of scope for this ticket
Queue sequencing/capacity, session serialization, ordinary model triage, Telegram transport selection, HTTP responses, activation wiring, durable delivery/retries, and promotion of any third alert class (an owner decision and ADR-0004 update).