import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createGramJsClient } from "./client.mjs";
import {
  DEFAULT_TEST_BOT,
  SESSION_REVOKED_MESSAGE,
  formatToolError,
  loadSecrets,
  requireSecret,
  secretsPath,
  telegramApiCredentials,
} from "./seclib.mjs";

export async function runSend({
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
  const text = args.join(" ").trim() || "manual test ping";
  const client = createClient({ apiId, apiHash, session });
  const secretValues = [...Object.values(secrets), text];

  try {
    await client.connect();
    if (!await client.checkAuthorization()) throw new Error(SESSION_REVOKED_MESSAGE);
    const entity = await client.getEntity(target);
    const message = await client.sendMessage(entity, { message: text });
    output(`sent chat_id=${String(message.chatId)} msg_id=${message.id} text_len=${Array.from(text).length}`);
  } catch (error) {
    throw new Error(formatToolError("send", error, secretValues));
  } finally {
    await client.disconnect().catch(() => undefined);
  }
}

async function main() {
  try {
    await runSend();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "send failed");
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
