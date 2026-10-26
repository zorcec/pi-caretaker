#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  if (!hasDist) {
    return {
      ok: false,
      exitCode: 1,
      message: "dist/index.js is missing. Run pnpm build first.",
    };
  }
  const host = env.PI_CARETAKER_HOST ?? "127.0.0.1";
  const port = env.PI_CARETAKER_PORT ?? "8787";
  return {
    ok: true,
    command: "pi",
    // RPC mode, not the TUI: with redirected stdio a bare `pi` falls into
    // print mode and exits without ever starting a session. RPC stays up
    // and boots the session on the new_session command below.
    args: ["--mode", "rpc", "--name", "caretaker", "--extension", "./dist/index.js"],
    foreground,
    detached: !foreground,
    logFile: resolve(root, "pi-caretaker.log"),
    pidFile: resolve(root, "pi-caretaker.pid"),
    healthUrl: `http://${host}:${port}/health`,
    // The child must see the file vars merged under the operator env:
    // validating the token without forwarding it starts a Pi whose entry
    // immediately disables itself (MISSING_WEBHOOK_TOKEN).
    env: { ...fileVars, ...env },
  };
}

/**
 * The exact JSONL lines fed to Pi's stdin at boot. Pinned so a protocol
 * change breaks loudly instead of booting a sessionless Pi that looks fine.
 */
export function buildRpcBootInput() {
  return ['{"type":"new_session"}'];
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

async function main() {
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
  const child = spawn(plan.command, plan.args, {
    cwd: root,
    env: plan.env,
    detached: true,
    stdio: ["pipe", logFd, logFd],
  });
  const bootError = await new Promise((resolve) => {
    child.on("error", resolve);
    child.on("spawn", () => resolve(null));
  });
  if (bootError) {
    console.error(`Could not start Pi: ${bootError.message}`);
    process.exitCode = 1;
    return;
  }
  for (const line of buildRpcBootInput()) child.stdin.write(`${line}\n`);
  child.stdin.end();
  child.unref();
  const ready = await waitForHealth(plan.healthUrl);
  if (!ready) {
    try {
      process.kill(child.pid, "SIGKILL");
    } catch {
      // Already gone — the log below says where to look.
    }
    console.error(
      `Pi did not become ready in time. See ${plan.logFile} for startup diagnostics.`,
    );
    process.exitCode = 1;
    return;
  }
  writeFileSync(plan.pidFile, `${child.pid}\n`);
  const host = process.env.PI_CARETAKER_HOST ?? "127.0.0.1";
  const port = process.env.PI_CARETAKER_PORT ?? "8787";
  console.log(`PID: ${child.pid}\nListener: http://${host}:${port}\nLog: ${plan.logFile}\nStop: pnpm stop`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
