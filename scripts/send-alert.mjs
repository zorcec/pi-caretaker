#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseSecretsEnv } from "./start.mjs";

export const DEFAULT_ALERT_MESSAGE =
  "Drill: fake host-dark alert from pi-caretaker.";

/** argv remainder joined as the alert text; empty input falls back to the drill default. */
export function parseAlertMessage(argv) {
  const message = argv.join(" ").trim();
  return message === "" ? DEFAULT_ALERT_MESSAGE : message;
}

export function resolveAlertConfig({ env, secretsText }) {
  const fileVars = parseSecretsEnv(secretsText ?? "");
  const token = env.PI_CARETAKER_TOKEN ?? fileVars.PI_CARETAKER_TOKEN;
  if (!token) {
    return {
      ok: false,
      exitCode: 1,
      message: "PI_CARETAKER_TOKEN is required in the environment.",
    };
  }
  return {
    ok: true,
    host: env.PI_CARETAKER_HOST ?? "127.0.0.1",
    port: env.PI_CARETAKER_PORT ?? "8787",
    token,
  };
}

/** The fixed drill envelope: a host_dark escape-hatch event, nothing else. */
export function buildAlertPayload(message) {
  return {
    source: "drill",
    host: "server-b",
    event: "host_dark",
    message,
  };
}

/**
 * Render the outcome for a human. The token is redacted out of error bodies
 * before anything reaches stderr — a log line is a persistence layer you did
 * not mean to build.
 */
export function formatAlertOutcome(status, bodyText, token) {
  if (status === 202) {
    return {
      ok: true,
      exitCode: 0,
      log: "HTTP 202: queued; phone buzz = escape hatch live.",
    };
  }
  const snippet = bodyText
    .slice(0, 200)
    .split(token)
    .join("[REDACTED]")
    .replace(/[\r\n\t]+/g, " ");
  return {
    ok: false,
    exitCode: 1,
    log: `HTTP ${status}: request was not queued.`,
    error: `Response: ${snippet}`,
  };
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const envFile = resolve(root, "secrets.env");
  const secretsText = existsSync(envFile)
    ? readFileSync(envFile, "utf8")
    : "";
  const config = resolveAlertConfig({ env: process.env, secretsText });
  if (!config.ok) {
    console.error(config.message);
    process.exit(config.exitCode);
  }
  const message = parseAlertMessage(process.argv.slice(2));
  const url = `http://${config.host}:${config.port}/events`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(buildAlertPayload(message)),
    });
    const outcome = formatAlertOutcome(
      response.status,
      await response.text(),
      config.token,
    );
    console.log(outcome.log);
    if (!outcome.ok) {
      console.error(outcome.error);
    }
    process.exitCode = outcome.exitCode;
  } catch (error) {
    console.error(
      `Alert request failed: ${error instanceof Error ? error.message : "network error"}`,
    );
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
