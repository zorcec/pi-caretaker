import { expect } from "vitest";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

/**
 * Shared Pi-runtime double for entry and pipeline tests.
 *
 * A fake ExtensionAPI that records registrations, handlers, and submitted
 * turns, plus the helpers to drive a session_start against a real loopback
 * listener. Nothing here needs network, models, or Telegram credentials —
 * port 0 keeps every socket local and ephemeral.
 */
export interface RecordedTurn {
  content: string;
  options: unknown;
}

export interface FakePi {
  api: ExtensionAPI;
  handlers: Map<string, (event: unknown, ctx: ExtensionContext) => unknown>;
  sent: RecordedTurn[];
  tools: Map<string, { execute: (...args: any[]) => Promise<unknown> }>;
  commands: Map<string, { handler: (...args: any[]) => Promise<unknown> }>;
  notifies: { message: string; type: string | undefined }[];
}

export function createFakePi(): FakePi {
  const handlers = new Map();
  const sent: RecordedTurn[] = [];
  const tools = new Map();
  const commands = new Map();
  const notifies: FakePi["notifies"] = [];
  const api = {
    on: (event: string, handler: (event: unknown, ctx: never) => unknown) => {
      handlers.set(event, handler);
      return () => {
        handlers.delete(event);
      };
    },
    sendUserMessage: (content: string, options?: unknown): void => {
      sent.push({ content: String(content), options });
    },
    registerTool: (tool: {
      name: string;
      execute: (...args: any[]) => Promise<unknown>;
    }): void => {
      tools.set(tool.name, tool);
    },
    registerCommand: (
      name: string,
      options: { handler: (...args: any[]) => Promise<unknown> },
    ): void => {
      commands.set(name, options);
    },
  } as unknown as ExtensionAPI;
  return { api, handlers, sent, tools, commands, notifies };
}

export function fakeContext(notifies: FakePi["notifies"]): ExtensionContext {
  return {
    ui: {
      notify: (message: string, type?: "info" | "warning" | "error"): void => {
        notifies.push({ message, type });
      },
    },
    isIdle: () => true,
    cwd: "/tmp/pi-caretaker-test",
  } as unknown as ExtensionContext;
}

/** Snapshot process.env for restoration after the test. */
export function snapshotEnv(): NodeJS.ProcessEnv {
  return { ...process.env };
}

/** Restore a snapshot taken by snapshotEnv (call from afterEach). */
export function restoreEnv(saved: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) delete process.env[key];
  }
  Object.assign(process.env, saved);
}

/** Fill the caretaker env with test values (loopback, port 0, small queue). */
export function testEnv(overrides: Record<string, string> = {}): void {
  delete process.env["PI_CARETAKER_TOKEN"];
  delete process.env["PI_CARETAKER_HOST"];
  delete process.env["PI_CARETAKER_PORT"];
  delete process.env["PI_CARETAKER_ALERTS_QUEUE_CAPACITY"];
  Object.assign(process.env, {
    PI_CARETAKER_TOKEN: "test-token",
    PI_CARETAKER_HOST: "127.0.0.1",
    PI_CARETAKER_PORT: "0",
    PI_CARETAKER_ALERTS_QUEUE_CAPACITY: "16",
    ...overrides,
  });
}

/** Start a session and return the bound loopback port from caretaker-status. */
export async function startedPort(
  fake: FakePi,
  ctx: ExtensionContext,
): Promise<number> {
  await fake.handlers.get("session_start")?.({}, ctx);
  const statusHandler = fake.commands.get("caretaker-status");
  await statusHandler?.handler("", ctx as never);
  const statusLine = fake.notifies.at(-1)?.message ?? "";
  const port = Number(/http:\/\/127\.0\.0\.1:(\d+)/.exec(statusLine)?.[1]);
  expect(port, `status did not report a port: ${statusLine}`).toBeGreaterThan(0);
  return port;
}

export async function postEvent(
  port: number,
  body: unknown,
  token = "test-token",
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token !== "") headers.authorization = `Bearer ${token}`;
  const response = await fetch(`http://127.0.0.1:${port}/events`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

/** Poll until n turns are submitted, failing loudly on timeout. */
/** Poll delivered notifications until n arrive, failing loudly on timeout. */
export async function waitForNotifies(
  delivered: readonly unknown[],
  count: number,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (delivered.length < count) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `timed out waiting for ${count} notification(s), got ${delivered.length}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export async function waitForTurns(
  fake: FakePi,
  count: number,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (fake.sent.length < count) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `timed out waiting for ${count} turn(s), got ${fake.sent.length}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
