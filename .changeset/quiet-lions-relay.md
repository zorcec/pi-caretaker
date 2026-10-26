---
"pi-caretaker": minor
---

Paired-chat messages now produce safe inbound hop diagnostics, and final
assistant answers from those owner-originated turns relay to the paired chat
through the existing `notify` path. Background turns remain silent.
