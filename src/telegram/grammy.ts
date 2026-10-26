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
import type { InlineKeyboardMarkup } from "grammy/types";
import type { TelegramAdapter, TelegramMessageHandler } from "./index.js";

export interface TelegramTransportConfig {
  botToken: string;
  chatId: string;
}

export interface TelegramTransportDeps {
  /**
   * HTTP fetch implementation. Defaults to grammY's (node-fetch under
   * Node). Unit tests inject a stub here — no global mocking, no network.
   */
  fetch?: typeof fetch;
  /**
   * Base URL of the Bot API. Defaults to grammY's
   * (https://api.telegram.org). E2e tests point it at a loopback mock
   * server — grammY's documented apiRoot pattern — so the real client
   * speaks real HTTP to a fake Telegram. Never set in production.
   */
  apiRoot?: string;
}

/**
 * Resolve the deps the factory passes to createTelegramAdapter.
 *
 * When Pi loads the built bundle out of process, the extension factory
 * receives no deps object — so the e2e-local tier (tests/e2e-local/, real
 * Pi + mocked Telegram) injects grammY's apiRoot through the
 * PI_CARETAKER_TELEGRAM_API_ROOT env var instead. Explicit in-process deps
 * always win; an empty or absent env value changes nothing. Test seam
 * only — never set in production, where the default stays the real
 * api.telegram.org.
 */
export function resolveTelegramDeps(
  deps: TelegramTransportDeps | undefined,
  env: NodeJS.ProcessEnv,
): TelegramTransportDeps | undefined {
  if (deps !== undefined) return deps;
  const apiRoot = env["PI_CARETAKER_TELEGRAM_API_ROOT"];
  if (apiRoot === undefined || apiRoot === "") return undefined;
  return { apiRoot };
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
  onPairedMessage(handler: (text: string, messageId: number) => void): void;
  onCommand(name: "stop" | "compact" | "thinking" | "model", handler: (messageId: number) => void): void;
  onCommandCallback(handler: (data: string, messageId: number) => void): void;
  react(messageId: number, emoji: "👀"): Promise<void>;
  sendChatAction(action: "typing"): Promise<void>;
  sendMessage(text: string, replyToMessageId?: number, replyMarkup?: InlineKeyboardMarkup, options?: { disable_notification?: boolean }): Promise<number>;
  editMessageText(messageId: number, text: string): Promise<void>;
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
  const bot = new Bot(config.botToken, {
    client: {
      ...(trackedFetch !== undefined ? { fetch: trackedFetch } : {}),
      ...(deps?.apiRoot !== undefined ? { apiRoot: deps.apiRoot } : {}),
    },
  });
  // Validate now: a dead token must fail here, not on the first notify.
  await bot.api.getMe();

  const handlers = new Set<TelegramMessageHandler>();
  const pairedHandlers = new Set<(text: string, messageId: number) => void>();
  const commandHandlers = new Map<string, Set<(messageId: number) => void>>();
  const commandCallbackHandlers = new Set<(data: string, messageId: number) => void>();
  const liveness = async (label: string, operation: () => Promise<unknown>): Promise<unknown> => {
    try { return await operation(); } catch (error) {
      console.error(`[pi-caretaker] telegram liveness-${label}-failed error=${String(error).replace(/[\\r\\n]+/g, " ").replace(/\\b\\d{6,}:[A-Za-z0-9_-]{20,}\\b/g, "[REDACTED]")}`);
      return undefined;
    }
  };
  for (const command of ["stop", "compact", "thinking", "model"] as const) {
    bot.command(command, async (ctx, next) => {
      if (String(ctx.chat?.id) !== config.chatId) return;
      for (const handler of commandHandlers.get(command) ?? []) handler(ctx.msg.message_id);
      await next();
    });
  }
  bot.on("callback_query:data", async (ctx) => {
    const callback = ctx.callbackQuery;
    if (String(callback.message?.chat.id) !== config.chatId) return;
    try {
      await bot.api.answerCallbackQuery(callback.id);
    } catch (error) {
      console.error(`[pi-caretaker] telegram callback-ack-failed error=${String(error).replace(/[\\r\\n]+/g, " ").replace(/\\b\\d{6,}:[A-Za-z0-9_-]{20,}\\b/g, "[REDACTED]")}`);
    }
    const messageId = callback.message?.message_id;
    if (typeof messageId !== "number") return;
    for (const handler of [...commandCallbackHandlers]) handler(callback.data, messageId);
  });
  const nonTextAcknowledgment = "pi-caretaker accepts text messages only — send text.";
  bot.on("message", async (ctx) => {
    const chatMatch = String(ctx.chat?.id) === config.chatId;
    const text = typeof ctx.message.text === "string"
      ? ctx.message.text
      : typeof ctx.message.caption === "string" ? ctx.message.caption : undefined;
    console.error(
      `[pi-caretaker] telegram received chatMatch=${chatMatch} textLength=${text?.length ?? 0}`,
    );
    if (!chatMatch) {
      console.error("[pi-caretaker] telegram dropped reason=chat_mismatch");
      return;
    }
    if (text !== undefined && /^\/(?:stop|compact|thinking|model)(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(text)) return;
    if (text === undefined) {
      console.error("[pi-caretaker] telegram non-text acknowledged");
      try {
        await bot.api.sendMessage(config.chatId, nonTextAcknowledgment);
      } catch (error) {
        lastError = describeError(error);
      }
      return;
    }
    if (typeof ctx.message.message_id === "number") {
      for (const handler of [...pairedHandlers]) handler(text, ctx.message.message_id);
    }
    for (const handler of [...handlers]) handler(text);
  });
  bot.catch((err) => {
    lastError = describeError(err);
  });
  return {
    async notify(text: string): Promise<void> {
      await bot.api.sendMessage(config.chatId, text);
    },
    onMessage(handler: TelegramMessageHandler): void { handlers.add(handler); },
    onPairedMessage(handler): void { pairedHandlers.add(handler); },
    onCommand(name, handler): void {
      const registered = commandHandlers.get(name) ?? new Set<(messageId: number) => void>();
      registered.add(handler);
      commandHandlers.set(name, registered);
    },
    onCommandCallback(handler): void { commandCallbackHandlers.add(handler); },
    async react(messageId, emoji): Promise<void> { await liveness("reaction", () => bot.api.setMessageReaction(config.chatId, messageId, [{ type: "emoji", emoji }])); },
    async sendChatAction(action): Promise<void> { await liveness("typing", () => bot.api.sendChatAction(config.chatId, action)); },
    async sendMessage(text, replyToMessageId, replyMarkup, options): Promise<number> {
      const result = await liveness("send", () => bot.api.sendMessage(config.chatId, text, {
        ...(replyToMessageId === undefined ? {} : { reply_parameters: { message_id: replyToMessageId } }),
        ...(replyMarkup === undefined ? {} : { reply_markup: replyMarkup }),
        ...(options?.disable_notification === true ? { disable_notification: true } : {}),
      }));
      return typeof result === "object" && result !== null && "message_id" in result ? Number(result.message_id) : 0;
    },
    async editMessageText(messageId, text): Promise<void> { await liveness("edit", () => bot.api.editMessageText(config.chatId, messageId, text)); },
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
