import { describe, expect, it } from "vitest";
import { createTelegramAdapter } from "../../src/telegram/grammy.js";

/**
 * Tier 5 — live e2e: real network, real credentials, real Telegram.
 *
 * Never runs in `pnpm test` or `pnpm check` (separate vitest config), because
 * a flaky third party must not be able to block a commit. Sourced from the
 * proof-of-concept list in docs/concept/pi-caretaker-high-level-concept-v3.md.
 * The Pitgram verdict is recorded: rejected by owner decision, direct
 * grammY per ADR-0007 — which unblocked turning these green one by one.
 */
describe("live caretaker (network + credentials)", () => {
  it.todo(
    "vibeflow POSTs a real envelope to the local listener and receives 202",
  );

  it.todo("a background webhook turn produces no Telegram output at all");

  it("an explicit proactive notification reaches the Telegram chat", async () => {
    const botToken = process.env["PI_CARETAKER_TELEGRAM_BOT_TOKEN"];
    const chatId = process.env["PI_CARETAKER_TELEGRAM_CHAT_ID"];
    expect(botToken, "live: set PI_CARETAKER_TELEGRAM_BOT_TOKEN").toBeTruthy();
    expect(chatId, "live: set PI_CARETAKER_TELEGRAM_CHAT_ID").toBeTruthy();

    // Real adapter, real network: getMe validates the token, notify sends
    // through the single owned path. No polling here — delivery proof only.
    const adapter = await createTelegramAdapter({
      botToken: botToken as string,
      chatId: chatId as string,
    });
    try {
      await adapter.notify(
        "pi-caretaker live ping — adapter notify path OK, please ignore",
      );
    } finally {
      await adapter.stop();
    }
    expect(adapter.getLastError()).toBeUndefined();
  });

  it.todo("a Telegram reply is answered with the background event's context");

  it.todo("several webhooks during a busy turn are handled sequentially");

  it.todo("a restart recovers the session and loses only queued events");
});
