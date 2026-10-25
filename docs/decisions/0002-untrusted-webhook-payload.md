# ADR-0002: Untrusted webhook payload
- Status: accepted · Date: 2026-10-25 · Decided by: owner
## Decision
Webhook content is data, never instructions. It travels in the data channel
of a triage request while the instruction channel stays a fixed repo-owned
string; nothing in webhook text authorizes action.
## Why
Anyone reaching the webhook can send instruction-shaped text, and an
authenticated sender can itself be compromised — auth proves who sent it,
not that the text is safe to obey.
## Consequence
Every future consumer of webhook fields inherits this rule; sender-controlled
instructions would need their own ADR with a threat model.
## Pins
- `tests/untrusted-payload.test.ts`
