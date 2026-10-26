import { afterEach, describe, expect, it } from "vitest";
import { request as httpRequest } from "node:http";
import { createEventQueue, startDelivery } from "../../src/queue.js";
import { createWebhookListener } from "../../src/listener.js";
import {
  MAX_EVENT_BODY_BYTES,
  type EventEnvelope,
} from "../../src/events.js";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Tier 3 — webhook listener e2e over a real HTTP socket.
 *
 * Every case boots createWebhookListener on loopback port 0 with a real
 * queue and asserts on real status codes and real queue contents: a 202
 * means the envelope is observable in the queue, and no malformed,
 * unauthorized, oversized, or over-capacity input ever gets one (ADR-0001).
 * Auth is checked before parsing (ADR-0002, SECURITY.md): malformed JSON
 * with a bad token is 401, never 400.
 */
const TOKEN = "test-bearer-token";

interface RunningServer {
  baseUrl: string;
  queueSize: () => number;
  queuedBodies: () => unknown[];
}

let server: Server | undefined;
let queueSize = () => 0;
let queuedBodies = (): unknown[] => [];

afterEach(async () => {
  if (server) {
    // Destroy keep-alive sockets first: close() alone waits for idle
    // connections, which made the suite hang for seconds per file.
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error ? reject(error) : resolve()));
    });
    server = undefined;
  }
});

async function listen(capacity = 16): Promise<RunningServer> {
  const queue = createEventQueue<EventEnvelope>({
    capacity: capacity as number,
  });
  return listenOn(queue);
}

