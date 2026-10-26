#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { connect as netConnect } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stopPreviousInstance } from "./stop.mjs";

/**
 * Parse KEY=VALUE lines. Blank lines, `#` comments and malformed lines
 * (no `=`, empty key) are skipped — a hand-edited secrets file must never
 * crash the boot.
 */
export function parseSecretsEnv(text) {
  const vars = {};
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    // separator >= 1 on a trimmed line, so the key is never empty.
    const key = trimmed.slice(0, separator).trim();
    vars[key] = trimmed.slice(separator + 1).trim();
  }
  return vars;
}

export function resolveStartConfig({ env, secretsText, hasDist, foreground = false, root = process.cwd() }) {
  const fileVars = parseSecretsEnv(secretsText ?? "");
  const token = env.PI_CARETAKER_TOKEN ?? fileVars.PI_CARETAKER_TOKEN;
  if (!token) {
    return {
      ok: false,
      exitCode: 2,
      message:
        "PI_CARETAKER_TOKEN is required. Set it in secrets.env or the environment (generate one with: openssl rand -hex 24). Never share this token.",
    };
  }
  const thinking = env.PI_CARETAKER_THINKING ?? "minimal";
  const thinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  if (!thinkingLevels.includes(thinking)) {
    return {
      ok: false,
      exitCode: 1,
      message: "PI_CARETAKER_THINKING must be one of off, minimal, low, medium, high, xhigh, max",
    };
  }
  if (!hasDist) {
    return {
      ok: false,
      exitCode: 1,
      message: "dist/index.js is missing. Run pnpm build first.",
    };
  }
  const host = env.PI_CARETAKER_HOST ?? "127.0.0.1";
  const port = env.PI_CARETAKER_PORT ?? "8787";
  // RPC mode, not the TUI: with redirected stdio a bare `pi` falls into
  // print mode and exits without ever starting a session. RPC stays up.
  // --foreground keeps the plain extension load for interactive debugging.
  const args = foreground
    ? ["--name", "caretaker", "--extension", "./dist/index.js", "--thinking", thinking]
    : ["--mode", "rpc", "--name", "caretaker", "--extension", "./dist/index.js", "--thinking", thinking];
  return {
    ok: true,
    command: "pi",
    args,
    foreground,
    detached: !foreground,
    logFile: resolve(root, "pi-caretaker.log"),
    pidFile: env.PI_CARETAKER_PID_FILE
      ? resolve(env.PI_CARETAKER_PID_FILE)
      : resolve(root, "pi-caretaker.pid"),
    healthUrl: `http://${host}:${port}/health`,
    // The child must see the file vars merged under the operator env:
    // validating the token without forwarding it starts a Pi whose entry
    // immediately disables itself (MISSING_WEBHOOK_TOKEN).
    env: { ...fileVars, ...env },
  };
}

/**
 * Probe whether a TCP listener accepts connections at host:port. A failed
 * connect is retried once so a transient local socket error is not treated
 * as proof that the port is free.
 */
export async function portIsFree(
  host,
  port,
  { connect = netConnect, timeoutMs = 500, retryDelayMs = 50 } = {},
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const accepting = await new Promise((resolve) => {
      const socket = connect({ host, port });
      let settled = false;
      const finish = (isFree) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(isFree);
      };
      socket.setTimeout(timeoutMs, () => finish(true));
      socket.once("connect", () => finish(false));
      socket.once("error", () => finish(true));
    });
    if (!accepting) return false;
    if (attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  return true;
}

/** Poll after stopping a managed process so its listener has time to close. */
export async function waitForPortFree(
  host,
  port,
  {
    probe = portIsFree,
    now = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    timeoutMs = 10000,
    pollIntervalMs = 250,
  } = {},
) {
  const deadline = now() + timeoutMs;
  for (;;) {
    if (await probe(host, port)) return true;
    const remaining = deadline - now();
    if (remaining <= 0) return false;
    await sleep(Math.min(pollIntervalMs, remaining));
  }
}

/**
 * The exact JSONL lines fed to Pi's stdin at boot. Pinned so a protocol
 * change breaks loudly instead of booting a sessionless Pi that looks fine.
 */
export function buildRpcBootInput() {
  return ['{"type":"new_session"}'];
}

