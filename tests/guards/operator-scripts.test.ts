import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { chmodSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildRpcBootInput,
  parseSecretsEnv,
  parseSupervisorLine,
  portIsFree,
  resolveStartConfig,
  waitForFirstLine,
  waitForHealth,
  waitForPortFree,
} from "../../scripts/start.mjs";
import { parsePidFile, resolveStopPlan, stopPreviousInstance } from "../../scripts/stop.mjs";
import {
  buildAlertPayload,
  DEFAULT_ALERT_MESSAGE,
  formatAlertOutcome,
  parseAlertMessage,
  resolveAlertConfig,
} from "../../scripts/send-alert.mjs";
import {
  createRepoFixture,
  type RepoFixture,
} from "../setup/repo-fixture.js";
import { REPO_ROOT } from "../setup/repo-fixture.js";
import { startLoopbackServer } from "../setup/loopback-server.js";

/**
 * Operator CLIs (`pnpm start`, `pnpm send:alert`) are executables, so each
 * behavior is proven twice, like the other guard scripts: unit tests pin
 * the pure decision functions in-process, and child-process runs against
 * scratch fixtures prove exit codes and the human-readable messages.
 *
 * Fixture copies (not the real repo scripts) run as children, so the real
 * repo-root secrets.env can never leak into a case or flip one. The
 * loopback HTTP server runs on a worker thread: serving from the test
 * thread would deadlock against spawnSync, which blocks the event loop
 * while the CLI child waits for a response.
 */

let active: RepoFixture | undefined;

afterEach(() => {
  active?.dispose();
  active = undefined;
});

function scriptFixture(): RepoFixture {
  const fixture = createRepoFixture();
  active = fixture;
  for (const name of ["start.mjs", "stop.mjs", "send-alert.mjs"]) {
    fixture.write(
      `scripts/${name}`,
      readFileSync(join(REPO_ROOT, "scripts", name), "utf8"),
    );
  }
  return fixture;
}

/** Env with the caretaker token provably absent (empty beats any ambient value). */
function noTokenEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...extra, PI_CARETAKER_TOKEN: "" };
}

function installFakePi(fixture: RepoFixture): string {
  const script = fixture.write(
    "bin/pi",
    `#!/usr/bin/env node
const fs = require("node:fs");
const http = require("node:http");
const readline = require("node:readline");
if (process.env.PI_CARETAKER_TEST_STARTED) {
  fs.writeFileSync(process.env.PI_CARETAKER_TEST_STARTED, "started");
}
readline.createInterface({ input: process.stdin }).once("line", () => {
  http.createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{\\"status\\":\\"ok\\"}");
    } else {
      response.writeHead(404).end();
    }
  }).listen(Number(process.env.PI_CARETAKER_PORT), process.env.PI_CARETAKER_HOST || "127.0.0.1");
});
`,
  );
  chmodSync(script, 0o755);
  return `${join(fixture.root, "bin")}${delimiter}${process.env.PATH ?? ""}`;
}

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("missing loopback port");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function spawnSleeper(): Promise<{
  pid: number;
  exited: Promise<void>;
}> {
  const child = spawn("sleep", ["60"], { stdio: "ignore" });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  if (child.pid === undefined) throw new Error("sleep did not expose its PID after spawn");
  return { pid: child.pid, exited };
}

describe("parseSecretsEnv", () => {
  it("parses KEY=VALUE lines and skips blanks, comments, and malformed lines", () => {
    expect(
      parseSecretsEnv(
        "# comment\n\nA=1\nB = spaced \nMALFORMED\n=novalue\nC=a=b\n",
      ),
    ).toEqual({ A: "1", B: "spaced", C: "a=b" });
  });

  it("parses empty input to no variables", () => {
    expect(parseSecretsEnv("")).toEqual({});
  });
});

