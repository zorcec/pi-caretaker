# Research

Spike-sized validations that de-risk the architecture before we build on it.
Each spike ends in a short note: what was tried, what was observed, go/no-go.

## First task: Pitgram validation

Pitgram (https://github.com/raghavbali/pitgram) is the preferred Telegram
integration — **not yet confirmed end-to-end** for silent webhook-triggered
turns sharing the correct Telegram session. Run the proof-of-concept from
the concept doc against a persistent Pi with `pi-caretaker` + Pitgram loaded
(auth, silent turns, explicit notify, reply context, sequential load,
restart recovery) and record the verdict here. If Pitgram cannot satisfy the
shared-session behavior, the fallback is the smallest possible Telegram
bridge (grammY candidate) — decided by a new ADR, not by drift.
