import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createGramJsClient } from "./client.mjs";
import {
  DEFAULT_TEST_BOT,
  SESSION_REVOKED_MESSAGE,
  formatToolError,
  loadSecrets,
  redactedText,
  requireSecret,
  secretsPath,
  telegramApiCredentials,
} from "./seclib.mjs";

function formatDate(date) {
  const dateValue = date instanceof Date
    ? date
    : new Date(typeof date === "number" ? date * 1000 : date);
  return dateValue.toISOString().replace(/Z$/u, "+00:00");
}

export async function runRead({
  args = process.argv.slice(2),
  env = process.env,
  createClient = createGramJsClient,
  output = (line) => console.log(line),
} = {}) {
  const path = secretsPath(env);
  const secrets = await loadSecrets(path);
  const { apiId, apiHash } = telegramApiCredentials(secrets, path);
  const session = requireSecret(secrets, "TELEGRAM_MT_SESSION", path);
  const target = env.TELEGRAM_TEST_BOT?.trim() || DEFAULT_TEST_BOT;
  const rawLimit = args.length === 0 ? "5" : String(args[0]);
  if (!/^\d+$/u.test(rawLimit)) throw new Error("read limit must be a non-negative integer");
  const limit = Number(rawLimit);
  if (!Number.isSafeInteger(limit)) {
    throw new Error("read limit must be a non-negative integer");
  }
  const client = createClient({ apiId, apiHash, session });
  const secretValues = Object.values(secrets);

  try {
    await client.connect();
    if (!await client.checkAuthorization()) throw new Error(SESSION_REVOKED_MESSAGE);
    const entity = await client.getEntity(target);
    const messages = await client.getMessages(entity, { limit });
    for (const message of messages) {
      const who = message.out ? "you" : "bot";
      const rawText = typeof message.message === "string" ? message.message : "";
      const body = Array.from(redactedText(rawText.replace(/\n/gu, " "), secretValues)).slice(0, 160).join("");
      output(`[${formatDate(message.date)}] ${who}: ${body}`);
    }
  } catch (error) {
    throw new Error(formatToolError("read", error, secretValues));
  } finally {
    await client.disconnect().catch(() => undefined);
  }
}

async function main() {
  try {
    await runRead();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "read failed");
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
