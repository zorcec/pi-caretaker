---
"pi-caretaker": patch
---

Deterministic escape hatch enforces the two ADR-0004 classes with a
canonical v1 vocabulary (ADR wording plus mechanical slug variants): a
host-dark or backups-dead envelope notifies exactly once through the owned
Telegram path and never reaches triage. Documents the Pi-native turn
serialization contract (ADR-0006): background turns go through
`pi.sendUserMessage` follow-ups behind a single-flight pump, with no custom
session or serializer.
