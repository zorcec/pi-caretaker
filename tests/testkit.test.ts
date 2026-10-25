import { describe, expect, it } from "vitest";
import {
  createRecordingTelegram,
  createStubTriageLlm,
} from "./setup/doubles.js";

// The e2e tiers assert against these doubles, so the doubles themselves need a
// pin: a broken recorder would silently turn every "no notification was sent"
// assertion into a pass. This is the harness's own red->green proof.
describe("test doubles", () => {
  describe("recording Telegram adapter", () => {
    it("starts silent — no notification exists until the code under test sends one", () => {
      const telegram = createRecordingTelegram();
      expect(telegram.notifies).toHaveLength(0);
      expect(telegram.hasHandler()).toBe(false);
    });

    it("records every notify in arrival order", async () => {
      const telegram = createRecordingTelegram();
      await telegram.notify("first");
      await telegram.notify("second");
      expect(telegram.notifies.map((n) => n.text)).toEqual([
        "first",
        "second",
      ]);
      expect(telegram.notifies.every((n) => n.at > 0)).toBe(true);
    });

    it("delivers inbound messages to the registered handler", () => {
      const telegram = createRecordingTelegram();
      const seen: string[] = [];
      telegram.onMessage((text) => seen.push(text));

      telegram.deliver("investigate the logs");

      expect(seen).toEqual(["investigate the logs"]);
      expect(telegram.received).toEqual(["investigate the logs"]);
      expect(telegram.hasHandler()).toBe(true);
    });

    it("refuses a second handler — one conversation, one owner of it", () => {
      const telegram = createRecordingTelegram();
      telegram.onMessage(() => undefined);
      expect(() => telegram.onMessage(() => undefined)).toThrow(
        /second Telegram message handler/,
      );
    });

    it("refuses to deliver before a handler exists instead of losing the message", () => {
      const telegram = createRecordingTelegram();
      expect(() => telegram.deliver("orphaned")).toThrow(/before onMessage/);
    });
  });

  describe("stub triage model", () => {
    it("defaults to silence — an unconfigured stub cannot notify", async () => {
      const llm = createStubTriageLlm();
      expect(await llm.triage({ eventText: "anything" })).toEqual({
        notify: false,
      });
      expect(llm.requests).toHaveLength(1);
    });

    it("returns the configured decision and records each request verbatim", async () => {
      const llm = createStubTriageLlm({ notify: true, text: "host dark" });
      const request = { eventText: "server-b went dark", trustedInstructions: "fixed" };

      expect(await llm.triage(request)).toEqual({
        notify: true,
        text: "host dark",
      });
      expect(llm.requests).toEqual([request]);
    });
  });
});
