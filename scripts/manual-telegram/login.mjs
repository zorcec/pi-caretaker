import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createGramJsClient } from "./client.mjs";
import { createPrompt } from "./prompt.mjs";
import {
  appendSecret,
  formatToolError,
  loadSecrets,
  requireSecret,
  secretsPath,
  telegramApiCredentials,
} from "./seclib.mjs";

class PromptCancelled extends Error {}

export async function runLogin({
  env = process.env,
  prompt = createPrompt(),
  createClient = createGramJsClient,
  output = (line) => console.log(line),
} = {}) {
  const path = secretsPath(env);
  const secrets = await loadSecrets(path);
  if (String(secrets.TELEGRAM_MT_SESSION ?? "").trim() !== "") {
    throw new Error("TELEGRAM_MT_SESSION already exists in secrets.env — revoke the prior session before minting a new one");
  }
  const { apiId, apiHash } = telegramApiCredentials(secrets, path);
  const redactions = Object.values(secrets);
  let phone = "";
  let code = "";
  let password = "";
  let client;

  try {
    phone = String(await prompt("Telegram phone number: ") ?? "").trim();
    if (phone === "") {
      output("cancelled: no input");
      return { cancelled: true };
    }

    client = createClient({ apiId, apiHash, session: "" });
    let authError;
    const readInput = async (question, options) => {
      const answer = String(await prompt(question, options) ?? "").trim();
      if (answer === "") throw new PromptCancelled("no input");
      return answer;
    };
    await client.start({
      phoneNumber: async () => phone,
      phoneCode: async (isCodeViaApp) => {
        code = await readInput(isCodeViaApp ? "Telegram app login code: " : "Telegram login code: ");
        return code;
      },
      password: async (hint) => {
        const hintText = hint ? ` (hint: ${hint})` : "";
        password = await readInput(`Two-step verification password${hintText}: `, { hidden: true });
        return password;
      },
      onError: (error) => {
        authError = error;
        return true;
      },
    });
    if (authError) throw authError;
    if (!await client.checkAuthorization()) throw new Error("login ended without an authorized session");
    const session = client.session.save();
    if (typeof session !== "string" || session === "") throw new Error("GramJS returned an empty session");
    await appendSecret(path, "TELEGRAM_MT_SESSION", session);
    output("session saved to secrets.env (value not displayed)");
    return { cancelled: false };
  } catch (error) {
    if (error instanceof PromptCancelled) {
      output("cancelled: no input");
      return { cancelled: true };
    }
    throw new Error(formatToolError("login", error, [...redactions, phone, code, password]));
  } finally {
    if (client) await client.disconnect().catch(() => undefined);
  }
}

async function main() {
  try {
    await runLogin();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "login failed");
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
