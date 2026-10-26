import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Real-Pi harness for the e2e-local tier (tests/e2e-local/).
 *
 * Boots the REAL Pi in RPC mode (`pi --mode rpc --extension ./dist/index.js`)
 * with the real model and the entry's built bundle, then drives it over the
 * documented JSONL protocol: `new_session` at boot, `get_messages` /
 * `get_state` to observe turns. Framing follows docs/rpc.md: strict JSONL,
 * split on LF only (never readline — U+2028/U+2029 are valid inside JSON
 * strings), stdout read continuously, stderr captured for diagnostics and
 * never parsed as protocol.
 *
 * Telegram is mocked out-of-process via the ADR-0007 env seam
 * (`PI_CARETAKER_TELEGRAM_API_ROOT` → tests/setup/telegram-mock.ts), so the
 * only network this touches is loopback plus the real model provider.
 */

/** Model used unless PI_E2E_MODEL overrides it. Confirmed in this Pi's catalog. */
export const DEFAULT_PI_E2E_MODEL = "opencode-go/mimo-v2.6-flash";

/** Dummy loopback bearer token — never a real secret (see SECURITY.md). */
export const E2E_LOCAL_TOKEN = "e2e-local-token";

export interface RpcResponse {
  type: "response";
  command: string;
  success: boolean;
  id?: string;
  error?: string;
  data?: Record<string, unknown>;
}

/** Any stdout record; typed loosely because the stream carries many kinds. */
export interface RpcRecord {
  type?: string;
  id?: string;
  [key: string]: unknown;
}

export interface ModelProbe {
  resolvable: boolean;
  detail: string;
}

/**
 * Ask the installed Pi whether it can resolve the model id. Unresolvable
 * means "No models matching" (pi's own phrasing) — the tier then SKIPS with
 * that detail. Everything else (pi missing, timeout, non-zero exit, protocol
 * garbage) throws: a broken install must fail loudly, never skip quietly.
 */
export function probePiModel(
  modelId: string,
  { timeoutMs = 60_000 }: { timeoutMs?: number } = {},
): Promise<ModelProbe> {
  if (modelId.trim() === "") {
    throw new Error("PI_E2E_MODEL is set but empty — give it a model id or unset it");
  }
  return new Promise((resolveProbe, reject) => {
    execFile(
      "pi",
      ["--list-models", modelId],
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const output = `${stdout}\n${stderr}`.trim();
        if (error !== null && (error as { code?: unknown }).code !== 0) {
          const reason =
            error instanceof Error ? `${error.message}\n${output}` : output;
          reject(new Error(`pi --list-models failed for "${modelId}": ${reason}`));
          return;
        }
        if (output.includes("No models matching")) {
          resolveProbe({ resolvable: false, detail: output });
          return;
        }
        resolveProbe({ resolvable: true, detail: output });
      },
    );
  });
}

/** An ephemeral loopback port, freed before the listener binds it. */
export function freeLoopbackPort(): Promise<number> {
  return new Promise((portPromise, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as AddressInfo;
      probe.close((error?: Error) => (error ? reject(error) : portPromise(port)));
    });
  });
}

export interface RealPiOptions {
  modelId: string;
  /** Listener port the caretaker entry must bind (PI_CARETAKER_PORT). */
  port: number;
  /** Loopback Bot API mock base URL (PI_CARETAKER_TELEGRAM_API_ROOT). */
  telegramApiRoot: string;
  /** Repository root holding dist/index.js. */
  root: string;
}

export interface RealPi {
  /** Fire a command without waiting for its response. */
  send(command: Record<string, unknown> & { id: string }): void;
  /** Send a command and await its correlated response data (bounded). */
  request(
    command: Record<string, unknown> & { type: string },
    { timeoutMs }?: { timeoutMs?: number },
  ): Promise<Record<string, unknown>>;
  /** Every stdout record seen so far, in arrival order. */
  records(): readonly RpcRecord[];
  /** Latest stderr lines — diagnostics only, never protocol. */
  stderrTail(lines?: number): string[];
  /** get_messages data.messages as returned by Pi. */
  messages(): Promise<Record<string, unknown>[]>;
  /** get_state data returned by Pi's documented RPC command. */
  state(): Promise<Record<string, unknown>>;
  /** Graceful-then-forced shutdown; ESRCH-tolerant (stale pid = done). */
  shutdown(): Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

void sleep;

class RealPiProcess implements RealPi {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    string,
    { resolve: (data: Record<string, unknown>) => void; reject: (error: Error) => void }
  >();
  private readonly seen: RpcRecord[] = [];
  private readonly stderrLines: string[] = [];
  private nextId = 1;
  private exited = false;

  constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    let stdoutBuffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8");
      let newline = stdoutBuffer.indexOf("\n");
      while (newline >= 0) {
        const line = stdoutBuffer.slice(0, newline).replace(/\r$/, "");
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (line.trim() !== "") this.handleLine(line);
        newline = stdoutBuffer.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderrLines.push(...chunk.toString("utf8").split("\n").filter((l) => l !== ""));
      if (this.stderrLines.length > 200) this.stderrLines.splice(0, this.stderrLines.length - 200);
    });
    child.on("exit", () => {
      this.exited = true;
      for (const [, waiter] of this.pending) {
        waiter.reject(
          new Error(
            `Pi exited before answering (exit code ${String(child.exitCode)}). ` +
              `stderr tail:\n${this.stderrTail(20).join("\n")}`,
          ),
        );
      }
      this.pending.clear();
    });
  }

  /** Strict JSONL: one unparsable stdout line is protocol drift — loud. */
  private handleLine(line: string): void {
    let record: RpcRecord;
    try {
      record = JSON.parse(line) as RpcRecord;
    } catch {
      throw new Error(`non-JSON stdout line from Pi (protocol drift): ${line.slice(0, 200)}`);
    }
    this.seen.push(record);
    if (record.type === "response" && typeof record.id === "string") {
      const waiter = this.pending.get(record.id);
      if (waiter !== undefined) {
        this.pending.delete(record.id);
        const response = record as unknown as RpcResponse;
        if (response.success) {
          waiter.resolve(response.data ?? {});
        } else {
          waiter.reject(
            new Error(`command ${response.command} failed: ${response.error ?? "unknown error"}`),
          );
        }
      }
    }
  }

  send(command: Record<string, unknown> & { id: string }): void {
    this.child.stdin.write(`${JSON.stringify(command)}\n`);
  }

  request(
    command: Record<string, unknown> & { type: string },
    { timeoutMs = 30_000 }: { timeoutMs?: number } = {},
  ): Promise<Record<string, unknown>> {
    if (this.exited) {
      return Promise.reject(
        new Error(`Pi already exited (code ${String(this.child.exitCode)}); cannot ${command.type}`),
      );
    }
    const id = `e2e-${this.nextId++}`;
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `no response to ${command.type} within ${timeoutMs}ms. ` +
              `stderr tail:\n${this.stderrTail(20).join("\n")}`,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (data) => {
          clearTimeout(timer);
          resolveRequest(data);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.send({ ...command, id });
    });
  }

  records(): readonly RpcRecord[] {
    return this.seen;
  }

  stderrTail(lines = 20): string[] {
    return this.stderrLines.slice(-lines);
  }

  async messages(): Promise<Record<string, unknown>[]> {
    const data = await this.request({ type: "get_messages" });
    const messages = data["messages"];
    if (!Array.isArray(messages)) {
      throw new Error(`get_messages did not return a messages array: ${JSON.stringify(data).slice(0, 300)}`);
    }
    return messages as Record<string, unknown>[];
  }

  async state(): Promise<Record<string, unknown>> {
    return this.request({ type: "get_state" });
  }

  async shutdown(): Promise<void> {
    if (this.exited) return;
    // Orderly first: closing stdin is the documented RPC shutdown request.
    this.child.stdin.end();
    if (await this.waitForExit(10_000)) return;
    if (await this.signalAndWait("SIGTERM", 5_000)) return;
    await this.signalAndWait("SIGKILL", 5_000);
  }

  private waitForExit(timeoutMs: number): Promise<boolean> {
    if (this.exited) return Promise.resolve(true);
    return new Promise((done) => {
      const timer = setTimeout(() => {
        this.child.off("exit", onExit);
        done(false);
      }, timeoutMs);
      const onExit = (): void => {
        clearTimeout(timer);
        done(true);
      };
      this.child.once("exit", onExit);
    });
  }

  /** ESRCH (stale pid — already gone) counts as success, never an error. */
  private async signalAndWait(signal: NodeJS.Signals, timeoutMs: number): Promise<boolean> {
    try {
      this.child.kill(signal);
    } catch (error) {
      if ((error as { code?: string }).code === "ESRCH") return true;
      throw error;
    }
    return this.waitForExit(timeoutMs);
  }
}

/**
 * Boot the real Pi for one test file: spawn in RPC mode with the built
 * extension, send new_session, and hand back the protocol client. The
 * caller polls /health (scripts/start.mjs waitForHealth) before trusting
 * the listener, so boot failures surface with stderr attached.
 */
export function bootRealPi(options: RealPiOptions): RealPi {
  const bundle = resolve(options.root, "dist/index.js");
  if (!existsSync(bundle)) {
    throw new Error(`dist/index.js missing — run \`pnpm build\` before test:e2e-local (expected at ${bundle})`);
  }
  const child = spawn(
    "pi",
    [
      "--mode",
      "rpc",
      "--model",
      options.modelId,
      "--name",
      "caretaker-e2e-local",
      // Real entry, real model — but a hermetic session: no repo context
      // files, no skills, no MCP, no discovery of other extensions (the
      // explicit -e path still loads), no session files on disk, and no
      // built-in coding tools (triage needs only caretaker_notify).
      "--extension",
      "./dist/index.js",
      "--no-session",
      "--no-context-files",
      "--no-skills",
      "--no-mcp",
      "--no-extensions",
      "--no-builtin-tools",
    ],
    {
      cwd: options.root,
      env: {
        ...process.env,
        PI_CARETAKER_TOKEN: E2E_LOCAL_TOKEN,
        PI_CARETAKER_HOST: "127.0.0.1",
        PI_CARETAKER_PORT: String(options.port),
        PI_CARETAKER_TELEGRAM_BOT_TOKEN: "TEST:token",
        PI_CARETAKER_TELEGRAM_CHAT_ID: "42",
        PI_CARETAKER_TELEGRAM_API_ROOT: options.telegramApiRoot,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  ) as ChildProcessWithoutNullStreams;
  const pi = new RealPiProcess(child);
  // Same boot input as scripts/start.mjs: the session must exist before
  // the entry's session_start fires and the listener opens.
  pi.send({ id: "boot", type: "new_session" });
  return pi;
}
