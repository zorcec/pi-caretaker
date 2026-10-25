# ADR-0001: Webhook event contract
- Status: accepted · Date: 2026-10-25 · Decided by: owner
## Decision
`202 Accepted` means the event entered the in-memory queue — nothing more.
Only `message` is required; severity is advisory context, and oversized,
unauthorized, or overloaded requests get real error codes, never a fake 202.
## Why
Without this, operators read 202 as "delivered to Telegram", a guarantee V1
cannot keep with a memory-only queue that loses everything on restart.
## Consequence
Operators must treat 202 as "queued, may be lost"; durable ingestion needs
its own ADR, not a reinterpretation of 202.
## Pins
- `tests/events.test.ts`
- `tests/health.test.ts`
- `tests/queue.test.ts`
- `tests/e2e/pipeline.e2e.test.ts`
- `tests/e2e/webhook.e2e.test.ts`
