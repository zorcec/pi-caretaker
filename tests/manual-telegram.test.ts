import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { TelegramClient } from "telegram";
import { appendSecret, loadSecrets, parseSecrets } from "../scripts/manual-telegram/seclib.mjs";
import { createGramJsClient } from "../scripts/manual-telegram/client.mjs";
import { runLogin } from "../scripts/manual-telegram/login.mjs";
import { runRead } from "../scripts/manual-telegram/read.mjs";
import { runSend } from "../scripts/manual-telegram/send.mjs";
import { createPrompt } from "../scripts/manual-telegram/prompt.mjs";

const temporaryDirectories: string[] = [];

async function temporarySecrets(contents: string): Promise<{ dir: string; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), "pi-caretaker-manual-telegram-"));
  temporaryDirectories.push(dir);
  const path = join(dir, "secrets.env");
  await writeFile(path, contents, { mode: 0o600 });
  return { dir, path };
}

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    connect: vi.fn(async () => undefined),
    checkAuthorization: vi.fn(async () => true),
    getEntity: vi.fn(async (target: string) => ({ target })),
    sendMessage: vi.fn(async () => ({ chatId: 321, id: 654 })),
    getMessages: vi.fn(async () => []),
    disconnect: vi.fn(async () => undefined),
    start: vi.fn(async () => undefined),
    session: { save: () => "session-sentinel-not-real" },
    ...overrides,
  };
}

