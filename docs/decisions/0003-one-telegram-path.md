# ADR-0003: One Telegram path
- Status: accepted · Date: 2026-10-25 · Decided by: owner
## Decision
This project owns the Telegram conversation: `notify(text)` is the only way
pi-caretaker sends a Telegram message. Final assistant answers from turns
originated by a paired-chat inbound message relay through `notify`; background
turns never relay automatically — only deliberate notifications and these
owner-originated replies appear.
## Why
With two notifiers posting to the owner's chat, silence can never be proven,
and "it only pings when it matters" becomes unenforceable.
## Consequence
Any second Telegram-sending path requires amending or superseding this ADR. Fixed protocol acknowledgments for paired-chat non-text updates, including receipt reactions, typing indicators, and status edits, are adapter-owned signals, not model output or an expansion of the notify path.
Paired-chat inbound replies use the same `notify(text)` sender; background,
webhook, and escape-hatch turns remain silent unless they deliberately notify.
Pitgram was rejected by owner decision (see ADR-0007); grammY keeps this
single outbound path.
## Pins
- `tests/telegram-path.test.ts`
- `tests/index.test.ts`
- `tests/e2e-local/caretaker.e2e-local.test.ts`
