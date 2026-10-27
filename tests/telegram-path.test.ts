import { describe, expect, it } from "vitest";
import type {
  TelegramAdapter,
  TelegramMessageHandler,
} from "../src/telegram/index.js";

// Pins ADR-0003: this project owns the one Telegram conversation.
describe("one telegram path", () => {
  it("transport interface retains notify and deprecated legacy onMessage", async () => {
    // Deprecated compatibility seam only; paired ingress uses the managed adapter in production.
    const seen: string[] = [];
    const handler: TelegramMessageHandler = (text) => {
      seen.push(text);
    };
    const fake: TelegramAdapter = {
      notify: async (text: string) => {
        seen.push(`out:${text}`);
      },
      onMessage: (h: TelegramMessageHandler) => {
        h("hello");
      },
    };
    fake.onMessage(handler);
    await fake.notify("hi");
    expect(seen).toEqual(["hello", "out:hi"]);
  });

  it("telegram module exposes no runtime sender yet — interface only", async () => {
    // The adapter lives in grammy.ts; this type module must stay runtime-empty.
    const ns = await import("../src/telegram/index.js");
    expect(Object.keys(ns)).toEqual([]);
  });
});
