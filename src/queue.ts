/**
 * Bounded in-memory FIFO (ADR-0001).
 *
 * The queue is intentionally NOT crash-durable: a `202` means "queued in
 * memory", and anything unprocessed at restart is lost. A fresh instance
 * starts empty — there is no shared module storage to recover from.
 *
 * Chosen defaults, flagged for the owner on ticket 6a8e1458 (all reversible,
 * none user-visible beyond the contract): sequence numbers start at 0 and
 * increment per accepted arrival (refusals consume none); capacity counts
 * retained waiting events only; capacity must be a positive integer
 * (RangeError otherwise); a consumer throw stops the pump and surfaces
 * through drained() — the failed event stays queued, nothing is retried.
 */
export interface QueueOptions {
  /** Maximum events held in memory before new arrivals are rejected. */
  capacity: number;
}

export interface QueuedEvent<T> {
  seq: number;
  receivedAt: string;
  body: T;
}

export type EnqueueResult =
  | { accepted: true }
  | { accepted: false; reason: "full" };

export interface EventQueue<T> {
  readonly capacity: number;
  readonly size: number;
  enqueue(item: T): EnqueueResult;
  dequeue(): QueuedEvent<T> | undefined;
}

/**
 * A queue that wakes one delivery pump when items arrive. The factory below
 * returns this; the interface stays parameter-compatible with EventQueue<T>.
 */
export interface SignallingQueue<T> extends EventQueue<T> {
  /** Register a wake-up; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

export type QueueConsumer<T> = (event: QueuedEvent<T>) => Promise<void>;

export interface DeliveryController {
  /** True once the consumer has failed; failure is terminal until restart. */
  hasFailed(): boolean;
  /** Halt after the in-flight delivery finishes; the rest stays queued. */
  stop(): void;
  /**
   * Resolves when delivery is idle and halted with nothing in flight.
   * Rejects with the consumer's error when a delivery throws — the pump
   * is then stopped and the failed event remains queued.
   */
  drained(): Promise<void>;
}

/** Create a bounded in-memory FIFO. Capacity must be a positive integer. */
export function createEventQueue<T>(options: QueueOptions): SignallingQueue<T> {
  const { capacity } = options;
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new RangeError(
      `queue capacity must be a positive integer, got ${String(capacity)}`,
    );
  }
  const retained: QueuedEvent<T>[] = [];
  const listeners = new Set<() => void>();
  let nextSeq = 0;
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  return {
    capacity,
    get size(): number {
      return retained.length;
    },
    enqueue(item: T): EnqueueResult {
      if (retained.length >= capacity) {
        return { accepted: false, reason: "full" };
      }
      retained.push({
        seq: nextSeq,
        receivedAt: new Date().toISOString(),
        body: item,
      });
      nextSeq += 1;
      notify();
      return { accepted: true };
    },
    dequeue(): QueuedEvent<T> | undefined {
      return retained.shift();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Deliver one queue's items sequentially: at most one consumer call in
 * flight, in FIFO order. Stops on the first consumer throw (the error
 * surfaces through drained(); the failed event stays queued, unretried).
 */
export function startDelivery<T>(
  queue: SignallingQueue<T>,
  consumer: QueueConsumer<T>,
): DeliveryController {
  let stopped = false;
  let inFlight = 0;
  let failed: unknown;
  let hasFailed = false;
  let wake: (() => void) | undefined;
  let unsubscribed = false;
  const waiters = new Set<{
    resolve: () => void;
    reject: (error: unknown) => void;
  }>();
  const unsubscribe = queue.subscribe(() => {
    wake?.();
  });
  const unsubscribeOnce = (): void => {
    if (!unsubscribed) {
      unsubscribed = true;
      unsubscribe();
    }
  };
  // Settle everyone waiting when no more delivery can or will happen:
  // failure rejects; an idle queue or a stopped pump resolves. An idle but
  // still-running pump keeps its wake-up — only terminal states unsubscribe.
  const checkSettled = (): void => {
    if (hasFailed) {
      for (const waiter of waiters) waiter.reject(failed);
      waiters.clear();
      unsubscribeOnce();
      return;
    }
    if (inFlight === 0 && (queue.size === 0 || stopped)) {
      for (const waiter of waiters) waiter.resolve();
      waiters.clear();
      if (stopped) unsubscribeOnce();
    }
  };
  const loop = async (): Promise<void> => {
    while (!stopped) {
      const event = queue.dequeue();
      if (event === undefined) {
        if (stopped) break;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = undefined;
        checkSettled();
        continue;
      }
      inFlight += 1;
      try {
        await consumer(event);
      } catch (error) {
        hasFailed = true;
        failed = error;
        stopped = true;
      } finally {
        inFlight -= 1;
      }
      checkSettled();
    }
    checkSettled();
  };
  void loop();
  return {
    hasFailed(): boolean {
      return hasFailed;
    },
    stop(): void {
      stopped = true;
      wake?.();
      wake = undefined;
      checkSettled();
    },
    drained(): Promise<void> {
      if (hasFailed) return Promise.reject(failed);
      if (inFlight === 0 && (queue.size === 0 || stopped)) {
        if (stopped) unsubscribeOnce();
        return Promise.resolve();
      }
      return new Promise<void>((resolve, reject) => {
        waiters.add({ resolve, reject });
        checkSettled();
      });
    },
  };
}
