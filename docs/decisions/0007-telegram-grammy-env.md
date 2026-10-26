# ADR-0007: Telegram via grammY, configured by ENV

- Status: accepted · Date: 2026-10-25 · Decided by: owner
## Decision
The Telegram transport is a direct grammY `Bot` owned by pi-caretaker, not
a Pitgram integration. Configuration is two environment variables,
`PI_CARETAKER_TELEGRAM_BOT_TOKEN` and `PI_CARETAKER_TELEGRAM_CHAT_ID`,
both required together, neither with a default. Inbound updates are
long-polled in-process; only messages from the paired chat id are
forwarded, everything else is ignored, never answered.
## Why
The owner rejected Pitgram's interactive setup flow and wants env-only
configuration with no extra service, relay, or account linking step. A
direct Bot keeps one process, one conversation, and the single owned
`notify` path of ADR-0003 — no second notifier, no external session store.
Long polling needs no inbound firewall holes, unlike a webhook receiver.
## Consequence
Adds the `grammy` runtime dependency (bundled). No relay, no offline
queue, no durable inbox — V1 non-goals, unchanged. Half-configured
credentials (one var without the other) fail loudly at startup; a fully
absent pair keeps the current triage-only degraded mode. Broadening the
inbound set beyond the paired chat, or adding a second transport, needs a
new ADR.
## Pins
- `tests/grammy.test.ts`
- `tests/e2e/telegram-mock.e2e.test.ts`
