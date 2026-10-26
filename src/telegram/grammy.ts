/**
 * grammY Telegram transport (ADR-0007).
 *
 * A direct grammY `Bot` owned by pi-caretaker — no Pitgram, no relay, no
 * external session store. Long polling runs in-process; only messages from
 * the paired chat id are forwarded, everything else is ignored, never
 * answered (ADR-0002: strangers are untrusted input, and answering them
 * would be a second conversation outside the owned path of ADR-0003).
 *
 * Construction validates the token with `getMe`, so a bad token fails
 * loudly before anything subscribes or polls. Polling starts explicitly
 * via `start()` — after the entry has attached its handler — so no update
 * can arrive before anyone is listening for it.
 */
import { Bot } from "grammy";
import type { TelegramAdapter, TelegramMessageHandler } from "./index.js";

export interface TelegramTransportConfig {
  botToken: string;
  chatId: string;
}

export interface TelegramTransportDeps {
  /**
   * HTTP fetch implementation. Defaults to grammY's (node-fetch under
   * Node). Tests inject a stub here — no global mocking, no network.
   */
  fetch?: typeof fetch;
}

/**
 * Last polling/middleware failure, parsed into a displayable shape at the
 * boundary where it was caught. Callers get a message and a timestamp —
 * never a raw `unknown` they would have to narrow themselves.
 */
export interface TelegramPollingIssue {
  message: string;
  at: string;
}

function describeError(error: unknown): TelegramPollingIssue {
  return {
    message: error instanceof Error ? error.message : String(error),
    at: new Date().toISOString(),
  };
}

export interface ManagedTelegramAdapter extends TelegramAdapter {
  /** Begin long polling (idempotent — a running bot ignores repeats). */
  start(): void;
  /** Stop polling and wait for the runner to settle. */
  stop(): Promise<void>;
  /** Last polling/middleware failure, if any. Undefined when healthy. */
  getLastError(): TelegramPollingIssue | undefined;
}

/**
 * Build the adapter. Rejects on empty config or an invalid token
 * (`getMe` fails) — never returns a transport that cannot work.
 *
 * Pass `deps.fetch` in tests to avoid the network entirely; production
 * omits it and grammY uses its default fetch.
 */
export async function createTelegramAdapter(
  config: TelegramTransportConfig,
  deps?: TelegramTransportDeps,
): Promise<ManagedTelegramAdapter> {
  if (!config.botToken || config.botToken.trim().length === 0) {
    throw new Error("telegram bot token is required");
  }
  if (!config.chatId || config.chatId.trim().length === 0) {
    throw new Error("telegram chat id is required");
  }
  let lastError: TelegramPollingIssue | undefined;
  const trackedFetch: typeof fetch | undefined = deps?.fetch === undefined ? undefined : async (input, init) => {
    try {
      return await deps.fetch!(input, init);
    } catch (error) {
      lastError = describeError(error);
      throw error;
    }
  };
  const bot = new Bot(
    config.botToken,
    trackedFetch !== undefined ? { client: { fetch: trackedFetch } } : {},
  );
  // Validate now: a dead token must fail here, not on the first notify.
  await bot.api.getMe();

  const handlers = new Set<TelegramMessageHandler>();
  bot.on("message:text", (ctx) => {
    if (String(ctx.chat?.id) !== config.chatId) return;
    const text = ctx.message.text;
    for (const handler of [...handlers]) {
      handler(text);
    }
  });
  bot.catch((err) => {
    lastError = describeError(err);
  });
  return {
    async notify(text: string): Promise<void> {
      await bot.api.sendMessage(config.chatId, text);
    },
    onMessage(handler: TelegramMessageHandler): void {
      handlers.add(handler);
    },
    start(): void {
      void bot.start().catch((error: unknown) => {
        lastError = describeError(error);
      });
    },
    async stop(): Promise<void> {
      await bot.stop().catch(() => undefined);
    },
    getLastError(): TelegramPollingIssue | undefined {
      return lastError;
    },
  };
}