/**
 * Parse the supervisor's first stdout line. `PID:<n>` carries the Pi
 * process id; `ERROR:<message>` carries a spawn failure. Anything else
 * is protocol drift and must fail loudly, never be mistaken for a PID.
 */
export function parseSupervisorLine(line) {
  const text = String(line).trim();
  const pid = /^PID:(\d+)$/.exec(text);
  if (pid) return { kind: "pid", pid: Number(pid[1]) };
  if (text.startsWith("ERROR:")) return { kind: "error", message: text.slice(6).trim() };
  return null;
}

/**
 * Read the supervisor's first stdout line with a deadline. Injectable
 * timer keeps unit tests instant and network-free.
 */
export function waitForFirstLine(stream, { timeoutMs = 15000, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
  return new Promise((resolve) => {
    let buffer = "";
    const done = (value) => {
      clearTimeoutFn(timer);
      stream.removeListener("data", onData);
      resolve(value);
    };
    const timer = setTimeoutFn(() => done(null), timeoutMs);
    const onData = (chunk) => {
      buffer += String(chunk);
      const end = buffer.indexOf("\n");
      if (end >= 0) done(buffer.slice(0, end));
    };
    stream.on("data", onData);
  });
}

/**
 * Poll the listener until it answers or the timeout elapses. `fetch`,
 * `now`, and `sleep` are injected so unit tests drive every path without
 * sockets or clocks.
 */
export async function waitForHealth(
  url,
  { fetch: fetchImpl = fetch, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), timeoutMs = 30000 } = {},
) {
  const start = now();
  for (;;) {
    try {
      const response = await fetchImpl(url);
      if (response.ok) return true;
    } catch {
      // Not up yet — keep polling until the deadline.
    }
    if (now() - start > timeoutMs) return false;
    await sleep(250);
  }
}

async function supervisorMain() {
  // Long-lived pipe holder: spawns Pi, feeds the RPC boot lines, and keeps
  // stdin open for the life of the process. Pi shuts down on stdin EOF
  // (see runRpcMode), so exiting here would kill a healthy session.
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const plan = resolveStartConfig({
    env: process.env,
    secretsText: "",
    hasDist: true,
    root,
  });
  if (!plan.ok) {
    console.log(`ERROR:${plan.message}`);
    process.exit(plan.exitCode);
  }
  const { openSync } = await import("node:fs");
  const logFd = openSync(plan.logFile, "a");
  let child;
  let stopping = false;
  const terminate = () => {
    stopping = true;
    if (child && child.exitCode === null) child.kill("SIGTERM");
  };
  process.once("SIGTERM", terminate);
  process.once("SIGINT", terminate);
  let consecutiveShort = 0;
  let delay = Number(process.env.PI_CARETAKER_SUPERVISE_BACKOFF_MS ?? 1000);
  try {
    while (!stopping) {
      const began = Date.now();
      const command = process.env.PI_CARETAKER_SUPERVISE_COMMAND ?? plan.command;
      child = spawn(command, plan.args, { cwd: root, env: plan.env, stdio: ["pipe", logFd, logFd] });
      const outcome = await new Promise((resolve) => {
        child.once("error", (error) => resolve({ error }));
        child.once("spawn", () => {
          for (const line of buildRpcBootInput()) child.stdin.write(`${line}\n`);
          console.log(`PID:${child.pid}`);
        });
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });
      if (stopping) break;
      const lived = Date.now() - began;
      consecutiveShort = lived < 60_000 ? consecutiveShort + 1 : 0;
      if (consecutiveShort >= 5 || outcome.error) {
        const message = outcome.error ? `Could not start Pi: ${outcome.error.message}` : `Pi exited after ${consecutiveShort} consecutive short-lived respawns`;
        console.log(`ERROR:${message}`);
        console.error(`[pi-caretaker] ERROR: ${message}`);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 30_000);
    }
  } finally {
    process.removeListener("SIGTERM", terminate);
    process.removeListener("SIGINT", terminate);
    if (child && child.exitCode === null) child.kill("SIGTERM");
  }
}

