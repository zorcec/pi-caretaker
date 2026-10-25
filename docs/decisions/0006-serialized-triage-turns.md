# ADR-0006: Triage turns serialize through Pi's native queue
- Status: accepted · Date: 2026-10-25 · Decided by: owner
## Decision
Background triage turns are submitted with `pi.sendUserMessage(..., { deliverAs: "followUp" })` into the single persistent Pi session, behind the caretaker's own single-flight pump. There is no custom session, serializer, or second agent loop: Pi owns turn ordering and the pump owns submission order.
## Why
Pi queues a follow-up message into the starting run when busy and settles turns in order, so a second serialization layer would be a second agent loop by another name — exactly what the architecture forbids. One pump plus Pi's queue gives sequential, non-interleaved delivery with no new concurrency primitive to get wrong.
## Consequence
Every turn submission goes through the entry's `deliver` path; session switching, replacement, and compaction inherit Pi behavior unchanged. A durable cross-restart outbox would need its own ADR (V1 non-goal: no persistence).
## Pins
- `tests/index.test.ts`
- `tests/e2e/pipeline.e2e.test.ts`
