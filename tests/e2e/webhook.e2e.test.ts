import { afterEach, describe, expect, it } from "vitest";
import { createEventQueue } from "../../src/queue.js";
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

function authHeaders(token: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token !== undefined) headers.authorization = token;
  return headers;
}

async function postEvents(
  baseUrl: string,
  body: string,
  // undefined omits the header entirely; every other value is sent verbatim.
  token: string | undefined,
): Promise<{ status: number; json: unknown; allow: string | null }> {
  const response = await fetch(`${baseUrl}/events`, {
    method: "POST",
    headers: authHeaders(token),
    body,
  });
  return {
    status: response.status,
    json: await response.json(),
    allow: response.headers.get("allow"),
  };
}

describe("webhook listener (POST /events, GET /health)", () => {
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
