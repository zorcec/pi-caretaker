---
"pi-caretaker": patch
---

Authenticated webhook listener (`createWebhookListener` on plain node:http):
`GET /health` returns exactly `{status, version, commit}`; `POST /events`
checks the bearer token before parsing, enforces the 64 KiB body cap on
declared and observed size, validates the envelope, and returns 202 only
after the queue accepts — 401/400/413/503 otherwise, 405 with `Allow` for a
wrong method, 404 for unknown routes. Error bodies are generic strings;
statuses are the contract.
