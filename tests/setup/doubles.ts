/**
 * Recording doubles for the two services the caretaker depends on.
 *
 * Tier 4 e2e tests assert against the *recorded call list*, never against
 * internal state of a fake — a fake asserting on itself is tautological. Every
 * double therefore exposes an append-only `calls` array plus the production
 * interface, so a test can only ever ask "did the real code path reach here?".
 *
 * The LLM double is a stub, not a mock framework: triage prompts are built by
 * this repo and the response is the only thing an e2e test needs to control.
 */
import type {
  TelegramAdapter,
  TelegramMessageHandler,
} from "../../src/telegram/index.js";

/** One outbound Telegram message, in arrival order. */
export interface RecordedNotify {
  text: string;
  at: number;
}

export interface RecordingTelegram extends TelegramAdapter {
  /** Append-only log of every `notify()` the code under test performed. */
  readonly notifies: RecordedNotify[];
  /** Total inbound messages seen through `onMessage`. */
  readonly received: string[];
  /** Deliver a message as if the user typed it in Telegram. */
  deliver(text: string): void;
  /** True until `onMessage` was called — a second handler is a red flag. */
  hasHandler(): boolean;
}

/**
 * A Telegram adapter that sends nothing and remembers everything. Silence is
 * observable: ADR-0003's "background turns never relay output" is asserted as
 * `notifies.length === 0`.
 */
export function createRecordingTelegram(): RecordingTelegram {
  const notifies: RecordedNotify[] = [];
  const received: string[] = [];
  let handler: TelegramMessageHandler | undefined;

  return {
    notifies,
    received,
    async notify(text: string): Promise<void> {
      notifies.push({ text, at: Date.now() });
    },
    onMessage(h: TelegramMessageHandler): void {
      if (handler) {
        throw new Error(
          "a second Telegram message handler was registered — ADR-0003 allows exactly one",
        );
      }
      handler = h;
    },
    deliver(text: string): void {
      if (!handler) {
        throw new Error("deliver() called before onMessage() registered a handler");
      }
      received.push(text);
      handler(text);
    },
    hasHandler(): boolean {
      return handler !== undefined;
    },
  };
}

/** The shape a triage turn must produce: respond, and maybe notify. */
export interface TriageDecision {
  /** True when the model judged the event worth the owner's attention. */
  notify: boolean;
  /** Candidate notification text; ignored when `notify` is false. */
  text?: string;
}

export interface StubTriageLlm {
  /** What the stub answers, in call order (last entry repeats). */
  readonly requests: unknown[];
  readonly decision: TriageDecision;
  triage(request: unknown): Promise<TriageDecision>;
}

/**
 * A deterministic triage model. `notify: false` is the default because
 * silence is the product promise — an e2e test that forgets to configure the
 * stub must get silence, not an accidental notification.
 */
export function createStubTriageLlm(
  decision: TriageDecision = { notify: false },
): StubTriageLlm {
  const requests: unknown[] = [];
  return {
    requests,
    decision,
    async triage(request: unknown): Promise<TriageDecision> {
      requests.push(request);
      return decision;
    },
  };
}
