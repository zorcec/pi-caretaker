import { describe, expect, it } from "vitest";
import {
  clearInboundMessageStates,
  markInboundMessageActive,
  MAX_TRACKED_INBOUND_MESSAGE_IDS,
  rememberInboundMessageState,
  type InboundMessagePhase,
} from "../src/inbound-message-state.js";

describe("inbound message state", () => {
  it("marks a tracked pending id active and clears state", () => {
    const states = new Map<number, InboundMessagePhase>();
    rememberInboundMessageState(states, 41, "pending");

    markInboundMessageActive(states, 41);

    expect(states.get(41)).toBe("active");
    clearInboundMessageStates(states);
    expect(states.size).toBe(0);
  });

  it("caps tracked ids at 32 and evicts the oldest", () => {
    const states = new Map<number, InboundMessagePhase>();
    for (let messageId = 1; messageId <= MAX_TRACKED_INBOUND_MESSAGE_IDS + 1; messageId += 1) {
      rememberInboundMessageState(states, messageId, "pending");
    }

    expect(states.size).toBe(32);
    expect(states.has(1)).toBe(false);
    expect(states.get(2)).toBe("pending");
    expect(states.get(33)).toBe("pending");
  });
});
