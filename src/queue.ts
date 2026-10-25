/**
 * Bounded in-memory FIFO (ADR-0001).
 *
 * The queue is intentionally NOT crash-durable: a `202` means "queued in
 * memory", and anything unprocessed at restart is lost. Interface and types
 * only — semantics (admission, overflow, sequencing) belong to the queue
 * ticket, not this lane.
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