describe("supervisor protocol", () => {
  it("parses PID and ERROR lines and rejects protocol noise", () => {
    expect(parseSupervisorLine("PID:123\n")).toEqual({ kind: "pid", pid: 123 });
    expect(parseSupervisorLine("ERROR:Could not start Pi")).toEqual({
      kind: "error",
      message: "Could not start Pi",
    });
    expect(parseSupervisorLine("garbage")).toBeNull();
  });

  it("reads a line split across chunks and ignores later lines", async () => {
    const stream = new EventEmitter();
    let timerCleared: unknown;
    const pending = waitForFirstLine(stream, {
      setTimeoutFn: () => "timer-handle",
      clearTimeoutFn: (timer) => {
        timerCleared = timer;
      },
    });
    stream.emit("data", Buffer.from("PID:12"));
    stream.emit("data", Buffer.from("3\nignored\n"));

    await expect(pending).resolves.toBe("PID:123");
    expect(timerCleared).toBe("timer-handle");
  });

  it("returns null when its injected timer expires", async () => {
    const stream = new EventEmitter();
    let expire: (() => void) | undefined;
    let timeoutMs: number | undefined;
    let timerCleared: unknown;
    const pending = waitForFirstLine(stream, {
      timeoutMs: 321,
      setTimeoutFn: (callback, ms) => {
        expire = callback;
        timeoutMs = ms;
        return "timer-handle";
      },
      clearTimeoutFn: (timer) => {
        timerCleared = timer;
      },
    });

    expect(timeoutMs).toBe(321);
    expect(expire).toBeTypeOf("function");
    expire?.();
    await expect(pending).resolves.toBeNull();
    expect(timerCleared).toBe("timer-handle");
    expect(stream.listenerCount("data")).toBe(0);
  });
});

describe("portIsFree", () => {
  it("reports an accepting listener as busy without retrying", async () => {
    let calls = 0;
    const connect = (options: { host: string; port: number }) => {
      expect(options).toEqual({ host: "127.0.0.1", port: 8787 });
      calls += 1;
      const socket = new EventEmitter() as EventEmitter & {
        setTimeout: (timeoutMs: number, callback: () => void) => void;
        destroy: () => void;
      };
      socket.setTimeout = (timeoutMs) => {
        expect(timeoutMs).toBe(500);
      };
      socket.destroy = () => undefined;
      queueMicrotask(() => socket.emit("connect"));
      return socket;
    };

    await expect(
      portIsFree("127.0.0.1", 8787, { connect, retryDelayMs: 0 }),
    ).resolves.toBe(false);
    expect(calls).toBe(1);
  });

  it("confirms a refused port with one retry", async () => {
    let calls = 0;
    const connect = (options: { host: string; port: number }) => {
      expect(options).toEqual({ host: "127.0.0.1", port: 8787 });
      calls += 1;
      const socket = new EventEmitter() as EventEmitter & {
        setTimeout: (timeoutMs: number, callback: () => void) => void;
        destroy: () => void;
      };
      socket.setTimeout = (timeoutMs) => {
        expect(timeoutMs).toBe(500);
      };
      socket.destroy = () => undefined;
      queueMicrotask(() => socket.emit("error", new Error("ECONNREFUSED")));
      return socket;
    };

    await expect(
      portIsFree("127.0.0.1", 8787, { connect, retryDelayMs: 0 }),
    ).resolves.toBe(true);
    expect(calls).toBe(2);
  });
});

describe("waitForPortFree", () => {
  it("reprobes until free and stops at its injected deadline", async () => {
    let now = 0;
    let probes = 0;
    const sleep = async (ms: number): Promise<void> => {
      now += ms;
    };

    await expect(
      waitForPortFree("127.0.0.1", 8787, {
        probe: async () => ++probes === 3,
        now: () => now,
        sleep,
        timeoutMs: 1000,
        pollIntervalMs: 100,
      }),
    ).resolves.toBe(true);
    expect(probes).toBe(3);

    probes = 0;
    const deadlineStart = now;
    await expect(
      waitForPortFree("127.0.0.1", 8787, {
        probe: async () => {
          probes += 1;
          return false;
        },
        now: () => now,
        sleep,
        timeoutMs: 250,
        pollIntervalMs: 100,
      }),
    ).resolves.toBe(false);
    expect(now - deadlineStart).toBe(250);
    expect(probes).toBe(4);
  });
});

