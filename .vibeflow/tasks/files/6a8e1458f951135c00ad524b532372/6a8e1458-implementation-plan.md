# Bounded in-memory queue with sequential delivery - implementation plan
Ticket: 6a8e1458f951135c00ad524b532372 | Parent: Initial implementation (0ce8c29edee87ade5c6ca89f4a3c77)
## Goal
Implement the existing `EventQueue<T>` contract as a bounded, process-local FIFO: accepted items receive monotonically increasing sequence numbers and ISO timestamps, overflow returns `{ accepted: false, reason: "full" }`, and one asynchronous consumer receives accepted events in FIFO order with no overlapping calls.
## Non-goals (explicit)
- No persistence, restart recovery, retry store, deduplication/correlation, database, dashboard, collector, or automatic infrastructure change; any durable/retry design needs its own ADR.
- No HTTP listener or status-body implementation. This queue exposes `reason: "full"`; the listener ticket maps it to HTTP 503.
- No triage policy, Telegram notification decision, escape-hatch matching, or Telegram/session implementation.
## Current state (what exists today, what throws, with file:line)
- `src/queue.ts:9-29` defines `QueueOptions`, `QueuedEvent<T>`, `EnqueueResult`, and `EventQueue<T>` only; there is no constructor, storage, clock/sequence assignment, or consumer.
- `EventQueue.enqueue` promises admission/full results at `src/queue.ts:20-28`, but nothing currently enforces capacity or FIFO order.
- `src/events.ts:69-73` still throws for every POST, so queue admission is not reachable from HTTP yet.
- `tests/e2e/pipeline.e2e.test.ts:13-15`, `:29-35` contain the queue-relevant tier-4 placeholders for sequential delivery, overflow, and restart loss.
## Steps (ordered and concrete, naming exact files, exports and error codes)
1. Resolve the owner choices below before fixing the delivery API; the current interface does not define failure handling, the initial sequence value, or whether an in-flight event occupies capacity.
2. In `src/queue.ts`, retain the four existing public contracts and add `createEventQueue<T>(options: QueueOptions): EventQueue<T>` for the bounded in-memory FIFO. Validate `capacity` according to the owner decision rather than silently coercing it.
3. Implement admission atomically in `createEventQueue`: reject when `size === capacity` with the existing exact reason `"full"`; otherwise assign the next accepted sequence, stamp `new Date().toISOString()`, append once, and return `{ accepted: true }`. A rejection must not evict an older item or consume a sequence.
4. Implement `dequeue()` as destructive FIFO removal, returning `undefined` only when empty; keep `size` equal to the number of currently retained events and create no disk or process-external state.
5. In `src/queue.ts`, add the owner-approved async delivery export (name/signature selected in the open decision) around one `EventQueue<T>`. Use one shared drain promise/mutex so concurrent wake-ups cannot invoke the consumer concurrently; deliver `QueuedEvent<T>` values in sequence order and expose an awaitable idle/drain boundary for shutdown and deterministic tests.
6. Keep HTTP semantics at the seam: queue code returns only `EnqueueResult`; the listener maps `reason: "full"` to HTTP 503, never 202. Do not add HTTP imports to `src/queue.ts`.
7. Add the ADR-0001 pointer/pin updates below and a `.changeset/bounded-event-queue.md` patch note describing bounded, non-durable sequential admission.
8. Run the focused unit/e2e tests, demonstrate red against the interface-only file (missing exports/behavior) and green after implementation, then run `pnpm check` and `pnpm build`.
## Files touched (new / modified)
- Modified: `src/queue.ts`
- New: `tests/queue.test.ts`
- Modified: `tests/e2e/pipeline.e2e.test.ts`
- Modified: `docs/decisions/0001-webhook-event-contract.md`
- Modified: `docs/decisions/index.md`
- New: `.changeset/bounded-event-queue.md`
## ADR obligations (pointer + pin, or "none" and why)
- No new decision is needed: ADR-0001 already governs in-memory admission and documented restart loss, and `src/queue.ts:1-7` already carries its pointer.
- Add `tests/queue.test.ts` and `tests/e2e/pipeline.e2e.test.ts` to ADR-0001 `## Pins`, and mirror the pins in `docs/decisions/index.md`; these tests directly enforce the queue part of the accepted rule.
- If the owner chooses retries, persistence, or a delivery-failure guarantee beyond best-effort in-memory V1, that needs its own ADR and is not part of this plan.
## Test plan (each new test, which existing it.todo it replaces, and the red proof: what fails without this change)
- `tests/queue.test.ts`: capacity must be a valid owner-approved value; assert the exact chosen error type/message. Red: no constructor or validation exists.
- `tests/queue.test.ts`: enqueue up to capacity, assert exact accepted results and size; the next enqueue returns exactly `{ accepted: false, reason: "full" }` without changing size. Red: no implementation exists.
- `tests/queue.test.ts`: dequeue three accepted bodies in FIFO order, with exact consecutive `seq` values and `receivedAt` strings that parse and round-trip as ISO; rejected arrivals consume no sequence. Red: metadata/FIFO assignment does not exist.
- Replace `tests/e2e/pipeline.e2e.test.ts:13-15`: block the first consumer call, enqueue concurrent arrivals, and assert maximum active calls is exactly one and observed sequence/body order equals admission order. Red: no delivery pump exists; a parallel pump reaches active count greater than one.
- Replace `tests/e2e/pipeline.e2e.test.ts:29-31`: hold delivery so the queue fills, assert arrivals through capacity remain accepted and only the next is `full`; after release, earlier bodies still deliver in order. Red: an unbounded or evicting queue fails exact results/order.
- Replace `tests/e2e/pipeline.e2e.test.ts:33-35`: enqueue without draining, construct a fresh queue, and assert its size is 0 and `dequeue()` is `undefined`. Red: any process-external recovery or shared module storage restores stale work.
- For every case, capture the failing focused Vitest command before implementation/restoration; do not count the existing `it.todo` state as red proof.
## Open decisions for the owner (never guess - list them instead)
- What is the public sequential-delivery export and lifecycle: an auto-draining queue with a consumer callback, or a separate start/drain controller? `EventQueue<T>` alone cannot promise asynchronous delivery.
- Does the configured capacity include the currently in-flight event, or only events still waiting in storage?
- Does the first accepted event use sequence 0 or 1, and may sequence numbers reset only when a new queue/process is created?
- On consumer rejection, is the failed event dropped and processing continued, or is draining stopped with the error surfaced? Automatic/durable retries are out of V1.
- Which invalid capacities are rejected, and with what exact error type/message (zero, negative, fractional, non-finite, or above a configured maximum)?
## Out of scope for this ticket
- `handlePostEvents`, HTTP 503 response bodies, environment-derived capacity, extension activation, Pi session serialization with Telegram turns, triage/model behavior, and the four non-queue pipeline placeholders remain owned by their linked implementation/testing tickets.