async function main() {
  if (process.argv.includes("--supervise")) {
    await supervisorMain();
    return;
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const envFile = resolve(root, "secrets.env");
  const plan = resolveStartConfig({
    env: process.env,
    secretsText: existsSync(envFile) ? readFileSync(envFile, "utf8") : "",
    hasDist: existsSync(resolve(root, "dist/index.js")),
    foreground: process.argv.includes("--foreground"),
    root,
  });
  if (!plan.ok) {
    console.error(plan.message);
    process.exit(plan.exitCode);
  }
  const previous = await stopPreviousInstance({ pidFile: plan.pidFile });
  if (previous.stopped) {
    console.log(`Stopped previous caretaker instance (PID ${previous.pid}).`);
  }
  let listenerUrl;
  try {
    listenerUrl = new URL(plan.healthUrl);
  } catch {
    console.error("Resolved health URL is not a valid URL; refusing to boot.");
    process.exitCode = 1;
    return;
  }
  const listenerHost = listenerUrl.hostname.replace(/^\[|\]$/g, "");
  const listenerPort = Number(listenerUrl.port || plan.env.PI_CARETAKER_PORT || "8787");
  if (!(await waitForPortFree(listenerHost, listenerPort))) {
    console.error(
      `Listener still accepting connections at ${listenerHost}:${listenerPort} after stopping the managed instance. This is an unidentified holder; identify it without killing arbitrary processes (for example: ss -ltnp | grep ${listenerPort}).`,
    );
    process.exitCode = 1;
    return;
  }
  if (plan.foreground) {
    const child = spawn(plan.command, plan.args, {
      cwd: root,
      env: plan.env,
      stdio: "inherit",
    });
    child.on("error", (error) => {
      console.error(`Could not start Pi: ${error.message}`);
      process.exitCode = 1;
    });
    child.on("exit", (code, signal) => {
      process.exitCode = code ?? (signal ? 1 : 0);
    });
    return;
  }
  const { openSync } = await import("node:fs");
  const logFd = openSync(plan.logFile, "a");
  const supervisor = spawn(process.execPath, [fileURLToPath(import.meta.url), "--supervise"], {
    cwd: root,
    env: plan.env,
    detached: true,
    stdio: ["ignore", "pipe", logFd],
  });
  supervisor.unref();
  // Ctrl-C during boot must not orphan the pair: take the group down.
  const abortBoot = () => {
    try {
      process.kill(-supervisor.pid, "SIGKILL");
    } catch {
      try {
        supervisor.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    }
    process.exit(130);
  };
  process.once("SIGINT", abortBoot);
  const firstLine = await waitForFirstLine(supervisor.stdout, { timeoutMs: 15000 });
  // The detached child is intentionally long-lived; its pipe must not keep
  // this short-lived launcher alive after the protocol line is consumed.
  supervisor.stdout.unref();
  const parsed = firstLine === null ? null : parseSupervisorLine(firstLine);
  if (parsed === null || parsed.kind !== "pid") {
    try {
      process.kill(supervisor.pid, "SIGKILL");
    } catch {
      // Already gone — the supervisor's own error line (if any) is above.
    }
    if (parsed !== null && parsed.kind === "error") {
      console.error(`Pi failed to start: ${parsed.message}`);
    } else {
      console.error(
        "Pi supervisor reported nothing usable. " +
          `See ${plan.logFile} for startup diagnostics.`,
      );
    }
    process.exitCode = 1;
    return;
  }
  const pid = parsed.pid;
  try {
    await waitForHealthOrTimeout(plan, pid, supervisor.pid);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  // The stable pidfile target is the supervisor, which survives child respawns.
  writeFileSync(plan.pidFile, `${supervisor.pid}\n`);
  const host = process.env.PI_CARETAKER_HOST ?? "127.0.0.1";
  const port = process.env.PI_CARETAKER_PORT ?? "8787";
  console.log(`PID: ${pid}\nListener: http://${host}:${port}\nLog: ${plan.logFile}\nStop: pnpm stop`);
}

/**
 * Poll the listener until it answers; on timeout kill the whole
 * supervisor tree (it holds no session worth keeping) and fail loudly.
 */
async function waitForHealthOrTimeout(plan, pid, supervisorPid) {
  const ready = await waitForHealth(plan.healthUrl);
  if (ready) return;
  try {
    // The detached supervisor is the process-group leader; its child Pi
    // inherits that group, so kill both using the supervisor's PID.
    process.kill(-supervisorPid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
  throw new Error(
    `Pi did not become ready in time. See ${plan.logFile} for startup diagnostics.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
