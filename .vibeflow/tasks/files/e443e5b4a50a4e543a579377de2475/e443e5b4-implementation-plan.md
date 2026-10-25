# Extension activation and environment configuration - implementation plan
Ticket: e443e5b4a50a4e543a579377de2475 | Parent: Initial implementation (0ce8c29edee87ade5c6ca89f4a3c77)
## Goal
Make `extension.activate()` load validated runtime configuration from `process.env`, construct the bounded queue and background-turn delivery path, and start the authenticated HTTP listener. Preserve `extension.name`, `extension.version`, and the zero-argument `activate(): void` entry shape; replace both `TODO(pi-caretaker-1)` throws with working wiring.
## Non-goals (explicit)
- No `.env` loader/file, checked-in token, secret logging, payload logging, persistence, dedupe/correlation, dashboard, collector, database, automatic infrastructure change, or deployment config.
- No second Telegram sender and no automatic relay of background output; `TelegramAdapter.notify` remains the only outbound path (ADR-0003).
- No new triage policy, escape-hatch classifier, Telegram adapter, retry engine, or Pi session implementation; activation wires the contracts delivered by those tickets.
## Current state (what exists today, what throws, with file:line)
- `src/index.ts:8-22` exposes a hand-written `CaretakerExtension`; `activate()` always throws `not implemented` at lines 17-20 and accepts no runtime/dependency context.
- `src/events.ts:57-65` models only a successful POST result; `handlePostEvents()` throws the same TODO at lines 67-73, so rejection statuses and queue injection do not exist.
- `src/queue.ts:9-29` has interfaces only, so activation cannot yet construct or drain a queue.
- `src/telegram/index.ts:9-16` is type-only; there is no concrete adapter or Pi turn/session interface to register.
- `src/health.ts` is implemented, but `src/index.ts` does not import it; the packaged entry cannot currently serve the build-injected commit.
- `tests/scaffold.test.ts:18-27` deliberately requires both throws. `tests/e2e/webhook.e2e.test.ts:17-45` has nine listener placeholders, and `tests/e2e/pipeline.e2e.test.ts:13-37` has seven pipeline placeholders.
## Steps (ordered and concrete, naming exact files, exports and error codes)
1. Resolve the owner decisions below and land/confirm the queue, authenticated-listener, background-triage, and Telegram/runtime adapter contracts first. Activation must not invent a fake Pi API or silently skip a missing dependency.
2. Add `src/config.ts` exporting `CaretakerConfig`, `ConfigurationError`, and `readCaretakerConfig(env: NodeJS.ProcessEnv): CaretakerConfig`. Read only the owner-approved environment keys; trim/validate required values, parse port and queue capacity as bounded integers, apply only approved defaults, and never include values in errors/logs. Use exact non-secret codes `MISSING_WEBHOOK_TOKEN`, `INVALID_PORT`, and `INVALID_QUEUE_CAPACITY` unless the owner chooses a different public error contract.
3. In `src/events.ts`, inject an `EventQueue<EventEnvelope>` and expected bearer token into `handlePostEvents` (via an explicit context parameter/type). Authenticate before body parsing, reject byte length above `MAX_EVENT_BODY_BYTES`, parse JSON, validate with `eventEnvelopeSchema`, then enqueue exactly once.
4. Expand `PostEventsResult` into a discriminated union with exact HTTP statuses: 401 unauthorized, 413 oversized, 400 malformed/invalid envelope, 503 queue full, and 202 `{ queued: true }` only after `enqueue` returns accepted. Error response-body codes are an owner decision; never claim processing or Telegram delivery.
5. Add `src/listener.ts` exporting `createCaretakerServer(options)` using `node:http`: `GET /health` returns exactly `getHealth(extension.version)`, `POST /events` delegates to `handlePostEvents`, wrong methods return 405, and unknown routes return 404. Enforce the streaming body cap without buffering beyond the limit and return JSON without echoing credentials or payloads.
6. In `src/index.ts`, import health/listener code so build-time commit injection is reachable from the packaged entry. In `activate()`, call `readCaretakerConfig(process.env)`, construct `createEventQueue<EventEnvelope>`, attach the prerequisite sequential background-turn consumer, register the single Telegram inbound handler through the prerequisite runtime bridge, and listen on the configured address exactly once. Startup/configuration failures must surface; do not convert them to a no-op.
7. Use the owner-approved Pi-native lifecycle hook to stop accepting requests and await/terminate in-memory delivery on shutdown. Do not add persistence or promise restart recovery; pending queue entries are intentionally lost.
8. Delete `tests/scaffold.test.ts` in the same change. Move its still-valid name/version assertion to `tests/index.test.ts`; do not retain assertions that require a stub throw.
9. Add the ADR/configuration obligations below and `.changeset/extension-activation.md`; update `package.json` and `pnpm-lock.yaml` only if the owner-approved Pi extension API requires a runtime dependency.
10. Perform focused red→green runs for config, real-socket webhook, pipeline wiring, and packaged-entry tests; then run `pnpm check` and `pnpm build` (the latter is mandatory because `src/index.ts` changes).
## Files touched (new / modified)
- New: `src/config.ts`, `src/listener.ts`, `tests/config.test.ts`, `tests/index.test.ts`, `.changeset/extension-activation.md`
- Modified: `src/events.ts`, `src/index.ts`, `tests/e2e/webhook.e2e.test.ts`, `tests/e2e/pipeline.e2e.test.ts`, `tests/build/artifact.test.ts`
- Deleted: `tests/scaffold.test.ts`
- New: `docs/decisions/0005-runtime-configuration.md`
- Modified: `docs/decisions/index.md`, and the pins in ADR-0001/0002/0003 where the new e2e tests enforce them
- Conditional on the approved Pi API: `package.json`, `pnpm-lock.yaml`
## ADR obligations (pointer + pin, or "none" and why)
- Runtime environment names, required/default values, and startup failure behavior form a binding operator contract: copy `docs/decisions/TEMPLATE.md` to `docs/decisions/0005-runtime-configuration.md`, record the owner-approved contract, add its index row, pin it with `tests/config.test.ts`, and put a one-line `ADR-0005` pointer in `src/config.ts`.
- Keep the existing ADR-0001/0002 pointers in `src/events.ts` and ADR-0001/0003/0004 pointers in `src/index.ts`; add real webhook/pipeline test pins to the corresponding ADR files and index rows when their placeholder cases become behavioral.
- Create the ADR and governed code in the same commit/date so the ADR guard does not reject drift.
## Test plan (each new test, which existing it.todo it replaces, and the red proof: what fails without this change)
- `tests/config.test.ts`: each required variable missing/blank yields the exact approved `ConfigurationError.code`; valid approved values produce the exact typed config; invalid/zero/fractional/out-of-range port or capacity yields `INVALID_PORT`/`INVALID_QUEUE_CAPACITY`; unrelated env keys are ignored. Red: `src/config.ts` does not exist.
- `tests/index.test.ts`: preserve exact name/version and prove activation calls the approved listener/queue/turn-registration seams once with parsed config; a missing token surfaces rather than becoming a no-op. Red: current activation throws before wiring. Use dependency seams or a child process—never mutate shared global env without restoration.
- Replace all nine `tests/e2e/webhook.e2e.test.ts:17-45` todos over a real loopback socket: exact health keys and built commit, 401 before parsing, cap+1 gives 413, invalid JSON/schema gives 400, admitted event gives only 202/queued, full queue gives 503, 405/404 routing, and a table invariant that no rejected input receives 202. Red: there is no server and both entry/handler throw.
- In the 202 case, inspect the real queue/consumer recorder to prove admission; do not infer admission merely from the response. In the 401 case send malformed JSON and assert 401 plus zero queue writes, proving auth precedes parse.
- Replace `tests/e2e/pipeline.e2e.test.ts:21-27` only when the prerequisite background-triage ticket co-lands: POST hostile text through the real socket and assert the model recorder receives verbatim data with byte-identical `TRIAGE_INSTRUCTIONS`; configure `notify: false` and assert Telegram `notifies` is exactly empty. Red: activation currently cannot connect listener → queue → turn handler.
- Leave the pipeline sequential/overflow/restart todos to the queue ticket, escape-hatch todo to its ticket, and Telegram reply/context todo to the session/Telegram ticket; converting them here would widen scope.
- Replace `tests/build/artifact.test.ts` packaged-entry todo: build the real entry, start it with non-secret test env/config, request health, and assert commit equals `git rev-parse --short HEAD`; update the old assertion that activation throws. Red: health code is absent from the current entry bundle.
- Record each focused test failing against the pre-change stubs/missing config before making it green; deleting `tests/scaffold.test.ts` is not itself red proof.
## Open decisions for the owner (never guess - list them instead)
- What are the exact environment variable names, which are required, and what defaults/bounds apply for bind host, port, queue capacity, and webhook token? No names are defined in source/docs today.
- Which actual Pi extension package/version and activation/shutdown API must be used? The repo has no Pi dependency and the current zero-argument interface provides no registration context.
- What concrete background-turn/session and Telegram adapters does activation receive, and how are they obtained without adding a second notifier? Those implementations are separate tickets but are required for honest activation.
- Is repeated `activate()` rejected, idempotent, or treated as restart; and what exact shutdown/drain behavior does the Pi host expect?
- What JSON error-body shape/codes accompany 400/401/404/405/413/503? Only the HTTP statuses are currently fixed (503 is specified by the repo testing guidance).
- Should listener binding failure be thrown synchronously, reported through Pi, or represented by an async lifecycle API while preserving `activate(): void`?
## Out of scope for this ticket
- Selecting Pitgram versus grammY, implementing model judgment/escape-hatch rules, durable retry/recovery, session persistence internals, remote network/live credential tests, Docker/deploy files, rate limiting beyond bounded queue admission, and any V1 non-goal. Rate-limit policy beyond queue-full 503 needs its own ADR before implementation.
