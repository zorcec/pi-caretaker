# ADR-0004: Deterministic escape hatch
- Status: accepted · Date: 2026-10-25 · Decided by: owner
## Decision
"Must never be missed" alerts (host dark, backups dead) bypass triage and
notify deterministically, without depending on the model deciding they
matter. The list itself is owner-reviewed configuration.
## Why
LLM triage has bad days; a host gone dark or dead backups must reach the
owner even if the model would have called them noise.
## Consequence
The list must stay short — everything on it costs an unconditional ping —
and promoting a new alert class to it is an owner decision.
## Pins
- `tests/escape-hatch.test.ts`
