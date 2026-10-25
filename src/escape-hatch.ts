/**
 * Deterministic escape hatch (ADR-0004).
 *
 * "Must never be missed" alerts bypass triage and notify unconditionally,
 * without depending on the model deciding they matter. The mechanism below
 * is complete and tested; the owner vocabulary (which wire values canonically
 * mean host-dark and backups-dead, and which notification fields are safe)
 * is still open on ticket baac47cd, so MUST_NOTIFY_RULES ships EMPTY. An
 * empty list fails safe: everything flows to normal triage, nothing is
 * misclassified, and no silent notification path exists.
 */
import type { EventEnvelope } from "./events.js";

/** Minimal envelope view the hatch needs — never the instruction channel. */
export type EventEnvelopeLike = Pick<
  EventEnvelope,
  "message" | "source" | "host" | "severity" | "event" | "metadata" | "payload"
>;

/** The two ADR-approved alert classes. No third class without an ADR update. */
export type EscapeHatchKind = "host-dark" | "backups-dead";

export interface EscapeHatchRule {
  kind: EscapeHatchKind;
  match(envelope: EventEnvelopeLike): boolean;
}

/**
 * Owner-reviewed must-notify list. Empty until the owner vocabulary decision
 * lands (ticket baac47cd): no rule, no bypass, no misclassification.
 */
export const MUST_NOTIFY_RULES: readonly EscapeHatchRule[] = [];

export interface EscapeHatchMatch {
  kind: EscapeHatchKind;
  rule: EscapeHatchRule;
}

/** First matching rule wins; undefined when nothing matches. */
export function matchEscapeHatch(
  envelope: EventEnvelopeLike,
  rules: readonly EscapeHatchRule[] = MUST_NOTIFY_RULES,
): EscapeHatchMatch | undefined {
  for (const rule of rules) {
    if (rule.match(envelope)) return { kind: rule.kind, rule };
  }
  return undefined;
}

/**
 * Deterministic notification text. Deliberately excludes the untrusted
 * message body, metadata, and payload — those travel to triage as data, but
 * a notification that cannot depend on the model must not quote text the
 * model never vetted. Which reporter fields are safe to include is part of
 * the open owner decision; host/source stay out until it is answered.
 */
export function formatEscapeHatchNotification(
  match: EscapeHatchMatch,
  _envelope: EventEnvelopeLike,
): string {
  return `pi-caretaker escape hatch [${match.kind}]: a must-notify alert fired and bypassed triage. Investigate immediately.`;
}

export interface EscapeHatchRoute {
  bypassedTriage: boolean;
  kind?: EscapeHatchKind;
}

export type TriageContinuation = (
  envelope: EventEnvelopeLike,
) => Promise<void>;

/**
 * Check once before the model turn: on a match, notify exactly once and
 * never call the continuation; otherwise call it exactly once and send
 * nothing. A notify rejection propagates — no fallthrough to triage, no
 * claimed delivery, no retries.
 */
export async function routeEscapeHatch(
  envelope: EventEnvelopeLike,
  telegram: { notify(text: string): Promise<void> },
  rules: readonly EscapeHatchRule[],
  continueToTriage: TriageContinuation,
): Promise<EscapeHatchRoute> {
  const match = matchEscapeHatch(envelope, rules);
  if (match === undefined) {
    await continueToTriage(envelope);
    return { bypassedTriage: false };
  }
  await telegram.notify(formatEscapeHatchNotification(match, envelope));
  return { bypassedTriage: true, kind: match.kind };
}
