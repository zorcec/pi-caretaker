import { describe, expect, it } from "vitest";
import {
  MAX_EVENT_BODY_BYTES,
  eventEnvelopeSchema,
  isBodyOversized,
} from "../src/events.js";

// Pins ADR-0001: the webhook event contract. Every case below must bite —
// each asserts behavior a wrong contract would break.
describe("event envelope contract", () => {
  it("accepts the minimal body: message only", () => {
    const parsed = eventEnvelopeSchema.safeParse({
      message: "Production server memory usage reached 92%",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.message).toBe(
        "Production server memory usage reached 92%",
      );
      expect(parsed.data.severity).toBeUndefined();
    }
  });

  it("accepts the descriptive body from the concept", () => {
    const parsed = eventEnvelopeSchema.safeParse({
      source: "netdata",
      host: "server-b",
      severity: "warning",
      event: "memory_pressure",
      message: "Memory usage reached 92%",
      metadata: { used_percent: 92, available_mb: 512 },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a forwarded native payload object", () => {
    const parsed = eventEnvelopeSchema.safeParse({
      message: "alert from external system",
      payload: { native: { id: 7, tags: ["a", "b"] } },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a missing message", () => {
    expect(eventEnvelopeSchema.safeParse({ host: "server-b" }).success).toBe(
      false,
    );
    expect(eventEnvelopeSchema.safeParse({ message: "" }).success).toBe(false);
  });

  it("rejects an unknown severity instead of accepting it", () => {
    expect(
      eventEnvelopeSchema.safeParse({ message: "x", severity: "urgent" })
        .success,
    ).toBe(false);
  });

  it("rejects oversized bodies at the cap boundary", () => {
    expect(isBodyOversized(MAX_EVENT_BODY_BYTES)).toBe(false);
    expect(isBodyOversized(MAX_EVENT_BODY_BYTES + 1)).toBe(true);
    // A real oversized envelope must fail the size gate, not sneak through.
    const big = { message: "x".repeat(MAX_EVENT_BODY_BYTES + 1) };
    expect(isBodyOversized(Buffer.byteLength(JSON.stringify(big)))).toBe(true);
  });
});