describe("resolveStartConfig", () => {
  it("refuses to boot without a token, naming generation, exit 2", () => {
    const plan = resolveStartConfig({
      env: noTokenEnv(),
      secretsText: "",
      hasDist: true,
    });

    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.exitCode).toBe(2);
      expect(plan.message).toContain("PI_CARETAKER_TOKEN");
      expect(plan.message).toContain("openssl rand -hex 24");
    }
  });

  it("reads the token from the secrets file when the env is silent", () => {
    const plan = resolveStartConfig({
      env: {},
      secretsText: "PI_CARETAKER_TOKEN=file-token\n",
      hasDist: true,
    });

    expect(plan).toEqual({
      ok: true,
      command: "pi",
      args: [
        "--mode",
        "rpc",
        "--name",
        "caretaker",
        "--extension",
        "./dist/index.js",
      ],
      foreground: false,
      detached: true,
      logFile: expect.stringMatching(/pi-caretaker\.log$/),
      pidFile: expect.stringMatching(/pi-caretaker\.pid$/),
      healthUrl: "http://127.0.0.1:8787/health",
      env: expect.objectContaining({
        PI_CARETAKER_TOKEN: "file-token",
      }),
    });
  });

  it("pins the exact RPC boot lines fed to Pi stdin", () => {
    expect(buildRpcBootInput()).toEqual(['{"type":"new_session"}']);
  });

  it("waits for the listener: immediate ok, retry, and timeout", async () => {
    let now = 0;
    const sleep = async (ms: number): Promise<void> => {
      now += ms;
    };

    await expect(
      waitForHealth("http://x/health", {
        fetch: (async () => ({ ok: true })) as unknown as typeof fetch,
        now: () => now,
        sleep,
      }),
    ).resolves.toBe(true);

    let calls = 0;
    await expect(
      waitForHealth("http://x/health", {
        fetch: (async () => {
          calls += 1;
          if (calls < 3) throw new Error("down");
          return { ok: true };
        }) as unknown as typeof fetch,
        now: () => now,
        sleep,
        timeoutMs: 10_000,
      }),
    ).resolves.toBe(true);

    await expect(
      waitForHealth("http://x/health", {
        fetch: (async () => {
          throw new Error("down");
        }) as unknown as typeof fetch,
        now: () => now,
        sleep,
        timeoutMs: 500,
      }),
    ).resolves.toBe(false);
  });

  it("resolves attached mode explicitly without RPC arguments", () => {
    const plan = resolveStartConfig({ env: { PI_CARETAKER_TOKEN: "t" }, hasDist: true, root: "/repo", foreground: true });
    expect(plan).toMatchObject({
      ok: true,
      command: "pi",
      args: ["--name", "caretaker", "--extension", "./dist/index.js"],
      foreground: true,
      detached: false,
      logFile: "/repo/pi-caretaker.log",
      pidFile: "/repo/pi-caretaker.pid",
      healthUrl: "http://127.0.0.1:8787/health",
    });
    if (plan.ok) expect(plan.args).not.toContain("rpc");
  });

  it("treats an omitted secrets file as empty", () => {
    const plan = resolveStartConfig({
      env: { PI_CARETAKER_TOKEN: "t" },
      hasDist: true,
    });

    expect(plan.ok).toBe(true);
  });

  it("forwards file vars merged under the operator env to the child", () => {
    const plan = resolveStartConfig({
      env: { PI_CARETAKER_TOKEN: "env-token", PI_CARETAKER_HOST: "0.0.0.0" },
      secretsText: "PI_CARETAKER_TOKEN=file-token\nPI_CARETAKER_PORT=9999\n",
      hasDist: true,
    });

    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.env["PI_CARETAKER_TOKEN"]).toBe("env-token");
      expect(plan.env["PI_CARETAKER_PORT"]).toBe("9999");
      expect(plan.env["PI_CARETAKER_HOST"]).toBe("0.0.0.0");
    }
  });

  it("prefers the operator environment over the secrets file", () => {
    const plan = resolveStartConfig({
      env: { PI_CARETAKER_TOKEN: "env-token" },
      secretsText: "PI_CARETAKER_TOKEN=file-token\n",
      hasDist: true,
    });

    expect(plan.ok).toBe(true);
  });

  it("refuses to boot without a bundle, naming the build", () => {
    const plan = resolveStartConfig({
      env: { PI_CARETAKER_TOKEN: "t" },
      secretsText: "",
      hasDist: false,
    });

    expect(plan.ok).toBe(false);
    if (!plan.ok) {
      expect(plan.exitCode).toBe(1);
      expect(plan.message).toContain("pnpm build");
    }
  });
});

