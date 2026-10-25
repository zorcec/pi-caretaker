import { describe, expect, it } from "vitest";
import {
  createEventQueue,
  startDelivery,
  type EventQueue,
} from "../src/queue.js";

/**
 * Pins the bounded in-memory FIFO (ADR-0001, queue half).
 *
 * The interface in src/queue.ts promises admission/full results but ships no
 * behavior; every case below fails against the interface-only file (missing
 * exports) and passes once the FIFO exists. Chosen defaults, all flagged for
 * the owner on ticket 6a8e1458: sequence starts at 0, capacity counts
 * retained waiting events only, a consumer throw stops the pump and surfaces
 * through drained(), and capacity must be a positive integer (RangeError).
 */
describe("bounded in-memory queue", () => {
  describe("createEventQueue", () => {
    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      "rejects capacity %p with a RangeError naming the value",
      (capacity) => {
        expect(() => createEventQueue({ capacity })).toThrow(RangeError);
        expect(() => createEventQueue({ capacity })).toThrow(
          String(capacity),
        );
      },
    );

    it("accepts a positive integer capacity", () => {
      const queue = createEventQueue<string>({ capacity: 1 });

      expect(queue.capacity).toBe(1);
      expect(queue.size).toBe(0);
    });

    it("starts empty: dequeue on a fresh queue is undefined", () => {
      const queue = createEventQueue<string>({ capacity: 2 });

      expect(queue.dequeue()).toBeUndefined();
      expect(queue.size).toBe(0);
    });
  });

  describe("admission", () => {
    it("accepts up to capacity, then refuses with reason full and keeps size", () => {
      const queue = createEventQueue<string>({ capacity: 2 });

      expect(queue.enqueue("a")).toEqual({ accepted: true });
      expect(queue.enqueue("b")).toEqual({ accepted: true });
      expect(queue.size).toBe(2);
      expect(queue.enqueue("c")).toEqual({
        accepted: false,
        reason: "full",
      });
      expect(queue.size).toBe(2);
    });

    it("a rejection consumes no sequence: the next admission continues the run", () => {
      const queue = createEventQueue<string>({ capacity: 1 });
      queue.enqueue("a");
      queue.enqueue("overflow");

      queue.dequeue();
      queue.enqueue("b");

      // seqs are 0, 1 — the refused arrival left no gap.
      expect(queue.dequeue()?.seq).toBe(1);
    });

    it("assigns consecutive sequences from 0 with ISO receivedAt stamps", () => {
      const queue = createEventQueue<string>({ capacity: 3 });
      queue.enqueue("a");
      queue.enqueue("b");

      const first = queue.dequeue();
      const second = queue.dequeue();

      expect(first?.seq).toBe(0);
      expect(second?.seq).toBe(1);
      for (const event of [first, second]) {
        const parsed = Date.parse(event?.receivedAt ?? "");
        expect(Number.isNaN(parsed)).toBe(false);
        expect(new Date(parsed).toISOString()).toBe(event?.receivedAt);
      }
    });

    it("dequeues FIFO: bodies come out in admission order", () => {
      const queue = createEventQueue<string>({ capacity: 3 });
      queue.enqueue("first");
      queue.enqueue("second");
      queue.enqueue("third");

      expect(queue.dequeue()?.body).toBe("first");
      expect(queue.dequeue()?.body).toBe("second");
      expect(queue.dequeue()?.body).toBe("third");
      expect(queue.dequeue()).toBeUndefined();
      expect(queue.size).toBe(0);
    });
  });

  describe("restart loss (ADR-0001: the queue is not crash-durable)", () => {
    it("a new queue holds nothing: unprocessed events do not survive", () => {
      const before = createEventQueue<string>({ capacity: 2 });
      before.enqueue("unprocessed");

      const after = createEventQueue<string>({ capacity: 2 });

      expect(after.size).toBe(0);
      expect(after.dequeue()).toBeUndefined();
      // The old instance is untouched — loss comes from replacement, not sharing.
      expect(before.size).toBe(1);
    });
  });

  describe("sequential delivery", () => {
    it("delivers concurrent arrivals one at a time, in admission order", async () => {
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
      // Let the pump pick up the first item and block inside it.
      await new Promise((resolve) => setTimeout(resolve, 20));
      releaseFirst();
      await pump.drained();

      expect(maxActive).toBe(1);
      expect(seen).toEqual(["a", "b", "c"]);
    });

    it("stops on consumer failure and surfaces the error; the failed event stays queued", async () => {
      const queue = createEventQueue<string>({ capacity: 3 });
      queue.enqueue("ok");
      queue.enqueue("boom");
      queue.enqueue("waiting");
      const failure = new Error("consumer blew up");
      const pump = startDelivery<string>(queue, async (event) => {
        if (event.body === "boom") throw failure;
      });

      await expect(pump.drained()).rejects.toBe(failure);
      expect(queue.size).toBe(1);
      expect(queue.dequeue()?.body).toBe("waiting");
    });

    it("stop() halts delivery after the in-flight item; the rest stays queued", async () => {
      const queue = createEventQueue<string>({ capacity: 3 });
      const seen: string[] = [];
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let calls = 0;
      const pump = startDelivery(queue, async (event) => {
        calls += 1;
        if (calls === 1) await held;
        seen.push(event.body);
      });
      queue.enqueue("first");
      queue.enqueue("second");
      await new Promise((resolve) => setTimeout(resolve, 20));

      pump.stop();
      release();
      await pump.drained();

      expect(seen).toEqual(["first"]);
      expect(queue.size).toBe(1);
      // A stopped pump stays stopped: no further delivery happens.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(seen).toEqual(["first"]);
    });

    it("drained() on an idle empty pump resolves", async () => {
      const queue = createEventQueue<string>({ capacity: 1 });
      const pump = startDelivery(queue, async () => undefined);

      await expect(pump.drained()).resolves.toBeUndefined();
      pump.stop();
    });

    it("works through the EventQueue interface type", () => {
      const queue: EventQueue<string> = createEventQueue<string>({
        capacity: 1,
      });

      expect(queue.enqueue("x")).toEqual({ accepted: true });
      expect(queue.dequeue()?.body).toBe("x");
    });
  });
});
