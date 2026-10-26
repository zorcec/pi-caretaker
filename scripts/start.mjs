#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function parseSecretsEnv(text) {
  const vars = {};
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    vars[key] = trimmed.slice(separator + 1).trim();
  }
  return vars;
}

export function resolveStartConfig({ env, secretsText, hasDist, root = process.cwd(), foreground = false }) {
  const fileVars = parseSecretsEnv(secretsText ?? "");
  const token = env.PI_CARETAKER_TOKEN ?? fileVars.PI_CARETAKER_TOKEN;
  if (!token) return { ok: false, exitCode: 2, message: "PI_CARETAKER_TOKEN is required. Set it in secrets.env or the environment (generate one with: openssl rand -hex 24). Never share this token." };
  if (!hasDist) return { ok: false, exitCode: 1, message: "dist/index.js is missing. Run pnpm build first." };
  const detached = !foreground;
  return { ok: true, command: "pi", args: ["--extension", "./dist/index.js"], foreground, detached,
    logFile: resolve(root, "pi-caretaker.log"), pidFile: resolve(root, "pi-caretaker.pid") };
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const envFile = resolve(root, "secrets.env");
  const plan = resolveStartConfig({ env: process.env, secretsText: existsSync(envFile) ? readFileSync(envFile, "utf8") : "", hasDist: existsSync(resolve(root, "dist/index.js")), root, foreground: process.argv.includes("--foreground") });
  if (!plan.ok) { console.error(plan.message); process.exit(plan.exitCode); }
  if (plan.foreground) {
    const child = spawn(plan.command, plan.args, { cwd: root, env: process.env, stdio: "inherit" });
    child.on("error", (error) => { console.error(`Could not start Pi: ${error.message}`); process.exitCode = 1; });
    child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
    return;
  }
  const log = (await import("node:fs")).openSync(plan.logFile, "a");
  const child = spawn(plan.command, plan.args, { cwd: root, env: process.env, detached: true, stdio: ["ignore", log, log] });
  child.on("error", (error) => { console.error(`Could not start Pi: ${error.message}`); process.exitCode = 1; });
  child.once("spawn", () => {
    writeFileSync(plan.pidFile, `${child.pid}\n`);
    console.log(`PID: ${child.pid}\nListener: ${process.env.PI_CARETAKER_HOST ?? "127.0.0.1"}:${process.env.PI_CARETAKER_PORT ?? "8787"}\nLog: ${plan.logFile}\nStop: pnpm stop`);
    child.unref();
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
