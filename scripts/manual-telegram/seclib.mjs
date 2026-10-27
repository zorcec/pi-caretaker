import { appendFile, chmod, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ADR-0005: only operator tooling reads the gitignored secrets file.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const secretKeyPattern = /^[A-Za-z0-9_]+$/u;

export const DEFAULT_TEST_BOT = "@SarahTelegramBot";
export const SESSION_REVOKED_MESSAGE = "session not authorized (revoked?) — remove TELEGRAM_MT_SESSION from the secrets file, then re-run node scripts/manual-telegram/login.mjs";

export function secretsPath(env = process.env, root = repoRoot) {
  const override = env.PI_CARETAKER_SECRETS?.trim();
  return resolve(override || resolve(root, "secrets.env"));
}

export function parseSecrets(contents) {
  const secrets = Object.create(null);
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    if (key === "") continue;
    secrets[key] = line.slice(separator + 1).trim();
  }
  return secrets;
}

export async function loadSecrets(path = secretsPath()) {
  try {
    return parseSecrets(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`secrets file not found: ${path}`);
    throw new Error(`cannot read secrets file: ${path}`);
  }
}

export function requireSecret(secrets, key, path = secretsPath()) {
  const value = String(secrets[key] ?? "").trim();
  if (value === "") throw new Error(`${key} missing in ${path} — add it first`);
  return value;
}

export function telegramApiCredentials(secrets, path) {
  const rawId = requireSecret(secrets, "TELEGRAM_API_ID", path);
  if (!/^\d+$/u.test(rawId)) throw new Error(`TELEGRAM_API_ID must be a positive integer in ${path}`);
  const apiId = Number(rawId);
  if (!Number.isSafeInteger(apiId) || apiId <= 0) {
    throw new Error(`TELEGRAM_API_ID must be a positive integer in ${path}`);
  }
  return {
    apiId,
    apiHash: requireSecret(secrets, "TELEGRAM_API_HASH", path),
  };
}

export async function appendSecret(path, key, value) {
  if (!secretKeyPattern.test(key) || value === "" || /[\r\n]/u.test(value)) {
    throw new Error("refusing to append: bad key or empty value");
  }
  let prefix = "";
  try {
    const contents = await readFile(path, "utf8");
    if (contents !== "" && !contents.endsWith("\n")) prefix = "\n";
  } catch (error) {
    if (error?.code !== "ENOENT") throw new Error(`cannot read secrets file: ${path}`);
  }
  await appendFile(path, `${prefix}${key}=${value}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}

export function redactedText(value, secrets) {
  let result = String(value);
  for (const secret of secrets) {
    if (typeof secret === "string" && secret !== "") result = result.split(secret).join("[REDACTED]");
  }
  return result.replace(/[\r\n]+/gu, " ");
}

export function formatToolError(action, error, secrets = []) {
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  return `${action} failed: ${name}: ${redactedText(message, secrets)}`;
}
