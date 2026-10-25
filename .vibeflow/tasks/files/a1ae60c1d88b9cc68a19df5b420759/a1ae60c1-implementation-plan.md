# Live e2e suite - implementation plan
Ticket: a1ae60c1d88b9cc68a19df5b420759 | Parent: Initial testing (d8f35c7cd6eea8d8dfb9ed5da58759)

## Goal
Replace the six `it.todo` placeholders in `tests/live/smoke.live.test.ts` with real live tests sourced from the proof-of-concept list in docs/concept/pi-caretaker-high-level-concept-v3.md, gated behind vitest.live.config.ts so they never run in pnpm test/check.

## Non-goals (explicit)
- No implementation change. Live tests consume real Pi + Pitgram/Telegram; they record verdicts in docs/research/README.md.
- Do not flip any case green until the Pitgram spike verdict is recorded (research README).

## Current state (what exists today, what throws, with file:line)
- `tests/live/smoke.live.test.ts:15-32` holds six `it.todo` cases.
- `vitest.live.config.ts` isolates live tests (120s timeouts, separate config) and is not part of `pnpm test`.
- `docs/research/README.md` tracks the Pitgram spike; verdict not yet recorded.
- `docs/integrations/vibeflow.md` documents the envelope for the first real POST.

## Steps (ordered and concrete, naming exact files, exports and commands)
1. Run the Pitgram spike first; record go/no-go in `docs/research/README.md` before any live test goes green.
2. If Pitgram fails, plan a new ADR for the grammY fallback (do not drift); update this plan accordingly.
3. Replace each todo in `tests/live/smoke.live.test.ts` with a real test reading credentials from env (no .env file, no secrets in repo), skipping when env is absent.
4. Map each todo to the concept doc PoC list items 1-7 plus auth/overload (item 8).
5. Add a vibeflow real-POST case using the envelope in docs/integrations/vibeflow.md.
6. Run via `pnpm test:live` only; never `pnpm test`/`pnpm check`.

## Files touched (new / modified)
- Modified: `tests/live/smoke.live.test.ts`.
- Modified: `docs/research/README.md` (verdict note).

## ADR obligations (pointer + pin, or "none" and why)
- none unless Pitgram fails; then a new ADR for the Telegram fallback, with pins, is required in the same change.

## Test plan (each new test, which existing it.todo it replaces, and the red proof: what fails without this change)
- vibeflow POST todo -> real envelope returns 202; red until listener + Pitgram wired.
- No Telegram output todo -> background turn produces zero messages; red until triage turn lands.
- Proactive notify todo -> explicit notify reaches chat; red until Telegram adapter lands.
- Reply context todo -> reply answered with background event context; red until session wiring lands.
- Sequential load todo -> several webhooks during busy turn handled sequentially; red until queue lands.
- Restart recovery todo -> restart loses only queued events; red until runtime wiring lands.

## Open decisions for the owner (never guess - list them instead)
- Which env var names hold the Telegram bot token and chat id for live tests.
- Whether live tests should assert against a real vibeflow instance or a scripted POST.

## Out of scope for this ticket
- Any implementation, persistence, or automatic infra changes. Live tests only observe.