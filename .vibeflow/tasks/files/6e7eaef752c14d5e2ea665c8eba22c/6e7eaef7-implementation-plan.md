# Background triage turn with serialized session - implementation plan
Ticket: 6e7eaef752c14d5e2ea665c8eba22c | Parent: Initial implementation (0ce8c29edee87ade5c6ca89f4a3c77)
## Goal
Send admitted webhook events and Telegram input through one persistent Pi session, one turn at a time; preserve the fixed instruction/data split, default background triage to silence, and use only `TelegramAdapter.notify` for deliberate output.
## Non-goals (explicit)
- No queue persistence, retries, deduplication/correlation, history database, dashboard, collector, second Telegram sender, or automatic infrastructure action.
- Do not implement HTTP admission, queue capacity/FIFO semantics, Telegram transport selection, or full extension/environment wiring owned by sibling tickets.
- Do not treat hiding model output in a terminal as proof of Telegram silence.
## Current state (what exists today, what throws, with file:line)
- `src/events.ts:41-55` has `TriageRequest`, fixed `TRIAGE_INSTRUCTIONS`, and `buildTriageRequest`, but no consumer; only `message` currently enters `eventText`.
- `src/prompts/triage.md:1-34` is guidance prose and is not loaded into a runtime turn.
- `src/telegram/index.ts:9-16` defines synchronous inbound registration plus async `notify`; there is no runtime adapter/session bridge.
- `src/index.ts:14-21` exports an activation stub that throws; activation replacement belongs to ticket `e443e5b4`.
- `tests/setup/doubles.ts:39-103` records Telegram notifications and model requests, but its triage contract is test-only and has no same-session Telegram-reply operation.
- `tests/e2e/pipeline.e2e.test.ts:13-37` contains only `it.todo` cases, including sequencing, data-channel integrity, silence, and reply context.
## Steps (ordered and concrete, naming exact files, exports and error codes)
1. Resolve the Pi SDK/session API and Telegram integration spike decisions listed below before choosing dependencies; pin the selected package versions in `package.json`/`pnpm-lock.yaml`. Do not invent a second agent loop.
2. Add `src/triage.ts` with production exports `TriageDecision`, `CaretakerSession`, `SessionTurn`, `SerializedCaretakerSession`, `CaretakerPipeline`, and `createCaretakerPipeline(...)`. The same injected `CaretakerSession` instance must handle background and Telegram turns.
3. Implement `SerializedCaretakerSession.run(turn)` as a promise-tail critical section that starts only after the prior turn settles and advances after both success and failure, so one rejected turn cannot deadlock later work. It must expose no parallel/bypass method.
4. Implement `CaretakerPipeline.submitEvent(envelope)` to enter that serializer, call `buildTriageRequest(envelope)`, attach the complete fixed repo-owned guidance from `src/prompts/triage.md` through the chosen Pi trusted-instruction API, and await the background turn. Keep every webhook field out of trusted instructions/tools.
5. For a background result, do nothing when `notify` is false. When the agent deliberately returns `notify: true` with non-empty text, await exactly one `TelegramAdapter.notify(text)`; reject malformed notify results with named code `TRIAGE_NOTIFY_TEXT_REQUIRED` rather than sending empty text.
6. Implement `CaretakerPipeline.registerTelegram()` once: register one `onMessage` handler whose inbound text enters the same serializer/session, await the conversational turn, then send its reply through `notify`. Change `TelegramMessageHandler` to return `void | Promise<void>` so adapters/tests can await failures rather than create floating promises.
7. Load/package `src/prompts/triage.md` as an immutable extension asset using the selected Pi/tsup-supported mechanism; add a build assertion that the packaged entry can construct a turn with the exact guidance. Do not duplicate the markdown into a drifting string.
8. Re-export the pipeline/session factory and types from `src/index.ts`, but leave `extension.activate()` throwing until ticket `e443e5b4` supplies real configuration and dependencies.
9. Move `TriageDecision` and the session interface out of test code; update `createStubTriageLlm` and `createRecordingTelegram` to implement production interfaces, record both turn kinds in one ordered list, and let `deliver` return a promise. Extend `tests/testkit.test.ts` to pin these recording/awaiting semantics.
10. Add a changeset, perform each focused red/green proof, then run `pnpm check` and `pnpm build`.
## Files touched (new / modified)
- New: `src/triage.ts`; `docs/decisions/0005-one-serialized-caretaker-session.md`; `.changeset/<generated-name>.md`
- Modified: `src/events.ts`; `src/telegram/index.ts`; `src/index.ts`; prompt asset/build configuration selected in step 7; `package.json`; `pnpm-lock.yaml`; `docs/decisions/index.md`; `tests/setup/doubles.ts`; `tests/testkit.test.ts`; `tests/e2e/pipeline.e2e.test.ts`; packaged-artifact test if asset loading requires it
## ADR obligations (pointer + pin, or "none" and why)
- Add ADR-0005 because one persistent session and cross-source serialization constrain the queue, Telegram adapter, activation, and future session code. Copy `TEMPLATE.md`, add the index row, pin `tests/e2e/pipeline.e2e.test.ts`, and place a one-line `ADR-0005` pointer at `SerializedCaretakerSession` and the Telegram registration seam.
- Add `ADR-0002` beside request construction and `ADR-0003` beside deliberate notify/one-handler code. Reaffirm those ADR files in the same change if the date guard requires it; add the behavioral e2e pin to their Pins/index entries only if the owner wants it designated as an additional mechanical pin.
## Test plan (each new test, which existing it.todo it replaces, and the red proof: what fails without this change)
- Replace “delivers concurrent arrivals sequentially and in order — no interleaving”: hold the first session turn open, submit a second event plus Telegram input, and assert the recorder shows only the first start until release, then exact FIFO start/end order and max concurrency 1. Red: an un-serialized implementation records overlapping starts.
- Replace “hostile webhook text reaches the model in the data channel only; instructions stay byte-identical”: submit through the real pipeline and assert the recorded `TriageRequest.eventText` is verbatim while trusted instructions byte-equal the fixed bundled guidance. Red: interpolation or bypassing `buildTriageRequest` changes the request.
- Replace “a \"not important\" verdict sends nothing to Telegram — silence is observable”: default the existing triage double to `{notify:false}`, drain the turn, and assert `telegram.notifies` exactly `[]`. Red: automatic relay creates a record.
- Replace “a Telegram reply is answered in the same session, with event context”: submit an event, deliver a Telegram question, and assert one session id/object handled both in order and the response used `notify` once. Red: separate session objects lose the recorded event context.
- Add failure-continuation coverage: reject one turn, then assert the next starts and completes; red if the promise tail remains rejected/deadlocked.
- Add `TRIAGE_NOTIFY_TEXT_REQUIRED` coverage and exact-one-notify coverage; red for empty or duplicate sends.
## Open decisions for the owner (never guess - list them instead)
- Which Pi package/version and concrete API creates or resumes the persistent session and distinguishes trusted instructions from event data?
- How is `triage.md` loaded in both source tests and the bundled artifact: Pi resource API, tsup text asset, or copied package asset?
- What structured result/tool-call contract constitutes a deliberate `notify`, and what is the conversational reply shape?
- What is the chosen Pitgram spike result? If Pitgram cannot guarantee silent shared-session turns, the grammY fallback needs its own ADR before this integration proceeds.
- On a model/session/Telegram failure, should V1 only surface the rejection/log and continue, or stop queue draining? Durable retry is out of scope and needs its own ADR.
## Out of scope for this ticket
Escape-hatch classification (ticket `baac47cd` plugs in before `buildTriageRequest`), listener status codes, queue overflow/restart semantics, activation/env parsing, live credentials/network tests, durable session implementation outside Pi, and any infrastructure remediation.