describe("stop pure functions", () => {
  it("parses only a positive integer pid", () => {
    expect(parsePidFile("42\n")).toBe(42);
    expect(parsePidFile("nope")).toBeNull();
    expect(parsePidFile("0")).toBeNull();
  });
  it("decides missing and stale pidfiles without signals", () => {
    expect(resolveStopPlan("", false)).toEqual({ running: false, reason: "missing" });
    expect(resolveStopPlan("not-a-pid")).toEqual({ running: false, reason: "invalid" });
    expect(resolveStopPlan("99999999")).toEqual({ running: false, reason: "stale", pid: 99999999 });
  });

  it("reports missing, invalid, and stale pidfiles without signaling", async () => {
    for (const [exists, text, reason] of [
      [false, "", "missing"],
      [true, "not-a-pid", "invalid"],
      [true, "42", "stale"],
    ] as const) {
      const removed: string[] = [];
      const result = await stopPreviousInstance({
        pidFile: "/fixture/pid",
        exists: () => exists,
        readFile: () => text,
        unlink: (path: string) => removed.push(path),
        kill: (_pid: number, signal: number | NodeJS.Signals) => {
          if (signal === 0) throw Object.assign(new Error("gone"), { code: "ESRCH" });
          throw new Error(`unexpected signal ${signal}`);
        },
      });
      expect(result).toEqual({ stopped: false, reason });
      expect(removed).toEqual(exists ? ["/fixture/pid"] : []);
    }
  });

  it("stops a live pid with SIGTERM and removes its pidfile", async () => {
    const signals: Array<number | NodeJS.Signals> = [];
    const removed: string[] = [];
    const result = await stopPreviousInstance({
      pidFile: "/fixture/pid",
      exists: () => true,
      readFile: () => "42\n",
      unlink: (path: string) => removed.push(path),
      kill: (_pid: number, signal: number | NodeJS.Signals) => {
        signals.push(signal);
        if (signal === 0 && signals.filter((seen) => seen === 0).length > 1) {
          throw Object.assign(new Error("gone"), { code: "ESRCH" });
        }
      },
      now: () => 0,
      sleep: async () => undefined,
    });

    expect(result).toEqual({ stopped: true, pid: 42, forced: false });
    expect(signals).toEqual([0, "SIGTERM", 0]);
    expect(removed).toEqual(["/fixture/pid"]);
  });

  it("uses SIGKILL after the injected five-second TERM deadline", async () => {
    let now = 0;
    const signals: Array<number | NodeJS.Signals> = [];
    const removed: string[] = [];
    const result = await stopPreviousInstance({
      pidFile: "/fixture/pid",
      exists: () => true,
      readFile: () => "73",
      unlink: (path: string) => removed.push(path),
      kill: (_pid: number, signal: number | NodeJS.Signals) => signals.push(signal),
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
    });

    expect(result).toEqual({ stopped: true, pid: 73, forced: true });
    expect(signals[0]).toBe(0);
    expect(signals[1]).toBe("SIGTERM");
    expect(signals.at(-1)).toBe("SIGKILL");
    expect(now).toBe(5000);
    expect(removed).toEqual(["/fixture/pid"]);
  });
});