async function listenOn(
  queue: ReturnType<typeof createEventQueue<EventEnvelope>>,
): Promise<RunningServer> {
  server = createWebhookListener({
    token: TOKEN,
    version: "9.9.9-test",
    queue,
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const { port } = server?.address() as AddressInfo;
  queueSize = () => queue.size;
  queuedBodies = () => {
    const bodies: unknown[] = [];
    let event = queue.dequeue();
    while (event !== undefined) {
      bodies.push(event.body);
      event = queue.dequeue();
    }
    return bodies;
  };
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    queueSize: () => queue.size,
    queuedBodies,
  };
}

async function postEvents(
  baseUrl: string,
  body: string,
  // undefined omits the auth header entirely; every other value is sent verbatim.
  token: string | undefined,
  // null omits the content-type header; undefined (or omission) defaults to JSON.
  contentType: string | null | undefined = "application/json",
): Promise<{ status: number; json: unknown; allow: string | null }> {
  const headers: Record<string, string> = {};
  if (contentType !== null && contentType !== undefined) {
    headers["content-type"] = contentType;
  } else if (contentType === undefined) {
    headers["content-type"] = "application/json";
  }
  if (token !== undefined) headers.authorization = token;
  const response = await fetch(`${baseUrl}/events`, {
    method: "POST",
    headers,
    body,
  });
  return {
    status: response.status,
    json: await response.json(),
    allow: response.headers.get("allow"),
  };
}

describe("webhook listener (POST /events, GET /health)", () => {
  it("returns 503 after delivery failure but accepts the first event and a healthy listener", async () => {
    const failedQueue = createEventQueue<EventEnvelope>({ capacity: 4 });
    let releaseFailure!: () => void;
    const failureTrigger = new Promise<void>((resolve) => { releaseFailure = resolve; });
    const pump = startDelivery(failedQueue, async () => {
      releaseFailure();
      throw new Error("consumer failed");
    });
    server = createWebhookListener({
      token: TOKEN,
      version: "9.9.9-test",
      queue: failedQueue,
      isOperational: () => !pump.hasFailed(),
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const { port } = server?.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}`;
    const first = await postEvents(url, JSON.stringify({ message: "first" }), `Bearer ${TOKEN}`);
    expect(first.status).toBe(202);
    await failureTrigger;
    await expect(pump.drained()).rejects.toThrow("consumer failed");
    const rejected = await postEvents(url, JSON.stringify({ message: "second" }), `Bearer ${TOKEN}`);
    expect(rejected.status).toBe(503);
    expect(rejected.json).toEqual({ error: "delivery failed; restart required" });

    server.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = createWebhookListener({ token: TOKEN, version: "9.9.9-test", queue: createEventQueue<EventEnvelope>({ capacity: 4 }) });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const healthyPort = (server?.address() as AddressInfo).port;
    const healthy = await postEvents(`http://127.0.0.1:${healthyPort}`, JSON.stringify({ message: "healthy" }), `Bearer ${TOKEN}`);
    expect(healthy.status).toBe(202);
  });
  it("refuses to construct with a blank token — no open listener by misconfiguration", () => {
    const queue = createEventQueue<EventEnvelope>({ capacity: 1 });

    expect(() =>
      createWebhookListener({ token: "", version: "x", queue }),
    ).toThrow(/non-empty bearer token/);
  });

  it("rejects a missing or non-JSON content type with 415 before reading the body", async () => {
    const { baseUrl } = await listen();
    const body = JSON.stringify({ message: "x" });

    for (const contentType of [null, "text/plain", "text/html"]) {
      const { status, json } = await postEvents(
        baseUrl,
        body,
        `Bearer ${TOKEN}`,
        contentType,
      );
      expect(status).toBe(415);
      expect(json).toEqual({
        error: "content-type must be application/json",
      });
    }
    // A charset suffix is still JSON.
    const { status } = await postEvents(
      baseUrl,
      body,
      `Bearer ${TOKEN}`,
      "application/json; charset=utf-8",
    );
    expect(status).toBe(202);
    expect(queueSize()).toBe(1);
  });

  it("rejects a chunked body that exceeds the cap mid-stream with 413", async () => {
    const running = await listen(16);
    const oversized = `{"message":"${"z".repeat(MAX_EVENT_BODY_BYTES)}"}`;

    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        `${running.baseUrl}/events`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${TOKEN}`,
            "content-type": "application/json",
            "transfer-encoding": "chunked",
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        },
      );
      req.on("error", reject);
      // Stream in small pieces with no content-length: the server must stop
      // reading once the observed total passes the cap.
      const chunk = oversized.slice(0, 1024);
      let sent = 0;
      const timer = setInterval(() => {
        sent += chunk.length;
        if (sent >= oversized.length) {
          clearInterval(timer);
          req.end(oversized.slice(sent - chunk.length));
          return;
        }
        if (!req.write(chunk)) {
          clearInterval(timer);
          req.end();
        }
      }, 1);
    });

    expect(status).toBe(413);
    expect(running.queueSize()).toBe(0);
  });

  it("GET /health answers exactly {status, version, commit}", async () => {
    const { baseUrl } = await listen();

    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      version: "9.9.9-test",
      commit: expect.any(String),
    });
    expect(queueSize()).toBe(0);
  });

  it("rejects a missing, wrong, or malformed token with 401 and enqueues nothing", async () => {
    const { baseUrl } = await listen();

    for (const token of [
      undefined,
      "Bearer wrong-token",
      "Bearer ",
      "Token abc",
      "",
    ]) {
      const { status } = await postEvents(
        baseUrl,
        '{"message":"hello"}',
        token,
      );
      expect(status).toBe(401);
    }
    expect(queueSize()).toBe(0);
  });

  it("checks auth before parsing: malformed JSON with a bad token is 401, not 400", async () => {
    const { baseUrl } = await listen();

    const { status } = await postEvents(baseUrl, "{not json", "Bearer wrong");

    expect(status).toBe(401);
    expect(queueSize()).toBe(0);
  });

  it("rejects a body one byte over the 64 KiB cap with 413", async () => {
    const { baseUrl } = await listen();
    const fill = "x".repeat(MAX_EVENT_BODY_BYTES - 14 + 1);
    const oversized = `{"message":"${fill}"}`;
    expect(Buffer.byteLength(oversized)).toBeGreaterThan(MAX_EVENT_BODY_BYTES);

    const { status } = await postEvents(baseUrl, oversized, `Bearer ${TOKEN}`);

    expect(status).toBe(413);
    expect(queueSize()).toBe(0);
  });

  it("admits a body of exactly the 64 KiB cap", async () => {
    const { baseUrl } = await listen();
    const fill = "x".repeat(MAX_EVENT_BODY_BYTES - 14);
    const exact = `{"message":"${fill}"}`;
    expect(Buffer.byteLength(exact)).toBe(MAX_EVENT_BODY_BYTES);

    const { status, json } = await postEvents(baseUrl, exact, `Bearer ${TOKEN}`);

    expect(status).toBe(202);
    expect(json).toEqual({ queued: true });
  });

  it("rejects invalid JSON, a missing message, and an unknown severity with 400", async () => {
    const { baseUrl } = await listen();

    for (const body of [
      "{not json",
      '{"host":"server-b"}',
      '{"message":""}',
      '{"message":"x","severity":"urgent"}',
    ]) {
      const { status } = await postEvents(baseUrl, body, `Bearer ${TOKEN}`);
      expect(status).toBe(400);
    }
    expect(queueSize()).toBe(0);
  });

  it("answers 202 with {queued:true} only for an admitted event, observable in the queue", async () => {
    const running = await listen();

    const { status, json } = await postEvents(
      running.baseUrl,
      JSON.stringify({ message: "Memory usage reached 92%", host: "server-b" }),
      `Bearer ${TOKEN}`,
    );

    expect(status).toBe(202);
    expect(json).toEqual({ queued: true });
    expect(running.queueSize()).toBe(1);
    expect(running.queuedBodies()).toEqual([
      expect.objectContaining({ message: "Memory usage reached 92%" }),
    ]);
  });

  it("answers 503 when the queue is full — never a fake 202", async () => {
    const running = await listen(1);
    const first = await postEvents(
      running.baseUrl,
      JSON.stringify({ message: "first" }),
      `Bearer ${TOKEN}`,
    );
    expect(first.status).toBe(202);

    const { status, json } = await postEvents(
      running.baseUrl,
      JSON.stringify({ message: "second" }),
      `Bearer ${TOKEN}`,
    );

    expect(status).toBe(503);
    expect(json).toEqual({
      error: expect.any(String),
    });
    expect(running.queueSize()).toBe(1);
  });

  it("answers 500 without crashing when the queue itself throws", async () => {
    const queue = createEventQueue<EventEnvelope>({ capacity: 16 });
    queue.enqueue = () => {
      throw new Error("storage gone");
    };
    const running = await listenOn(queue);

    const { status, json } = await postEvents(
      running.baseUrl,
      JSON.stringify({ message: "x" }),
      `Bearer ${TOKEN}`,
    );

    expect(status).toBe(500);
    expect(json).toEqual({ error: "internal error" });
    // The server survives a throwing dependency: health still answers.
    const health = await fetch(`${running.baseUrl}/health`);
    expect(health.status).toBe(200);
  });

  it("answers 405 with Allow for a wrong method and 404 for an unknown route", async () => {
    const { baseUrl } = await listen();

    const putEvents = await fetch(`${baseUrl}/events`, { method: "PUT" });
    expect(putEvents.status).toBe(405);
    expect(putEvents.headers.get("allow")).toContain("POST");

    const postHealth = await fetch(`${baseUrl}/health`, { method: "POST" });
    expect(postHealth.status).toBe(405);
    expect(postHealth.headers.get("allow")).toContain("GET");

    const unknown = await fetch(`${baseUrl}/nope`);
    expect(unknown.status).toBe(404);
    expect(queueSize()).toBe(0);
  });

  it("invariant: no malformed, unauthorized, oversized, or over-capacity input ever receives 202", async () => {
    const running = await listen(1);
    const cases: { body: string; token?: string }[] = [
      { body: "{broken", token: undefined },
      { body: '{"message":"x"}', token: "Bearer wrong" },
      { body: `{"message":"${"y".repeat(MAX_EVENT_BODY_BYTES)}"}` },
      { body: '{"message":"'} ,
      { body: '{"message":"x","severity":"nope"}' },
    ];
    // Fill the capacity-1 queue, then prove even a VALID envelope is refused.
    const admitted = await postEvents(
      running.baseUrl,
      JSON.stringify({ message: "legit" }),
      `Bearer ${TOKEN}`,
    );
    expect(admitted.status).toBe(202);
    cases.push({
      body: JSON.stringify({ message: "valid but full" }),
      token: `Bearer ${TOKEN}`,
    });

    for (const { body, token } of cases) {
      const { status } = await postEvents(running.baseUrl, body, token);
      expect(status).not.toBe(202);
    }
    expect(running.queueSize()).toBe(1);
  });
});
