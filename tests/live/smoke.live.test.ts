import { describe, it } from "vitest";

/**
 * Tier 5 — live e2e: real network, real credentials, real Telegram.
 *
 * Never runs in `pnpm test` or `pnpm check` (separate vitest config), because
 * a flaky third party must not be able to block a commit. Sourced from the
 * proof-of-concept list in docs/concept/pi-caretaker-high-level-concept-v3.md
 * and the Pitgram spike tracked in docs/research/README.md — record the
 * verdict there before turning any of these green.
 */
describe("live caretaker (network + credentials)", () => {
  it.todo(
    "vibeflow POSTs a real envelope to the local listener and receives 202",
  );

  it.todo("a background webhook turn produces no Telegram output at all");

  it.todo("an explicit proactive notification reaches the Telegram chat");

  it.todo("a Telegram reply is answered with the background event's context");

  it.todo("several webhooks during a busy turn are handled sequentially");

  it.todo("a restart recovers the session and loses only queued events");
});