describe("send-alert pure functions", () => {
  it("defaults the message when no text is given, joins argv otherwise", () => {
    expect(parseAlertMessage([])).toBe(DEFAULT_ALERT_MESSAGE);
    expect(parseAlertMessage(["  "])).toBe(DEFAULT_ALERT_MESSAGE);
    expect(parseAlertMessage(["host", "dark"])).toBe("host dark");
  });

  it("builds the fixed drill envelope around the message", () => {
    expect(buildAlertPayload("drill text")).toEqual({
      source: "drill",
      host: "server-b",
      event: "host_dark",
      message: "drill text",
    });
  });

  it("requires the token and defaults host and port", () => {
    const missing = resolveAlertConfig({ env: noTokenEnv(), secretsText: "" });
    expect(missing.ok).toBe(false);

    const config = resolveAlertConfig({
      env: { PI_CARETAKER_TOKEN: "t" },
      secretsText: "",
    });
    expect(config).toEqual({
      ok: true,
      host: "127.0.0.1",
      port: "8787",
      token: "t",
    });
    expect(
      resolveAlertConfig({
        env: {
          PI_CARETAKER_TOKEN: "t",
          PI_CARETAKER_HOST: "example.test",
          PI_CARETAKER_PORT: "1234",
        },
        secretsText: "",
      }),
    ).toEqual({
      ok: true,
      host: "example.test",
      port: "1234",
      token: "t",
    });
  });

  it("celebrates 202 and redacts the token from failure bodies", () => {
    expect(formatAlertOutcome(202, "{}", "tok")).toEqual({
      ok: true,
      exitCode: 0,
      log: "HTTP 202: queued; phone buzz = escape hatch live.",
    });

    const bad = formatAlertOutcome(500, `denied for tok\nretry`, "tok");
    expect(bad.ok).toBe(false);
    expect(bad.exitCode).toBe(1);
    expect(bad.error).toContain("[REDACTED]");
    expect(bad.error).not.toContain("tok");
  });
});

