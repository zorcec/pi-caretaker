import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Loopback mock of the Telegram Bot API (ADR-0007), shared by the
 * mocked-Telegram e2e tier (tests/e2e/) and the e2e-local tier
 * (tests/e2e-local/, real Pi speaking grammY over real HTTP). Real HTTP on
 * 127.0.0.1:0 wired through grammY's documented `client.apiRoot` seam — so
 * the REAL grammy client runs against a FAKE Telegram. No network beyond
 * loopback, no new dependencies (a tg-mock sidecar or dockerized Bot API
 * server would both violate the V1 non-goals).
 *
 * Inbound messages are enqueued by the test itself (`enqueueUpdates`), not
 * timed by the mock: the next `getUpdates` poll delivers exactly what the
 * test queued, so ordering is deterministic and no wall-clock wait can
 * flake.
 */

export interface RecordedSend {
  chat_id: unknown;
  text: string;
  reply_parameters?: { message_id?: unknown };
  reply_markup?: unknown;
  disable_notification?: boolean;
}

/** One Bot API call the mock answered, in arrival order. */
export interface RecordedCall {
  method: string;
  body?: Record<string, unknown>;
}

export interface MockTelegram {
  /** Base URL to hand grammY as `client.apiRoot`. */
  url: string;
  /** Every sendMessage body the mock received, in arrival order. */
  sends: RecordedSend[];
  /** Every Bot API method the mock answered, in arrival order. */
  calls: RecordedCall[];
  /** Queue updates for the next getUpdates poll (delivered once, in order). */
  enqueueUpdates(updates: readonly unknown[]): void;
  setNextMessageId(id: number): void;
  failNextReaction(): void;
  failNextSendMessage(): void;
  close(): Promise<void>;
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function json(res: ServerResponse, body: unknown): void {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

/**
 * Minimal Bot API on loopback: getMe validates the token, deleteWebhook
 * answers success, sendMessage records, getUpdates delivers the test's
 * queued updates (empty when nothing is queued). Everything else 404s.
 */
export async function startMockTelegram(): Promise<MockTelegram> {
  const sends: RecordedSend[] = [];
  const calls: RecordedCall[] = [];
  const queued: unknown[] = [];
  let nextMessageId = 1;
  let failReaction = false;
  let failSendMessage = false;
  const server: Server = createServer(async (req, res) => {
    const method = (req.url ?? "").split("/").pop() ?? "";
    const body = method === "getMe" || method === "deleteWebhook" ? undefined : await readJson(req) as Record<string, unknown>;
    calls.push({ method, ...(body === undefined ? {} : { body }) });
    if (method === "getMe") {
      json(res, {
        ok: true,
        result: { id: 1, is_bot: true, first_name: "Caretaker", username: "mock_bot" },
      });
      return;
    }
    if (method === "deleteWebhook") {
      json(res, { ok: true, result: true });
      return;
    }
    if (method === "sendMessage") {
      const sendBody = body as { chat_id?: unknown; text?: unknown; reply_parameters?: { message_id?: unknown }; reply_markup?: unknown; disable_notification?: boolean };
      sends.push({ chat_id: sendBody.chat_id, text: String(sendBody.text ?? ""), ...(sendBody.reply_parameters === undefined ? {} : { reply_parameters: sendBody.reply_parameters }), ...(sendBody.reply_markup === undefined ? {} : { reply_markup: sendBody.reply_markup }), ...(sendBody.disable_notification === undefined ? {} : { disable_notification: sendBody.disable_notification }) });
      if (failSendMessage) {
        failSendMessage = false;
        res.statusCode = 400;
        json(res, { ok: false, error_code: 400, description: "send disabled" });
        return;
      }
      json(res, { ok: true, result: { message_id: nextMessageId } });
      nextMessageId += 1;
      return;
    }
    if (method === "answerCallbackQuery" || method === "editMessageText" || method === "sendChatAction") {
      json(res, { ok: true, result: true });
      return;
    }
    if (method === "setMessageReaction") {
      if (failReaction) {
        failReaction = false;
        res.statusCode = 400;
        json(res, { ok: false, error_code: 400, description: "reaction disabled" });
      } else json(res, { ok: true, result: true });
      return;
    }
    if (method === "getUpdates") {
      const batch = queued.splice(0, queued.length);
      json(res, { ok: true, result: batch });
      return;
    }
    res.statusCode = 404;
    json(res, { ok: false, error_code: 404, description: "Not Found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    sends,
    calls,
    enqueueUpdates(updates: readonly unknown[]): void {
      queued.push(...updates);
    },
    setNextMessageId(id: number): void { nextMessageId = id; },
    failNextReaction(): void { failReaction = true; },
    failNextSendMessage(): void { failSendMessage = true; },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error?: Error) => (error ? reject(error) : resolve())),
      ),
  };
}
