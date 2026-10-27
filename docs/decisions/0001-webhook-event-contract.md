# ADR-0001: Webhook event contract
- Status: accepted · Date: 2026-10-25 · Decided by: owner · Reaffirmed: 2026-10-27
## Decision
`202 Accepted` means the event entered the in-memory queue — nothing more.
Only `message` is required; severity is advisory context, and oversized,
unauthorized, overloaded, or requests after the delivery pump has failed get real error codes, never a fake 202. Delivery retries a failed event at the queue front for three total attempts, with 250 ms then 500 ms backoff. After exhaustion the pump becomes terminal, retains the failed event at the front, and returns 503 until process restart; this 503-until-restart honesty is unchanged. Terminal failure emits a lost-event record containing event class, origin, timestamp, and error class, without the payload body in caretaker-status.
## Why
Without this, operators read 202 as "delivered to Telegram", a guarantee V1
cannot keep with a memory-only queue that loses everything on restart.
## Consequence
Operators must treat 202 as "queued, may be lost"; failed events remain
in memory only and are lost on restart, so durable ingestion needs its own
ADR, not a reinterpretation of 202. Inbound Telegram text (ADR-0007) is not
an event and never touches the 202 path.
## Pins
- `tests/events.test.ts`
- `tests/health.test.ts`
- `tests/queue.test.ts`
- `tests/index.test.ts`
- `tests/e2e/pipeline.e2e.test.ts`
- `tests/e2e/webhook.e2e.test.ts`
