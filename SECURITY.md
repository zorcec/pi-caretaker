# Security policy

## How to report

Do not open a public issue for a suspected vulnerability. Contact the owner
directly (see the git history / package author for the current address) with
a description, reproduction steps, and the commit you tested. Expect an
acknowledgment within a few days; fixes ship as patch releases with a
CHANGELOG entry.

## Threat model

1. **Webhook token.** The bearer token on `POST /events` is the only thing
   standing between the internet and your agent's attention (and your LLM
   bill). Rotate it like a password, scope firewall rules to known senders
   (Tailscale or allowlisted IPs preferred), and never log the token.
2. **Untrusted payload.** Authenticated senders can still be compromised, and
   webhook text may be attacker-shaped. Payload content is data, never
   instructions (ADR-0002). It must never authorize actions or reach logs
   unredacted where secrets could hide. Known V1 limitation (ADR-0004): the
   triage model can technically use the shared-workspace `PI_CARETAKER_TOKEN`
   to self-trigger an approved escape-hatch notification; this is accepted as
   noise/self-verification for one owner, with token isolation and provenance
   deferred until before multi-owner/tenant or untrusted-workspace use, or
   before notifications gain side effects beyond alerting that owner.
3. **SSH capability.** The optional diagnostic SSH from the central Pi host to
   monitored machines is the most powerful thing in the design. Read-only by
   default, per-host least-privilege keys, and explicit owner approval before
   anything disruptive. A compromised webhook must never be able to escalate
   into SSH on its own.

## Out of scope for reports

Lost in-memory queue contents on restart (documented V1 behavior, ADR-0001),
and LLM-judgment quality (triage misses that are not security bypasses).
