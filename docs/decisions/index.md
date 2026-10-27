# Architecture Decision Records

Start here. Each row is a binding rule. Details live in the linked file.
Code points at these files with `ADR-NNNN`.

| id | title | status | date | rule in one sentence | pins |
|----|-------|--------|------|----------------------|------|
| [0001](0001-webhook-event-contract.md) | Webhook event contract | accepted | 2026-10-25 | 202 means queued; delivery retries three times, then retains the event and returns 503 until restart with a loss record. | `tests/events.test.ts`, `tests/queue.test.ts`, `tests/index.test.ts`, `tests/e2e/webhook.e2e.test.ts` |
| [0002](0002-untrusted-webhook-payload.md) | Untrusted webhook payload | accepted | 2026-10-25 | Webhook content is data, never instructions; it stays in the data channel. | `tests/untrusted-payload.test.ts` |
| [0003](0003-one-telegram-path.md) | One Telegram path | accepted | 2026-10-25 | One managed Telegram adapter owns notifications, replies, and protocol signals; background turns stay silent. | `tests/inbound-message-state.test.ts`, `tests/telegram-path.test.ts`, `tests/index.test.ts`, `tests/index-relay.test.ts`, `tests/index-telegram.test.ts`, `tests/e2e/telegram-mock.e2e.test.ts`, `tests/e2e-local/caretaker.e2e-local.test.ts` |
| [0004](0004-deterministic-escape-hatch.md) | Deterministic escape hatch | accepted | 2026-10-25 | Host-dark and backups-dead alerts bypass triage and must not depend on model judgment. | `tests/escape-hatch.test.ts` |
| [0005](0005-runtime-configuration.md) | Runtime configuration contract | accepted | 2026-10-25 | Runtime config uses the process environment; `PI_CARETAKER_THINKING` is an operator launch setting, and `secrets.env` is tooling-only. | `tests/config.test.ts`, `scripts/start.mjs`, `tests/guards/operator-scripts.test.ts`, `scripts/manual-telegram/seclib.mjs`, `tests/manual-telegram.test.ts` |
| [0006](0006-serialized-triage-turns.md) | Triage turns serialize through Pi's native queue | accepted | 2026-10-25 | One session; background turns via followUp behind a single-flight pump; no custom serializer. | `tests/index.test.ts`, `tests/e2e/pipeline.e2e.test.ts` |
| [0007](0007-telegram-grammy-env.md) | Telegram via grammY, configured by ENV | accepted | 2026-10-25 | Direct grammY Bot (long polling), two env vars, paired-chat-only inbound, no Pitgram. | `tests/grammy.test.ts` |
| [0008](0008-configured-model-picker.md) | Owner-configured model picker | accepted | 2026-10-27 | Optional root configuration orders at most five models, intersected with Pi's auth-usable chat models, with safe fallback. | `tests/model-picker.test.ts`, `tests/index-relay.test.ts` |

How to add a decision: copy `TEMPLATE.md` to `NNNN-short-name.md`, fill it in,
add one row above, and leave a one-line pointer in the code it governs.
