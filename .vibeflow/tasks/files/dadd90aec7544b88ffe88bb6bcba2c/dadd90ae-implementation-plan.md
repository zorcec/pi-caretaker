# Authenticated HTTP listener - implementation plan
Ticket: dadd90aec7544b88ffe88bb6bcba2c | Parent: Initial implementation (0ce8c29edee87ade5c6ca89f4a3c77)
## Goal
Implement a native-Node HTTP listener for unauthenticated `GET /health` and bearer-authenticated `POST /events`; admit only valid, at-most-64-KiB envelopes to an injected in-memory `EventQueue<EventEnvelope>`, returning 202 only after `enqueue` accepts.
## Non-goals (explicit)
- Do not implement queue storage, sequential Pi delivery, triage, Telegram, extension activation/environment loading, TLS, deployment, persistence, dedupe/correlation, dashboards, collectors, a database, or infrastructure changes.
- Do not add rate limiting beyond the existing bounded-queue overload guard; broader throttling needs separate scope and, if it creates a binding policy, its own ADR.
- Do not log bearer tokens or whole webhook payloads, and do not add `.env` handling.
## Current state (what exists today, what throws, with file:line)
- `src/events.ts:14-34` defines the 64-KiB byte cap and boundary helper; `src/events.ts:19-29` defines the zod envelope and inferred `EventEnvelope`.
- `src/events.ts:57-73` defines a request and success-only result, but `handlePostEvents` always throws the TODO error.
- `src/queue.ts:9-29` has only `EventQueue`, `EnqueueResult`, and queued-item contracts; there is no concrete queue to instantiate.
- `src/health.ts:9-30` already returns exactly `{status, version, commit}` and consumes the tsup-injected commit.
- `src/index.ts:14-22` exposes the extension, but `activate()` throws; activation is a separate ticket and should remain explicit.
- `tests/e2e/webhook.e2e.test.ts:16-45` contains nine socket-level `it.todo` cases; `tests/scaffold.test.ts:23-27` pins the listener stub and must be removed when it becomes real.
## Steps (ordered and concrete, naming exact files, exports and error codes)
1. In `src/events.ts`, make `PostEventsResult` a discriminated result for HTTP 202, 400, 401, 413, and 503, and change exported `handlePostEvents(request, expectedToken, queue)` to accept an `EventQueue<EventEnvelope>` dependency rather than constructing storage.
2. In `handlePostEvents`, apply checks in security/contract order: exact `Bearer <token>` authorization first; raw UTF-8 byte size via `Buffer.byteLength`/`Uint8Array.byteLength` second; JSON parse and `eventEnvelopeSchema.safeParse` third; `queue.enqueue(parsed.data)` last. Return 401 unauthorized, 413 payload too large, 400 invalid JSON/envelope, 503 queue full, and `{status: 202, queued: true}` only after accepted admission. Never include token or payload text in errors.
3. Add `src/listener.ts` with governed-code pointers to ADR-0001 and ADR-0002. Export `WebhookListenerOptions` (`token`, `version`, `queue`) and `createWebhookListener(options): http.Server`, using only `node:http` and `getHealth`—no web framework dependency.
4. Route exactly `GET /health` and `POST /events`. Serialize health with HTTP 200 and exactly its three keys; serialize an admitted event as JSON `{queued:true}` with HTTP 202; map handler rejections to their exact HTTP status. Return 405 plus `Allow` for a known path with a wrong method, and 404 for an unknown path.
5. At the HTTP stream boundary, reject declared or observed bodies above `MAX_EVENT_BODY_BYTES` with 413, stop buffering, and prevent a later `end` event from writing or enqueueing. Check POST authorization before parsing (and before buffering where possible), so malformed unauthorized input remains 401.
6. In `src/index.ts`, re-export `createWebhookListener` and its option type for the future activation ticket, but leave `extension.activate()` throwing until its own wiring/environment task lands. Coordinate with ticket 4ef82184 so the same entry also exposes health without creating an import cycle.
7. Replace all nine todos in `tests/e2e/webhook.e2e.test.ts` with real tests that boot `createWebhookListener` on loopback port 0 and always close it. Use an injected recording/full queue test double; do not implement the production FIFO in this ticket.
8. Delete `tests/scaffold.test.ts` as directed by linked ticket 6cf2146d; retain its fixed-instruction assertion by moving it to `tests/untrusted-payload.test.ts` only if not already covered, while the build test continues to pin the still-stubbed `activate()`.
9. Run the focused e2e test red against the pre-change stub, then green; run `pnpm check` and `pnpm build`, and inspect `git diff --check` and staged state before commit.
## Files touched (new / modified)
- New: `src/listener.ts`.
- Modified: `src/events.ts`, `src/index.ts`, `tests/e2e/webhook.e2e.test.ts`; possibly `tests/untrusted-payload.test.ts` only to preserve a non-duplicated ADR-0002 pin.
- Deleted: `tests/scaffold.test.ts`.
- No change: `src/queue.ts` (the concrete queue belongs to ticket 6a8e1458); `src/health.ts` unless ticket 4ef82184 establishes a different entry wrapper.
## ADR obligations (pointer + pin, or "none" and why)
- No new ADR: ADR-0001 already fixes honest admission/status semantics and ADR-0002 already fixes the untrusted-data boundary.
- Keep the `ADR-0001`/`ADR-0002` pointer in `src/events.ts` and add the same one-line governing pointer to `src/listener.ts`. Pin admission/auth/size behavior in `tests/e2e/webhook.e2e.test.ts`; retain `tests/events.test.ts` and `tests/untrusted-payload.test.ts` as the existing ADR index pins. Do not edit an accepted decision unless the implementation discovers a genuinely new binding choice; such a choice needs its own ADR, index row, pin, and pointer in this same change.
## Test plan (each new test, which existing it.todo it replaces, and the red proof: what fails without this change)
- Replace health-shape todo: real GET returns 200 and deep-equals only `{status,version,commit}`; red because no server exists.
- Replace injected-commit todo: exercise the built packaged entry/listener and compare `commit` to `git rev-parse --short HEAD`, never `dev`; red because health is unreachable from `index.js`.
- Replace auth todo: missing, wrong, and malformed bearer values return 401 and enqueue nothing; red because the handler throws.
- Replace cap todo: exactly 64 KiB proceeds to validation/admission while one byte over returns 413 and enqueue stays empty; red because no stream cap exists.
- Replace invalid-input todo: invalid JSON, missing/empty `message`, and unknown severity each return 400 and enqueue nothing; red because no parse/validation path exists.
- Replace admission todo: a valid minimal envelope returns exactly 202/`{queued:true}` and is observable in the injected queue; red because no enqueue call exists.
- Replace overload todo: a queue returning `{accepted:false,reason:"full"}` yields 503, never 202; red because no overload mapping exists.
- Replace routing todo: wrong method on known route is 405 (with `Allow`) and unknown route is 404; red because no router exists.
- Replace invariant todo with a table of malformed/unauthorized/oversized/full inputs asserting none returns 202 and none enters the queue; red because there is no listener and catches accidental check reordering.
- Preserve red evidence in the commit notes or ticket: focused e2e fails against the old throwing/no-server implementation, then passes after implementation.
## Open decisions for the owner (never guess - list them instead)
- Confirm the public listener factory/shutdown surface (`createWebhookListener` returning `http.Server`) because the ticket specifies routes but not the exported lifecycle API used by activation.
- Confirm whether rejection responses need stable JSON error identifiers/messages; HTTP statuses are fixed (400/401/413/503), but the current contract specifies no error-body schema. Keep bodies generic until decided.
- Confirm whether `Content-Type: application/json` must be enforced; the concept shows it in examples but does not define a rejection status for a missing/wrong value.
## Out of scope for this ticket
Concrete FIFO/consumer behavior, Pi turn serialization, request-rate policy, environment variable names, host/port defaults, TLS/proxy trust, Telegram behavior, durable retry/storage, and all V1 binding non-goals. Any persistence, dedupe/correlation, dashboard, collector, database, or automatic infrastructure work needs its own ADR rather than expansion of this plan.
