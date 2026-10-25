import { describe, expect, it } from "vitest";
import {
  createEventQueue,
  startDelivery,
} from "../../src/queue.js";

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
  it("delivers concurrent arrivals sequentially and in order", async () => {
    const queue = createEventQueue<string>({ capacity: 10 });
    let active = 0;
    let maxActive = 0;
    const seen: string[] = [];
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    const pump = startDelivery(queue, async (event) => {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      if (calls === 1) await firstHeld;
      seen.push(event.body);
      active -= 1;
    });

    queue.enqueue("a");
    queue.enqueue("b");
    queue.enqueue("c");
    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseFirst();
    await pump.drained();

    expect(maxActive).toBe(1);
    expect(seen).toEqual(["a", "b", "c"]);
  });

  it.todo(
    "escape hatch: a must-notify event notifies exactly once even when the model answers \"ignore\"",
  );

  it.todo(
    "hostile webhook text reaches the model in the data channel only; instructions stay byte-identical",
  );

  it.todo(
    "a \"not important\" verdict sends nothing to Telegram — silence is observable",
  );

  it("rejects arrivals beyond capacity while earlier ones keep their place", async () => {
    const queue = createEventQueue<string>({ capacity: 2 });

    // Fill before delivery starts, so the refusal is deterministic: with a
    // running pump the first item would already be in flight, not retained.
    expect(queue.enqueue("first")).toEqual({ accepted: true });
    expect(queue.enqueue("second")).toEqual({ accepted: true });
    expect(queue.enqueue("third")).toEqual({
      accepted: false,
      reason: "full",
    });
    expect(queue.size).toBe(2);

    const seen: string[] = [];
    const pump = startDelivery(queue, async (event) => {
      seen.push(event.body);
    });
    await pump.drained();

    expect(seen).toEqual(["first", "second"]);
  });

  it("restarting drops unprocessed events: a fresh queue starts empty", () => {
    const before = createEventQueue<string>({ capacity: 2 });
    before.enqueue("unprocessed");

    const after = createEventQueue<string>({ capacity: 2 });

    expect(after.size).toBe(0);
    expect(after.dequeue()).toBeUndefined();
  });

  it.todo("a Telegram reply is answered in the same session, with event context");
});
