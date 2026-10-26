# ADR-0003: One Telegram path
- Status: accepted · Date: 2026-10-25 · Decided by: owner
## Decision
This project owns the Telegram conversation: `notify(text)` is the only way
pi-caretaker sends a Telegram message, and background turns never relay
output automatically — only a deliberate notification appears.
## Why
With two notifiers posting to the owner's chat, silence can never be proven,
and "it only pings when it matters" becomes unenforceable.
## Consequence
Any second Telegram-sending path requires amending or superseding this ADR.
Pitgram was rejected by owner decision (see ADR-0007); the landed grammY
adapter keeps the single path — `notify(text)` remains the only sender.
## Pins
- `tests/telegram-path.test.ts`
