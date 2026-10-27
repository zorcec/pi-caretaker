/**
 * Bounded in-memory FIFO (ADR-0001).
 *
 * The queue is intentionally NOT crash-durable: a `202` means "queued in
 * memory", and anything unprocessed at restart is lost. A fresh instance
 * starts empty — there is no shared module storage to recover from.
 *
 * Sequence numbers start at 0 and increment per accepted arrival (refusals
 * consume none); capacity includes the event being delivered and must be a
 * positive integer. Delivery retries a failing event three times with bounded
 * backoff; exhaustion stops the pump and retains the failed event at the front
 * until process restart.
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
  /** Current FIFO head without removing it, for retry-safe delivery. */
  peek(): QueuedEvent<T> | undefined;
  /** Register a wake-up; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

export type QueueConsumer<T> = (event: QueuedEvent<T>) => Promise<void>;

export const DELIVERY_MAX_ATTEMPTS = 3;
export const DELIVERY_RETRY_BASE_DELAY_MS = 250;

export interface DeliveryFailure<T> {
  event: QueuedEvent<T>;
  error: unknown;
  attempts: number;
  at: string;
}

export interface DeliveryOptions<T> {
  /** Injectable timer seam; defaults to a real timeout. */
  delay?: (milliseconds: number) => Promise<void>;
  onTerminalFailure?: (failure: DeliveryFailure<T>) => void;
}

export interface DeliveryController<T = unknown> {
  /** True once delivery retries are exhausted; failure is terminal until restart. */
  hasFailed(): boolean;
  /** Details for the terminal, retained event, if delivery exhausted retries. */
  getFailure(): DeliveryFailure<T> | undefined;
  /** Halt after the in-flight delivery finishes; the rest stays queued. */
  stop(): void;
  /**
   * Resolves when delivery is idle and halted with nothing in flight.
   * Rejects with the final consumer error after bounded retries exhaust;
   * the failed event remains at the queue front.
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
    peek(): QueuedEvent<T> | undefined {
      return retained[0];
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
 * Deliver one queue's items sequentially. The head remains in the bounded
 * queue until acknowledged by a successful consumer call, so failures retain
 * it at the front throughout three total attempts and terminal exhaustion.
 */
export function startDelivery<T>(
  queue: SignallingQueue<T>,
  consumer: QueueConsumer<T>,
  options: DeliveryOptions<T> = {},
): DeliveryController<T> {
  const delay = options.delay ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let stopped = false;
  let inFlight = 0;
  let failure: DeliveryFailure<T> | undefined;
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
      for (const waiter of waiters) waiter.reject(failure?.error);
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
      const event = queue.peek();
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
      let delivered = false;
      let lastError: unknown;
      let attempts = 0;
      try {
        while (attempts < DELIVERY_MAX_ATTEMPTS && !stopped) {
          attempts += 1;
          try {
            await consumer(event);
            queue.dequeue();
            delivered = true;
            break;
          } catch (error) {
            lastError = error;
            if (attempts < DELIVERY_MAX_ATTEMPTS && !stopped) {
              await delay(DELIVERY_RETRY_BASE_DELAY_MS * attempts);
            }
          }
        }
        if (!delivered && !stopped) {
          hasFailed = true;
          stopped = true;
          failure = { event, error: lastError, attempts, at: new Date().toISOString() };
          options.onTerminalFailure?.(failure);
        }
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
    getFailure(): DeliveryFailure<T> | undefined {
      return failure;
    },
    stop(): void {
      stopped = true;
      wake?.();
      wake = undefined;
      checkSettled();
    },
    drained(): Promise<void> {
      if (hasFailed) return Promise.reject(failure?.error);
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
