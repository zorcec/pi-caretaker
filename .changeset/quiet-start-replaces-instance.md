---
"pi-caretaker": patch
---

Make `pnpm start` stop the pidfile-managed caretaker and wait for its listener to close before booting a replacement; unidentified listeners now fail with operator guidance.
