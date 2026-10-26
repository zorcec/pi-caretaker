/** ADR-0003, ADR-0006: bounded receipt state for queued owner relay messages. */
export const MAX_TRACKED_INBOUND_MESSAGE_IDS = 32;

export type InboundMessagePhase = "pending" | "active";

export function rememberInboundMessageState(
  states: Map<number, InboundMessagePhase>,
  messageId: number,
  phase: InboundMessagePhase,
): void {
  states.set(messageId, phase);
  while (states.size > MAX_TRACKED_INBOUND_MESSAGE_IDS) {
    const oldestId = states.keys().next().value;
    if (oldestId === undefined) return;
    states.delete(oldestId);
  }
}

export function markInboundMessageActive(
  states: Map<number, InboundMessagePhase>,
  messageId: number,
): void {
  if (states.has(messageId)) states.set(messageId, "active");
}

export function clearInboundMessageStates(
  states: Map<number, InboundMessagePhase>,
): void {
  states.clear();
}
