import { describe, expect, it } from "vitest";
import type {
  TelegramAdapter,
  TelegramMessageHandler,
} from "../src/telegram/index.js";

// Pins ADR-0003: this project owns the one Telegram conversation.
describe("one telegram path", () => {
  it("adapter interface carries exactly notify + onMessage", async () => {
    // Type-level proof the contract is implementable with the right shapes.
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
    // A second notifier starts as an extra runtime export. Until the adapter
    // ticket lands, this module must stay type-only: zero runtime keys.
    const ns = await import("../src/telegram/index.js");
    expect(Object.keys(ns)).toEqual([]);
  });
});
