import { Logger, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

export function createGramJsClient({ apiId, apiHash, session }) {
  return new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 5,
    baseLogger: new Logger("none"),
  });
}
