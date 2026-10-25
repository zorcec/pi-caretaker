---
"pi-caretaker": patch
---

Bounded in-memory FIFO with sequential delivery (`createEventQueue`,
`startDelivery`). Admission assigns sequences from 0 with ISO timestamps and
refuses over capacity with reason `full`; a consumer throw stops the pump and
surfaces through `drained()`. The queue stays non-durable by design: a fresh
instance starts empty.
