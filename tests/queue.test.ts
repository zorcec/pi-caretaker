import { describe, expect, it, vi } from "vitest";
import {
  createEventQueue,
  DELIVERY_MAX_ATTEMPTS,
  DELIVERY_RETRY_BASE_DELAY_MS,
  startDelivery,
  type EventQueue,
} from "../src/queue.js";

/**
 * Pins the bounded in-memory FIFO and retrying delivery pump (ADR-0001).
 * Sequence numbers start at zero, capacity counts retained events, and
 * consumer failures retry three times with a deterministic backoff before
 * terminal failure leaves the failed body at the queue front.
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

    it("retries a transient consumer failure and delivers successfully without terminal state", async () => {
      const queue = createEventQueue<string>({ capacity: 2 });
      const failure = new Error("transient consumer failure");
      const seen: string[] = [];
      const delays: number[] = [];
      const terminalFailures: unknown[] = [];
      let attempts = 0;
      const pump = startDelivery(queue, async (event) => {
        attempts += 1;
        if (attempts === 1) throw failure;
        seen.push(event.body);
      }, {
        delay: async (milliseconds) => { delays.push(milliseconds); },
        onTerminalFailure: (failure) => { terminalFailures.push(failure); },
      });
      queue.enqueue("recover me");

      await pump.drained();

      expect(attempts).toBe(2);
      expect(seen).toEqual(["recover me"]);
      expect(delays).toEqual([DELIVERY_RETRY_BASE_DELAY_MS]);
      expect(queue.size).toBe(0);
      expect(pump.hasFailed()).toBe(false);
      expect(pump.getFailure()).toBeUndefined();
      expect(terminalFailures).toEqual([]);
    });

    it("retries three times, then fails terminally with the failed body at the queue front", async () => {
      const queue = createEventQueue<string>({ capacity: 3 });
      queue.enqueue("ok");
      queue.enqueue("failed body must be retained");
      queue.enqueue("waiting");
      const failure = new Error("consumer blew up");
      let failureAttempts = 0;
      const pump = startDelivery<string>(queue, async (event) => {
        if (event.body === "failed body must be retained") {
          failureAttempts += 1;
          throw failure;
        }
      }, { delay: async () => undefined });

      await expect(pump.drained()).rejects.toBe(failure);
      expect(failureAttempts).toBe(DELIVERY_MAX_ATTEMPTS);
      expect(pump.hasFailed()).toBe(true);
      expect(pump.getFailure()).toMatchObject({
        attempts: DELIVERY_MAX_ATTEMPTS,
        error: failure,
      });
      expect(queue.size).toBe(2);
      expect(queue.peek()?.body).toBe("failed body must be retained");
      expect(queue.dequeue()?.body).toBe("failed body must be retained");
      expect(queue.dequeue()?.body).toBe("waiting");
    });

    it("pins the bounded retry backoff schedule with fake timers", async () => {
      vi.useFakeTimers();
      try {
        expect(DELIVERY_MAX_ATTEMPTS).toBe(3);
        expect(DELIVERY_RETRY_BASE_DELAY_MS).toBe(250);
        const queue = createEventQueue<string>({ capacity: 1 });
        const failure = new Error("always fails");
        let attempts = 0;
        const pump = startDelivery(queue, async () => {
          attempts += 1;
          throw failure;
        });
        queue.enqueue("retry schedule");
        const settled = pump.drained().catch((error: unknown) => error);
        const flushMicrotasks = async (): Promise<void> => {
          for (let index = 0; index < 8; index += 1) await Promise.resolve();
        };

        await flushMicrotasks();
        expect(attempts).toBe(1);
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(249);
        expect(attempts).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(attempts).toBe(2);
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(499);
        expect(attempts).toBe(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(attempts).toBe(3);
        await expect(settled).resolves.toBe(failure);
        expect(pump.hasFailed()).toBe(true);
      } finally {
        vi.useRealTimers();
      }
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
