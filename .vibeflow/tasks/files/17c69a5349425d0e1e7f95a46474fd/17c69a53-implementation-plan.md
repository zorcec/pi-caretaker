# Telegram adapter and Pitgram spike - implementation plan

Ticket: 17c69a5349425d0e1e7f95a46474fd | Parent: Initial testing (d8f35c7cd6eea8d8dfb9ed5da58759)
## Goal
Validate Pitgram end-to-end against the 8 proof-of-concept steps in the concept doc (silent turns, explicit notify, reply context, sequential load, restart recovery). If Pitgram satisfies shared-session behavior, implement the adapter in src/telegram/index.ts exposing notify/onMessage; otherwise pick grammY via a new ADR. Record verdict in docs/research/README.md.
## Non-goals (explicit)
No second notifier; no persistence of chat state; no auto-relay of background turns (ADR-0003). No grammY decision without an ADR.
## Current state (what exists today, what throws, with file:line)
src/telegram/index.ts: interface only, zero runtime exports (pinned by tests/telegram-path.test.ts "telegram module exposes no runtime sender yet"). docs/research/README.md: Pitgram not yet confirmed end-to-end. docs/concept lines 179-192: 8 PoC steps.
## Steps (ordered and concrete, naming exact files, exports and commands)
1. Run PoC steps 1-8 manually against a persistent Pi with pi-caretaker + Pitgram; record observations in docs/research/pitgram-spike.md.
2. If pass: implement TelegramAdapter in src/telegram/index.ts with notify(text) and onMessage(handler); add ADR-0003 pointer comment in file. Add src/telegram/pitgram.ts (or adapter module) wiring Pitgram; keep interface in index.ts.
3. If fail: write new ADR (copy TEMPLATE.md) choosing grammY; update index row; implement adapter on grammY.
4. Update tests/telegram-path.test.ts: keep zero-runtime-exports assertion until adapter ticket; adapter ticket replaces it with a real notify test. Keep red->green proof: test that background turn does not call notify.
5. Run pnpm check + pnpm build (src touched).
## Files touched (new / modified)
New: docs/research/pitgram-spike.md; possibly src/telegram/*.ts. Modified: src/telegram/index.ts, docs/research/README.md, docs/decisions/index.md + new ADR (only if fallback).
## ADR obligations (pointer + pin, or "none" and why)
ADR-0003 already governs; add pointer comment in src/telegram/index.ts if missing. Fallback path requires a new ADR (amend 0003) with pins + index row in same change.
## Test plan (each new test, which existing it.todo or guard it replaces, and the red proof: what fails without this change)
tests/telegram-path.test.ts: replace "zero runtime exports" with adapter contract test asserting notify is the only outbound path and a silent background turn never invokes notify. Red proof: removing the guard in adapter lets a background turn call notify -> test fails.
## Open decisions for the owner (never guess - list them instead)
Pitgram go/no-go verdict itself; whether to accept grammY fallback ADR if Pitgram fails.
## Out of scope for this ticket
Listener, queue, triage turns, escape hatch enforcement code.}