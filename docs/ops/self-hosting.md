# Self-hosting behavior (V1)

This page describes what a self-hoster's container must DO. It is behavior,
not config: there is no `deploy/` directory and no Dockerfile in this repo by
decision (see AGENTS.md). Deployment config lives outside.

## Restart policy

The container must restart on failure and on host reboot (e.g. Docker
`restart: unless-stopped` or the equivalent in your runtime). Pi is meant to
be always on: a caretaker that stays down after a power cut is not a
caretaker. On restart, expect the Pi session to recover and any unprocessed
in-memory events to be gone — that loss is documented, not a bug (ADR-0001).

## Persistent volume for the Pi session

Mount a persistent volume for Pi's session state and the extension
configuration (tokens, Telegram session, model settings). Without it, every
restart looks like a fresh install: the agent loses conversation context,
the Telegram session must be re-linked, and secrets must be re-entered.

What persists on the volume: session history, extension configuration,
credentials. What must NEVER be assumed durable: the event queue (below).

## Why the queue is NOT crash-durable

The V1 queue is in-memory by design. A `202` means "queued", not "safe".
Crash or restart drops whatever Pi had not yet turned into an agent turn.
Do not bolt on a sidecar database or a write-ahead log to "fix" this — that
is durable ingestion, an explicit V1 non-goal. If loss becomes unacceptable,
promote it through an ADR first.

## Networking posture

Prefer private connectivity (Tailscale) or authenticated HTTPS behind
restrictive firewall rules. Expose only the webhook listener port — never
Pi's agent-control internals. See `SECURITY.md` for the token, payload, and
SSH threat model.
