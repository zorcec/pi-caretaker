---
"pi-caretaker": patch
---

Return 503 for webhook events after delivery failure, expose delivery status, guard startup against shutdown races, respawn failed Pi children with bounded backoff, verify caretaker process identity and stop its process group, and acknowledge paired-chat non-text Telegram updates with a fixed adapter-owned response.