describe("operator CLIs as child processes", () => {
  it("start.mjs exits 2 with instructions when no token exists", () => {
    const fixture = scriptFixture();
    const result = fixture.runScript("scripts/start.mjs", {
      env: noTokenEnv(),
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("PI_CARETAKER_TOKEN");
    expect(result.stderr).toContain("openssl rand -hex 24");
  });

  it("stops the pidfile process before booting a new background instance", async () => {
    const fixture = scriptFixture();
    fixture.write("dist/index.js", "// fixture bundle\n");
    const path = installFakePi(fixture);
    const previous = await spawnSleeper();
    fixture.write("pi-caretaker.pid", `${previous.pid}\n`);
    const port = await unusedPort();
    try {
      const result = fixture.runScript("scripts/start.mjs", {
        env: {
          PATH: path,
          PI_CARETAKER_TOKEN: "test-token",
          PI_CARETAKER_HOST: "127.0.0.1",
          PI_CARETAKER_PORT: String(port),
        },
      });

      await previous.exited;
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`Stopped previous caretaker instance (PID ${previous.pid}).`);
      expect(result.stdout).toMatch(/PID: \d+/);
      expect(result.stdout).toContain(`Listener: http://127.0.0.1:${port}`);
      expect(result.stdout).toContain("Stop: pnpm stop");
      expect(fixture.read("pi-caretaker.pid")).toMatch(/^\d+\n$/);
    } finally {
      fixture.runScript("scripts/stop.mjs");
    }
  });

  it("removes a stale pidfile and proceeds to boot", async () => {
    const fixture = scriptFixture();
    fixture.write("dist/index.js", "// fixture bundle\n");
    const path = installFakePi(fixture);
    fixture.write("pi-caretaker.pid", "99999999\n");
    const port = await unusedPort();
    const result = fixture.runScript("scripts/start.mjs", {
      env: {
        PATH: path,
        PI_CARETAKER_TOKEN: "test-token",
        PI_CARETAKER_HOST: "127.0.0.1",
        PI_CARETAKER_PORT: String(port),
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("Stopped previous caretaker instance");
    expect(result.stdout).toMatch(/PID: \d+/);
    expect(result.stdout).toContain(`Listener: http://127.0.0.1:${port}`);
    expect(result.stdout).toContain("Stop: pnpm stop");
    fixture.runScript("scripts/stop.mjs");
  });

  it("fails after the bounded wait when an unidentified listener remains busy", async () => {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("missing loopback port");
    const fixture = scriptFixture();
    fixture.write("dist/index.js", "// fixture bundle\n");
    const path = installFakePi(fixture);
    const startedMarker = join(fixture.root, "fake-pi-started");
    try {
      const result = fixture.runScript("scripts/start.mjs", {
        env: {
          PATH: path,
          PI_CARETAKER_TOKEN: "test-token",
          PI_CARETAKER_HOST: "127.0.0.1",
          PI_CARETAKER_PORT: String(address.port),
          PI_CARETAKER_TEST_STARTED: startedMarker,
        },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`Listener still accepting connections at 127.0.0.1:${address.port}`);
      expect(result.stderr).toContain("unidentified holder");
      expect(result.stderr).toContain(`ss -ltnp | grep ${address.port}`);
      expect(fixture.exists("pi-caretaker.pid")).toBe(false);
      expect(fixture.exists("fake-pi-started")).toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("send-alert.mjs refuses without a token and never touches the network", () => {
    const fixture = scriptFixture();
    const result = fixture.runScript("scripts/send-alert.mjs", {
      env: noTokenEnv(),
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("PI_CARETAKER_TOKEN");
  });

  it("send-alert.mjs POSTs the drill envelope with a bearer token", async () => {
    const server = await startLoopbackServer({
      token: "test-token-1",
      mode: "ok-202",
    });
    try {
      const fixture = scriptFixture();
      const result = fixture.runScript("scripts/send-alert.mjs", {
        args: ["custom drill text"],
        env: {
          PI_CARETAKER_TOKEN: "test-token-1",
          PI_CARETAKER_HOST: "127.0.0.1",
          PI_CARETAKER_PORT: new URL(server.url).port,
        },
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("HTTP 202");
      // Worker messages arrive on the event loop, which spawnSync blocked:
      // yield before asserting on what the server saw.
      const start = Date.now();
      while (server.requests.length < 1 && Date.now() - start < 5000) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(server.requests).toHaveLength(1);
      expect(server.requests[0]).toEqual({
        method: "POST",
        url: "/events",
        auth: "Bearer test-token-1",
        body: {
          source: "drill",
          host: "server-b",
          event: "host_dark",
          message: "custom drill text",
        },
      });
    } finally {
      await server.close();
    }
  });

  it("send-alert.mjs redacts the token from a failure body", async () => {
    const server = await startLoopbackServer({
      token: "test-token-2",
      mode: "fail-500",
    });
    try {
      const fixture = scriptFixture();
      const result = fixture.runScript("scripts/send-alert.mjs", {
        env: {
          PI_CARETAKER_TOKEN: "test-token-2",
          PI_CARETAKER_HOST: "127.0.0.1",
          PI_CARETAKER_PORT: new URL(server.url).port,
        },
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("[REDACTED]");
      expect(result.stderr).not.toContain("test-token-2");
    } finally {
      await server.close();
    }
  });
});
