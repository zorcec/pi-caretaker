import { describe, it } from "vitest";

/**
 * Tier 3 — webhook listener e2e, over a real HTTP socket.
 *
 * Every case is pending on TODO(pi-caretaker-1) (authenticated listener,
 * validation, queue admission): today `handlePostEvents` and
 * `extension.activate()` both throw `not implemented`, so there is no server
 * to boot. These are the assertions that replace `tests/scaffold.test.ts`
 * when the listener lands — write them as real tests in that change, with
 * each one proven red against the old behavior first (AGENTS.md).
 *
 * Rules under test: ADR-0001 (real status codes, 202 means queued in memory)
 * and ADR-0002 (payload stays data). Decision files live in docs/decisions.
 */
describe("webhook listener (POST /events, GET /health)", () => {
  it.todo(
    "GET /health answers exactly {status, version, commit} — no extra keys",
  );

  it.todo(
    "GET /health reports the build-injected commit of the artifact, not \"dev\"",
  );

  it.todo("rejects a missing or wrong bearer token with 401, never 202");

  it.todo("rejects a body one byte over the 64 KiB cap with 413");

  it.todo(
    "rejects invalid JSON, a missing message and an unknown severity with 400",
  );

  it.todo(
    "answers 202 with the documented queued shape only for an admitted event",
  );

  it.todo(
    "answers a real overload status when the queue is full — never a fake 202",
  );

  it.todo("answers 405 for the wrong method and 404 for an unknown route");

  it.todo(
    "invariant: no malformed or unauthorized request of any kind ever receives 202",
  );
});
