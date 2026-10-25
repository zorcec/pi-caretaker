# Telegram adapter implementation - implementation plan
Ticket: f8f1f597a672792711c22d7bf9e6f5 | Parent: Initial implementation (0ce8c29edee87ade5c6ca89f4a3c77)
## Goal
Implement the existing `TelegramAdapter` contract as the caretaker's only inbound and outbound Telegram path, but only after the linked Pitgram spike proves silent background turns and shared-session replies in a real persistent Pi runtime.
## Non-goals (explicit)
- No second notifier, automatic relay of background/model output, multi-chat or multi-user routing.
- No queue persistence, retry store, dedupe/correlation, dashboard, collector, database, or automatic infrastructure action; any such addition needs its own ADR.
- No grammY fallback in this change unless the owner first approves the spike's no-go verdict and a new ADR.
- No credentials in source, fixtures, logs, or `.env`; runtime secrets come from the environment/Pi configuration.
## Current state (what exists today, what throws, with file:line)
- `src/telegram/index.ts:9-16` exports only the `TelegramMessageHandler` and `TelegramAdapter` types; there is no runtime constructor or sender.
- `tests/telegram-path.test.ts:28-33` pins that absence by requiring zero runtime exports; it must deliberately turn red when a constructor is added, then be replaced.
- `docs/research/README.md:6-15` says the required Pitgram validation has not happened and makes a fallback contingent on a new ADR.
- ADR-0003 already governs the seam: `notify(text)` is the only send path and background turns do not relay automatically.
- The linked Tier 5 placeholders are `tests/live/smoke.live.test.ts:17-23`; the pipeline placeholder for same-session reply is `tests/e2e/pipeline.e2e.test.ts:36`.
## Steps (ordered and concrete, naming exact files, exports and error codes)
1. Complete linked ticket `17c69a53`: run the concept's eight-case proof against a persistent Pi + Pitgram, and append setup, versions, observations, and a go/no-go verdict to `docs/research/README.md`. Do not implement against an assumed Pitgram API.
2. If the verdict is go, modify `src/telegram/index.ts` to export exactly one runtime construction seam, `createTelegramAdapter`, returning `TelegramAdapter` and binding one verified Pitgram conversation. Keep `notify(text)` as the sole call to Pitgram's explicit-send API and `onMessage(handler)` as the sole subscription to inbound text for that same conversation.
3. Register at most one inbound handler. A second `onMessage` registration must throw synchronously rather than silently replace or duplicate delivery. Do not export the underlying Pitgram sender/client and do not subscribe a background-turn output relay.
4. Propagate Pitgram send failures by rejecting `notify`; do not report delivery success, persist/retry, or log message text, token, or chat identity. This adapter adds no HTTP/status error codes; if a stable adapter error code is required by the verified Pitgram API, the owner must approve it before implementation.
5. Add only the dependency/configuration wiring demonstrated by the spike to `package.json` and the Pi extension activation seam. Read token/chat/session values from runtime environment/Pi configuration, validate presence at activation, and never add defaults containing credentials.
6. Replace the zero-runtime-export assertion in `tests/telegram-path.test.ts` with assertions that the runtime namespace is exactly `createTelegramAdapter`, outbound calls reach the verified Pitgram send seam once, inbound text reaches the one handler once, duplicate registration is refused, and send rejection is preserved.
7. Use the existing recording double in `tests/setup/doubles.ts` for caretaker pipeline tests; do not make unit tests touch Telegram. In the linked live ticket, turn the three Telegram-relevant `it.todo`s in `tests/live/smoke.live.test.ts` into opt-in tests only after the spike is reproducible.
8. Run focused unit tests, `pnpm check`, `pnpm build`, and the explicitly opted-in `pnpm test:live`; document live prerequisites without recording values.
## Files touched (new / modified)
- Modified: `src/telegram/index.ts`
- Modified if required by the verified integration: `src/index.ts`, `package.json`, `pnpm-lock.yaml`
- Modified: `tests/telegram-path.test.ts`
- Modified by linked spike/testing work: `docs/research/README.md`, `tests/live/smoke.live.test.ts`
- No new production file unless the verified Pitgram API cannot be wrapped coherently in `src/telegram/index.ts`.
## ADR obligations (pointer + pin, or "none" and why)
- No new ADR for a passing Pitgram implementation: ADR-0003 already decides the single path, is pointed to by `src/telegram/index.ts`, and is pinned by `tests/telegram-path.test.ts`.
- A grammY fallback or any second Telegram-sending path needs its own accepted ADR (or amendment/supersession of ADR-0003), copied from `docs/decisions/TEMPLATE.md`, indexed, pinned by a real test, and referenced by a one-line pointer in governed code in the same change.
## Test plan (each new test, which existing it.todo it replaces, and the red proof: what fails without this change)
- `tests/telegram-path.test.ts`: replace “module exposes no runtime sender” with exact `createTelegramAdapter` export coverage; red now because the export does not exist.
- Same file: outbound `notify` invokes the injected/verified Pitgram send once and preserves rejection; red now because no implementation exists.
- Same file: inbound text is delivered once and duplicate handler registration throws; red now because no implementation exists.
- Linked `tests/live/smoke.live.test.ts`: replace “background webhook turn produces no Telegram output,” “explicit proactive notification reaches the Telegram chat,” and “Telegram reply is answered with ... context”; each is red/todo without a real adapter and live runtime. Keep these outside `pnpm check` via `vitest.live.config.ts`.
- `tests/e2e/pipeline.e2e.test.ts`: do not claim its same-session todo here unless activation/pipeline wiring is present; its owning pipeline ticket must replace it using `createRecordingTelegram`.
## Open decisions for the owner (never guess - list them instead)
- Accept or reject Pitgram based on the recorded spike verdict; this blocks the concrete adapter binding.
- Approve the public `createTelegramAdapter` argument/configuration shape after the spike reveals Pitgram's supported API and Pi session ownership model.
- Choose runtime environment/Pi configuration names and whether missing Telegram configuration disables activation or fails it; do not infer names or failure policy.
- If Pitgram is a no-go, approve the fallback transport and its ADR before implementation.
## Out of scope for this ticket
Listener/queue/triage implementation, source integrations, session persistence implementation, durable Telegram retries, delivery receipts, message formatting policy, multi-user isolation, and automatic remediation.
