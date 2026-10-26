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
