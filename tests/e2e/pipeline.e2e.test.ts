import { describe, it } from "vitest";

/**
 * Tier 4 — pipeline e2e: real queue + real triage boundary + the recording
 * doubles from tests/setup/doubles.ts.
 *
 * These are the assertions where the four decision records stop being prose
 * and start being behavior. Each is pending on the listener/queue/triage
 * tickets; the doubles they need already exist and are pinned in
 * tests/testkit.test.ts.
 */
describe("event pipeline (queue -> triage -> Telegram)", () => {
  it.todo(
    "delivers concurrent arrivals sequentially and in order — no interleaving",
  );

  it.todo(
    "escape hatch: a must-notify event notifies exactly once even when the model answers \"ignore\"",
  );

  it.todo(
    "hostile webhook text reaches the model in the data channel only; instructions stay byte-identical",
  );

  it.todo(
    "a \"not important\" verdict sends nothing to Telegram — silence is observable",
  );

  it.todo(
    "events beyond capacity are rejected while earlier arrivals keep their 202",
  );

  it.todo(
    "restarting drops unprocessed events — documented loss, not silent recovery",
  );

  it.todo("a Telegram reply is answered in the same session, with event context");
});
