/**
 * Deterministic escape hatch (ADR-0004).
 *
 * "Must never be missed" alerts bypass triage and notify unconditionally,
 * without depending on the model deciding they matter. Matching is
 * deliberately dumb substring matching over the `event` type and `message`
 * text (lowercased) — no model, no regexes, no semantic judgment.
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
 * Canonical v1 vocabulary for host-dark (ADR-0004).
 *
 * Exactly the ADR's own wording plus mechanical slug variants
 * (space/hyphen/underscore forms). Deliberately NOT included: vaguer
 * phrases like "host unreachable" or "host down", which describe different
 * alert semantics (often flapping monitors) — the owner can promote them
 * with an ADR-0004 update.
 */
export const HOST_DARK_PATTERNS: readonly string[] = [
  "host gone dark",
  "host is dark",
  "host_dark",
  "host-dark",
  "hostdown",
  "host_down",
];

/**
 * Canonical v1 vocabulary for backups-dead (ADR-0004). Same policy as
 * above: ADR wording plus mechanical variants, singular and plural.
 */
export const BACKUPS_DEAD_PATTERNS: readonly string[] = [
  "backups dead",
  "backup dead",
  "backups-dead",
  "backup-dead",
  "backups_dead",
  "backup_dead",
];

function haystack(envelope: EventEnvelopeLike): string {
  return `${envelope.event ?? ""}\n${envelope.message}`.toLowerCase();
}

function includesAny(text: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

/**
 * Owner-reviewed must-notify list: the two ADR-0004 classes with the
 * canonical v1 vocabulary above. Everything else flows to normal triage.
 * Narrowing needs no ADR; broadening the vocabulary (new phrases, new
 * fields, new classes) needs an ADR-0004 update first.
 */
export const MUST_NOTIFY_RULES: readonly EscapeHatchRule[] = [
  {
    kind: "host-dark",
    match: (envelope) =>
      includesAny(haystack(envelope), HOST_DARK_PATTERNS),
  },
  {
    kind: "backups-dead",
    match: (envelope) =>
      includesAny(haystack(envelope), BACKUPS_DEAD_PATTERNS),
  },
];

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

/** Result of routing an event through the deterministic bypass. */
export interface EscapeHatchRoute {
  bypassedTriage: boolean;
  kind?: EscapeHatchKind;
}

/** Continue ordinary or unconfigured events through triage. */
export type TriageContinuation = (
  envelope: EventEnvelopeLike,
) => Promise<void>;

/**
 * Check once before the model turn: on a configured match, notify exactly
 * once and never call the continuation; otherwise call it exactly once and
 * send nothing. A notify rejection propagates for the delivery pump to retry.
 * Without a configured transport, matched events continue through triage.
 */
export async function routeEscapeHatch(
  envelope: EventEnvelopeLike,
  telegram: { notify(text: string): Promise<void> } | undefined,
  rules: readonly EscapeHatchRule[],
  continueToTriage: TriageContinuation,
): Promise<EscapeHatchRoute> {
  const match = matchEscapeHatch(envelope, rules);
  if (match === undefined || telegram === undefined) {
    await continueToTriage(envelope);
    return { bypassedTriage: false };
  }
  await telegram.notify(formatEscapeHatchNotification(match, envelope));
  return { bypassedTriage: true, kind: match.kind };
}