function mockClientFactory(factory: unknown): never {
  return factory as never;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("manual Telegram tooling", () => {
  it("creates a GramJS StringSession client without connecting", () => {
    const client = createGramJsClient({ apiId: 123456, apiHash: "api-hash-sentinel-not-real", session: "" });

    expect(client).toBeInstanceOf(TelegramClient);
    expect(client.session.constructor.name).toBe("StringSession");
  });

  it("imports the GramJS client module graph under plain Node ESM", () => {
    const clientModule = new URL("../scripts/manual-telegram/client.mjs", import.meta.url).href;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", `await import(${JSON.stringify(clientModule)})`],
      { encoding: "utf8" },
    );

    expect(result.status, result.stderr || result.error?.message).toBe(0);
  });

  it("parses secrets.env key/value lines without logging credential values", async () => {
    const apiHash = "api-hash-sentinel-not-real";
    const session = "mt-session-sentinel-not-real";
    const parsed = parseSecrets(`# ignored\n TELEGRAM_API_ID = 123456 \nTELEGRAM_API_HASH=${apiHash}\nTELEGRAM_MT_SESSION=${session}\nNO_EQUALS\nEMPTY=\n`);
    const { path } = await temporarySecrets(`TELEGRAM_API_HASH=${apiHash}\nTELEGRAM_MT_SESSION=${session}\n`);
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => output.push(args.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => output.push(args.join(" ")));

    const loaded = await loadSecrets(path);

    expect(parsed).toMatchObject({ TELEGRAM_API_ID: "123456", TELEGRAM_API_HASH: apiHash, TELEGRAM_MT_SESSION: session, EMPTY: "" });
    expect(loaded.TELEGRAM_API_HASH).toBe(apiHash);
    expect(loaded.TELEGRAM_MT_SESSION).toBe(session);
    expect(output.join("\n")).not.toContain(apiHash);
    expect(output.join("\n")).not.toContain(session);
  });

  it("refuses to mint again when TELEGRAM_MT_SESSION is already present", async () => {
    const session = "mt-session-sentinel-not-real";
    const { path } = await temporarySecrets(`TELEGRAM_API_ID=123456\nTELEGRAM_API_HASH=api-hash-sentinel-not-real\nTELEGRAM_MT_SESSION=${session}\n`);
    const prompt = vi.fn(async () => "+15550000000");
    const createClient = vi.fn(() => makeClient());
    const output: string[] = [];

    await expect(runLogin({
      env: { PI_CARETAKER_SECRETS: path },
      prompt,
      createClient: mockClientFactory(createClient),
      output: (line: string) => output.push(line),
    })).rejects.toThrow("TELEGRAM_MT_SESSION already exists in secrets.env");

    expect(prompt).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(output.join("\n")).not.toContain(session);
  });

  it("cancels login on EOF without connecting or appending a session", async () => {
    const initial = "TELEGRAM_API_ID=123456\nTELEGRAM_API_HASH=api-hash-sentinel-not-real\n";
    const { path } = await temporarySecrets(initial);
    const prompt = vi.fn(async () => null);
    const createClient = vi.fn(() => makeClient());
    const output: string[] = [];

    const result = await runLogin({
      env: { PI_CARETAKER_SECRETS: path },
      prompt,
      createClient: mockClientFactory(createClient),
      output: (line: string) => output.push(line),
    });

    expect(result).toEqual({ cancelled: true });
    expect(createClient).not.toHaveBeenCalled();
    expect(await readFile(path, "utf8")).toBe(initial);
    expect(output.join("\n")).toContain("cancelled: no input");
  });

  it("appends an authorized GramJS session without printing the session or credentials", async () => {
    const apiHash = "api-hash-sentinel-not-real";
    const session = "mt-session-sentinel-not-real";
    const twoFactorPassword = "two-factor-sentinel-not-real";
    const { path } = await temporarySecrets(`TELEGRAM_API_ID=123456\nTELEGRAM_API_HASH=${apiHash}`);
    const output: string[] = [];
    const answers = ["+15550000000", "12345", twoFactorPassword];
    const prompt = vi.fn(async (_question: string, _options?: { hidden?: boolean }) => answers.shift() ?? null);
    const client = makeClient({
      start: vi.fn(async (auth: { phoneNumber: () => Promise<string>; phoneCode: () => Promise<string>; password: (hint?: string) => Promise<string>; onError: (error: Error) => boolean }) => {
        expect(await auth.phoneNumber()).toBe("+15550000000");
        expect(await auth.phoneCode()).toBe("12345");
        expect(await auth.password("account hint")).toBe(twoFactorPassword);
      }),
      session: { save: () => session },
    });
    const createClient = vi.fn(() => client);

    const result = await runLogin({
      env: { PI_CARETAKER_SECRETS: path },
      prompt,
      createClient: mockClientFactory(createClient),
      output: (line: string) => output.push(line),
    });

    expect(result).toEqual({ cancelled: false });
    expect(prompt.mock.calls[2]?.[1]).toMatchObject({ hidden: true });
    expect(createClient).toHaveBeenCalledWith({ apiId: 123456, apiHash, session: "" });
    expect(await readFile(path, "utf8")).toContain(`TELEGRAM_MT_SESSION=${session}\n`);
    expect(client.checkAuthorization).toHaveBeenCalledOnce();
    expect(client.disconnect).toHaveBeenCalledOnce();
    for (const secret of [apiHash, session, twoFactorPassword]) {
      expect(output.join("\n")).not.toContain(secret);
    }
  });

  it("constructs the send request through the mocked GramJS client without echoing content or secrets", async () => {
    const apiHash = "api-hash-sentinel-not-real";
    const session = "mt-session-sentinel-not-real";
    const { path } = await temporarySecrets(`TELEGRAM_API_ID=123456\nTELEGRAM_API_HASH=${apiHash}\nTELEGRAM_MT_SESSION=${session}\n`);
    const client = makeClient();
    const createClient = vi.fn(() => client);
    const output: string[] = [];

    await runSend({
      args: ["manual", "test", "ping"],
      env: { PI_CARETAKER_SECRETS: path, TELEGRAM_TEST_BOT: "@target_bot" },
      createClient: mockClientFactory(createClient),
      output: (line: string) => output.push(line),
    });

    expect(createClient).toHaveBeenCalledWith({ apiId: 123456, apiHash, session });
    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.checkAuthorization).toHaveBeenCalledOnce();
    expect(client.getEntity).toHaveBeenCalledWith("@target_bot");
    expect(client.sendMessage).toHaveBeenCalledWith({ target: "@target_bot" }, { message: "manual test ping" });
    expect(output).toEqual(["sent chat_id=321 msg_id=654 text_len=16"]);
    expect(output.join("\n")).not.toContain("manual test ping");
    expect(output.join("\n")).not.toContain(apiHash);
    expect(output.join("\n")).not.toContain(session);
    expect(client.disconnect).toHaveBeenCalledOnce();
  });

  it("uses the default target and manual test text when send arguments are omitted", async () => {
    const { path } = await temporarySecrets("TELEGRAM_API_ID=123456\nTELEGRAM_API_HASH=api-hash-sentinel-not-real\nTELEGRAM_MT_SESSION=mt-session-sentinel-not-real\n");
    const client = makeClient();
    const output: string[] = [];

    await runSend({
      args: [],
      env: { PI_CARETAKER_SECRETS: path },
      createClient: mockClientFactory(() => client),
      output: (line: string) => output.push(line),
    });

    expect(client.getEntity).toHaveBeenCalledWith("@SarahTelegramBot");
    expect(client.sendMessage).toHaveBeenCalledWith({ target: "@SarahTelegramBot" }, { message: "manual test ping" });
    expect(output).toEqual(["sent chat_id=321 msg_id=654 text_len=16"]);
  });

  it("constructs the read request and redacts configured secrets from returned text", async () => {
    const apiHash = "api-hash-sentinel-not-real";
    const session = "mt-session-sentinel-not-real";
    const { path } = await temporarySecrets(`TELEGRAM_API_ID=123456\nTELEGRAM_API_HASH=${apiHash}\nTELEGRAM_MT_SESSION=${session}\n`);
    const client = makeClient({
      getMessages: vi.fn(async () => [
        { out: true, date: new Date("2026-01-02T03:04:05.000Z"), message: "hello\nthere" },
        { out: false, date: new Date("2026-01-02T03:05:05.000Z"), message: `echo ${session}` },
      ]),
    });
    const output: string[] = [];

    await runRead({
      args: ["2"],
      env: { PI_CARETAKER_SECRETS: path },
      createClient: mockClientFactory(() => client),
      output: (line: string) => output.push(line),
    });

    expect(client.getEntity).toHaveBeenCalledWith("@SarahTelegramBot");
    expect(client.getMessages).toHaveBeenCalledWith({ target: "@SarahTelegramBot" }, { limit: 2 });
    expect(output).toEqual([
      "[2026-01-02T03:04:05.000+00:00] you: hello there",
      "[2026-01-02T03:05:05.000+00:00] bot: echo [REDACTED]",
    ]);
    expect(output.join("\n")).not.toContain(session);
    expect(output.join("\n")).not.toContain(apiHash);
    expect(client.disconnect).toHaveBeenCalledOnce();
  });

  it("formats GramJS Unix-second timestamps as real dates", async () => {
    const { path } = await temporarySecrets("TELEGRAM_API_ID=123456\nTELEGRAM_API_HASH=api-hash-sentinel-not-real\nTELEGRAM_MT_SESSION=mt-session-sentinel-not-real\n");
    const client = makeClient({
      getMessages: vi.fn(async () => [{ out: false, date: 1793055499, message: "date check" }]),
    });
    const output: string[] = [];

    await runRead({
      args: ["1"],
      env: { PI_CARETAKER_SECRETS: path },
      createClient: mockClientFactory(() => client),
      output: (line: string) => output.push(line),
    });

    expect(output).toEqual(["[2026-10-26T22:58:19.000+00:00] bot: date check"]);
  });

  it("reports a revoked session clearly and disconnects without exposing it", async () => {
    const session = "mt-session-sentinel-not-real";
    const { path } = await temporarySecrets(`TELEGRAM_API_ID=123456\nTELEGRAM_API_HASH=api-hash-sentinel-not-real\nTELEGRAM_MT_SESSION=${session}\n`);
    const client = makeClient({ checkAuthorization: vi.fn(async () => false) });

    await expect(runSend({
      args: ["ping"],
      env: { PI_CARETAKER_SECRETS: path },
      createClient: mockClientFactory(() => client),
      output: () => undefined,
    })).rejects.toThrow("session not authorized (revoked?) — remove TELEGRAM_MT_SESSION from the secrets file, then re-run node scripts/manual-telegram/login.mjs");

    expect(client.sendMessage).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledOnce();
  });

  it("uses five messages by default when no read limit is provided", async () => {
    const { path } = await temporarySecrets("TELEGRAM_API_ID=123456\nTELEGRAM_API_HASH=api-hash-sentinel-not-real\nTELEGRAM_MT_SESSION=mt-session-sentinel-not-real\n");
    const client = makeClient();

    await runRead({
      args: [],
      env: { PI_CARETAKER_SECRETS: path },
      createClient: mockClientFactory(() => client),
      output: () => undefined,
    });

    expect(client.getMessages).toHaveBeenCalledWith({ target: "@SarahTelegramBot" }, { limit: 5 });
  });

  it("returns a clean cancel result when the terminal reaches EOF", async () => {
    const output = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    const prompt = createPrompt({ input: Readable.from([]), output });

    await expect(prompt("Phone: ")).resolves.toBeNull();
  });

  it("creates an owner-only secrets file when appending a session", async () => {
    const session = "mt-session-sentinel-not-real";
    const dir = await mkdtemp(join(tmpdir(), "pi-caretaker-manual-telegram-"));
    temporaryDirectories.push(dir);
    const path = join(dir, "secrets.env");

    await expect(appendSecret(path, "TELEGRAM_MT_SESSION", session)).resolves.toBeUndefined();

    expect(await readFile(path, "utf8")).toBe(`TELEGRAM_MT_SESSION=${session}\n`);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
});
