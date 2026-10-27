# ADR-0003: One Telegram path
- Status: accepted · Date: 2026-10-25 · Decided by: owner · Reaffirmed: 2026-10-27
## Decision
This project owns the Telegram conversation through one managed adapter:
`notify(text)` carries deliberate notifications, and its managed
`sendMessage(text, replyToId)` carries deterministic protocol messages and
quoted owner-originated final answers. Both use the same grammY Bot;
background turns never relay automatically — only deliberate notifications,
adapter-owned protocol messages, and these owner-originated replies appear.
## Why
With two notifiers posting to the owner's chat, silence can never be proven,
and "it only pings when it matters" becomes unenforceable.
## Consequence
Any second Telegram-sending path requires amending or superseding this ADR. Fixed protocol acknowledgments, liveness signals, interactive command pickers/callbacks, deterministic command replies, and queued owner-message receipts are adapter-owned protocol behavior, never model output or a second outbound path. `caretaker-status` retains the latest managed `sendMessage` failure as a safe error class plus timestamp; only a later successful managed `sendMessage` clears it, while a successful generic `notify` fallback does not.
Paired-chat inbound final answers use the managed `sendMessage(text, replyToId)` surface; background, webhook, and escape-hatch turns remain silent unless they deliberately notify.
Pitgram was rejected by owner decision (see ADR-0007); grammY keeps this
single outbound path.
## Pins
- `tests/inbound-message-state.test.ts`
- `tests/telegram-path.test.ts`
- `tests/index.test.ts`
- `tests/index-relay.test.ts`
- `tests/index-telegram.test.ts`
- `tests/e2e/telegram-mock.e2e.test.ts`
- `tests/e2e-local/caretaker.e2e-local.test.ts`
