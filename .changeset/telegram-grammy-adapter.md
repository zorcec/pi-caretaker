---
"pi-caretaker": minor
---

Direct grammY Telegram transport (ADR-0007), configured by
`PI_CARETAKER_TELEGRAM_BOT_TOKEN` + `PI_CARETAKER_TELEGRAM_CHAT_ID`.
The entry creates and attaches the adapter on session start (explicit
start after handler attach), forwards paired-chat text as followUp turns,
and degrades loudly without Telegram when the pair is absent or invalid.
Half-configured credentials fail startup with a named error. No Pitgram,
no relay, no second notifier.
