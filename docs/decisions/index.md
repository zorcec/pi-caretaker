# Architecture Decision Records

Start here. Each row is a binding rule. Details live in the linked file.
Code points at these files with `ADR-NNNN`.

| id | title | status | date | rule in one sentence | pins |
|----|-------|--------|------|----------------------|------|
| [0001](0001-webhook-event-contract.md) | Webhook event contract | accepted | 2026-10-25 | 202 means queued in memory, never delivered; rejections use real status codes. | `tests/events.test.ts`, `tests/queue.test.ts` |
| [0002](0002-untrusted-webhook-payload.md) | Untrusted webhook payload | accepted | 2026-10-25 | Webhook content is data, never instructions; it stays in the data channel. | `tests/untrusted-payload.test.ts` |
| [0003](0003-one-telegram-path.md) | One Telegram path | accepted | 2026-10-25 | This project owns the Telegram conversation; no second notifier may post there. | `tests/telegram-path.test.ts` |
| [0004](0004-deterministic-escape-hatch.md) | Deterministic escape hatch | accepted | 2026-10-25 | Host-dark and backups-dead alerts bypass triage and must not depend on model judgment. | `tests/escape-hatch.test.ts` |

How to add a decision: copy `TEMPLATE.md` to `NNNN-short-name.md`, fill it in,
add one row above, and leave a one-line pointer in the code it governs.
