#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
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

/**
 * Decide whether the caretaker can boot. Pure: every branch is unit-tested,
 * the CLI layer only prints the verdict and exits. Operator environment wins
 * over the secrets file; values are never printed.
 */
export function resolveStartConfig({ env, secretsText, hasDist }) {
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
  return {
    ok: true,
    command: "pi",
    args: ["--extension", "./dist/index.js"],
  };
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const envFile = resolve(root, "secrets.env");
  const secretsText = existsSync(envFile)
    ? readFileSync(envFile, "utf8")
    : "";
  const plan = resolveStartConfig({
    env: process.env,
    secretsText,
    hasDist: existsSync(resolve(root, "dist/index.js")),
  });
  if (!plan.ok) {
    console.error(plan.message);
    process.exit(plan.exitCode);
  }
  const child = spawn(plan.command, plan.args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  child.on("error", (error) => {
    console.error(`Could not start Pi: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
