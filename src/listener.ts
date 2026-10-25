/**
 * Authenticated webhook listener (ADR-0001, ADR-0002).
 *
 * Native node:http only — no web framework. Routes exactly GET /health and
 * POST /events; every other path is 404 and every wrong method is 405 with
 * an Allow header. Security order per request: route, then method, then
 * bearer token, then the streamed body cap, then JSON/schema admission.
 * Error bodies stay generic strings; statuses are the contract. No token
 * or payload text is ever logged or echoed.
 */
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  handlePostEvents,
  MAX_EVENT_BODY_BYTES,
  type EventEnvelope,
} from "./events.js";
import type { EventQueue } from "./queue.js";
import { getHealth } from "./health.js";

export interface WebhookListenerOptions {
  /** Bearer token POST /events must present. Must be non-empty. */
  token: string;
  /** Version reported by GET /health (the entry supplies its own). */
  version: string;
  /** Queue admitted envelopes enter; full maps to 503, never 202. */
  queue: EventQueue<EventEnvelope>;
}

/** Health payload keys — exactly these three, nothing more. */
const HEALTH_KEYS = ["status", "version", "commit"] as const;

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  response.end(text);
}

function notFound(response: ServerResponse): void {
  sendJson(response, 404, { error: "unknown route" });
}

function methodNotAllowed(response: ServerResponse, allow: string): void {
  response.setHeader("allow", allow);
  sendJson(response, 405, { error: `method not allowed; use ${allow}` });
}

/**
 * Read the request body up to the byte cap. Resolves undefined when the
 * declared or observed size exceeds the cap — the remainder is drained so
 * the socket stays usable, and nothing is buffered beyond the limit.
 */
function readCappedBody(request: IncomingMessage): Promise<Buffer | undefined> {
  const declared = Number(request.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_EVENT_BODY_BYTES) {
    request.resume();
    return Promise.resolve(undefined);
  }
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    const finish = (body: Buffer | undefined): void => {
      if (!done) {
        done = true;
        resolve(body);
      }
    };
    request.on("data", (chunk: Buffer) => {
      if (done) return;
      total += chunk.length;
      if (total > MAX_EVENT_BODY_BYTES) {
        request.resume();
        finish(undefined);
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => finish(Buffer.concat(chunks)));
    request.on("error", () => finish(Buffer.concat(chunks)));
  });
}

/**
 * Create the webhook HTTP server. It starts unbound — the caller (future
 * activation ticket) owns listen/close. A blank token throws at
 * construction: an open listener must never start by misconfiguration.
 */
export function createWebhookListener(
  options: WebhookListenerOptions,
): Server {
  const { token, version, queue } = options;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("webhook listener requires a non-empty bearer token");
  }
  return createServer((request, response) => {
    void handleRequest(request, response, token, version, queue).catch(() => {
      if (!response.headersSent) {
        sendJson(response, 500, { error: "internal error" });
      }
    });
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  token: string,
  version: string,
  queue: EventQueue<EventEnvelope>,
): Promise<void> {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;

  if (pathname === "/health") {
    if (request.method !== "GET") {
      methodNotAllowed(response, "GET");
      return;
    }
    const report = getHealth(version);
    // Exact-shape guarantee: only the three contract keys leave this server.
    const body: Record<string, string> = {};
    for (const key of HEALTH_KEYS) body[key] = report[key];
    sendJson(response, 200, body);
    return;
  }

  if (pathname === "/events") {
    if (request.method !== "POST") {
      methodNotAllowed(response, "POST");
      return;
    }
    const authorization = request.headers.authorization;
    // Content-Type enforcement (owner decision 2026-10-25): this endpoint
    // only speaks JSON. Checked after auth (no parsing happens here) and
    // before buffering a single byte, so a wrong-type body costs nothing.
    const contentType = request.headers["content-type"];
    if (
      typeof contentType !== "string" ||
      !contentType.split(";")[0]?.trim().toLowerCase().startsWith("application/json")
    ) {
      sendJson(response, 415, {
        error: "content-type must be application/json",
      });
      request.resume();
      return;
    }
    const rawBody = await readCappedBody(request);
    if (rawBody === undefined) {
      sendJson(response, 413, {
        error: "request body exceeds the 64 KiB limit",
      });
      return;
    }
    const result = handlePostEvents(
      { headers: { authorization }, rawBody },
      token,
      queue,
    );
    if (result.status === 202) {
      sendJson(response, 202, { queued: true });
      return;
    }
    sendJson(response, result.status, { error: result.error });
    return;
  }

  notFound(response);
}
