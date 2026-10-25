# Pi Caretaker — High-Level Concept

**Status:** Concept / MVP proposal  
**Updated:** 2026-10-25

## Vision

A tiny, self-hosted, always-on AI caretaker built as a **native Pi extension**. External systems report events through an HTTP webhook. Pi reasons about each event in the context of its ongoing session and user-defined preferences, and contacts the user on Telegram **only when it believes attention is warranted**. The user can reply freely, ask questions, investigate, and approve remedial actions.

**Product promise:** Connect your existing alert sources to one agent that knows what matters to you, and talk to it from anywhere.

## Design principles

- **Pi-native, not another agent framework.** Extend Pi instead of wrapping it in a separate application or building a custom reasoning loop.
- **One simple event API.** Consumers can be Netdata, application services, scripts, uptime monitors, or other systems.
- **LLM-driven triage in V1.** No separate classifier, deterministic deduplication, incident engine, or event database. Pi decides whether an incoming event merits a notification by examining the event and accessible conversation context.
- **One Telegram conversation.** Chat freely with the same caretaker that receives background alerts; events are not automatically posted to Telegram.
- **Single central instance, multiple monitored servers.** Other servers send webhooks; Pi only runs centrally.
- **Minimal deployment.** Install the extension in a long-running Pi runtime; optionally distribute a Docker image with everything configured.
- **Safe by default.** Webhook content is untrusted data, not authorization to execute instructions. Infrastructure changes require explicit user approval.

## Architecture

```text
                 Server A                         Server B
          Netdata / apps / cron            Netdata / apps / cron
                   |                                |
                   +---------- HTTPS --------------+
                                      |
                               POST /events
                                      |
                   +---------------------------------------+
                   |  Pi Caretaker (one Pi process)         |
                   |                                       |
                   |  pi-caretaker extension               |
                   |    - authenticated HTTP listener     |
                   |    - small in-memory input queue     |
                   |    - background event → agent turn    |
                   |                                       |
                   |  Persistent Pi session                |
                   |    - model + instructions + tools     |
                   |    - reason whether to notify         |
                   |                                       |
                   |  Telegram integration (Pitgram*)      |
                   +-------------------+-------------------+
                                       |
                              Telegram bot/chat
                                       |
                                 User replies

          Optional: Pi uses restricted SSH to inspect Server A/B
```

*Pitgram is the preferred existing extension to evaluate, **not yet confirmed end-to-end** for silent webhook-triggered turns sharing the correct Telegram session. If incompatible, use a minimal Telegram adapter, potentially built with grammY.*

## Core event flow

1. A source detects something of interest and calls `POST /events`.
2. The Pi extension authenticates and validates the request, then places it in a small in-memory queue.
3. When Pi is available, the extension submits the event as a **background agent turn**, with trusted instructions to assess whether the user needs attention.
4. Pi can consider prior session context and available diagnostic tools. It may decide the event is unimportant or repetitive and send **nothing**.
5. If important, Pi explicitly invokes a Telegram notification tool/integration.
6. The user replies in Telegram and can discuss the incident in the same ongoing Pi session. Optional SSH tools support investigation and, with approval, changes.

**Important:** Hiding a message in the Pi terminal UI is not, by itself, proof that Telegram stays silent. The actual Telegram extension must be tested to ensure background turns do not automatically relay agent output. Webhook and Telegram turns must also be serialized to prevent session contention.

## HTTP API (MVP)

### `POST /events`

Authenticated with a bearer token. Only `message` is required; all other fields provide optional context.

```http
POST /events
Authorization: Bearer <API_TOKEN>
Content-Type: application/json
```

Minimal example:

```json
{
  "message": "Production server memory usage reached 92%"
}
```

More descriptive example:

```json
{
  "source": "netdata",
  "host": "server-b",
  "severity": "warning",
  "event": "memory_pressure",
  "message": "Memory usage reached 92%",
  "metadata": {
    "used_percent": 92,
    "available_mb": 512
  }
}
```

Accept an optional `payload` object when forwarding an external system's native webhook data. Integrations that cannot produce the expected envelope may need a small adapter. Severity is source-reported context; Pi decides what warrants attention.

**Response:** `202 Accepted` means the event entered the **in-memory** queue, not that Pi processed it or Telegram delivered anything. Events may be lost during a crash/restart in V1. Reject unauthorized, invalid, oversized, or overloaded requests with appropriate HTTP errors rather than claiming they were accepted.

### `GET /health`

```json
{
  "status": "ok",
  "version": "0.1.0",
  "commit": "a3f82c1"
}
```

- `version` comes from the built package/release.
- `commit` is the deployed Git commit SHA, injected at build time; example value above is illustrative.
- Health reflects the listener's basic health, not proof that the LLM provider or Telegram is reachable. Deeper readiness checks can be added later.

## Telegram interaction

Telegram is the caretaker's human-facing interface. Telegram-originated messages get conversational responses. Background webhook events do **not** appear automatically. Only deliberate notifications appear after Pi chooses to send one.

Example:

```text
[Webhook arrives silently] server-b: PostgreSQL restarted unexpectedly
[Pi evaluates event and session context]

Bot: PostgreSQL restarted unexpectedly on server-b. This could
     affect availability. Want me to investigate?

You: Yes, check the logs and recent memory usage.

Bot: [uses permitted diagnostic tools and reports findings]
```

Prefer **one persistent Pi session** for the personal single-user MVP, allowing alerts and conversation to share context. This is a target design, not a guarantee of a third-party Telegram extension. Session switching, restarts, compaction, and concurrent inputs must be tested. A multi-user product would require separate ownership and isolation rules.

## Multi-server deployment

- **Server A:** Run Pi + `pi-caretaker` + Telegram integration in a container; Server A can also run its own monitoring sources.
- **Server B, C, ...:** Run whatever monitoring already exists (e.g., Netdata) and configure notifications to call the central API. No Pi or bespoke collector required on remote machines.
- **Connectivity:** Prefer private networking (such as Tailscale) or authenticated HTTPS, with restrictive firewall rules. Do not expose Pi's agent-control internals.
- **Optional remediation:** Configure per-host, least-privilege SSH access from the central Pi runtime. Read-only diagnostics by default; obtain confirmation before disruptive or destructive actions.
- **Failure mode:** If the central host is unavailable, it cannot report its own outage. An independent heartbeat monitor is a future option.

## V1 scope

**Include:**

- Native Pi extension with an authenticated HTTP listener.
- `POST /events` and `GET /health` (version and commit included).
- Minimal in-memory event queue, sequential delivery into Pi.
- Bundled agent guidance: triage for real operational importance, consider previous context, suppress unnecessary Telegram messages.
- Telegram two-way conversation and explicit proactive notifications (reuse Pitgram if validated).
- Configurable LLM endpoint/model/key via Pi.
- Docker distribution with persistent Pi state and restart policy.
- Basic safeguards: webhook authentication, body-size limits, input validation, request throttling, and limits on automatic agent work.

**Explicitly exclude from V1:** Dedicated event persistence, deterministic deduplication, Jev, a custom correlation engine, OTel, dashboards, collectors, a dedicated database, and automatic infrastructure changes.

## Reliability and cost expectations

- LLM reasoning happens for admitted events, **including duplicates**. Pi may suppress repeat *notifications*, but cannot guarantee deduplication or bounded token use through prompting alone.
- Use basic bounded queue length and rate limits so a noisy sender cannot overwhelm the process or run up unlimited model costs.
- A single active Pi session should process external events and Telegram input in order, without competing concurrent turns.
- Persist the Pi session and extension configuration on a Docker volume. The in-memory event queue is intentionally **not** crash-durable.
- If the LLM or Telegram fails, surface health/log errors; don't claim successful delivery. Durable retries are an optional later enhancement.
- Treat webhook content as untrusted data even when authenticated; never interpret its text as privileged instructions.

## Existing software to evaluate

- **Pi:** https://github.com/badlogic/pi-mono — agent runtime, extensions, model configuration, session support.
- **Pitgram:** https://github.com/raghavbali/pitgram — preferred candidate for two-way Telegram and proactive notifications; integration with silent webhook turns still needs validation.
- **pi-telegram-plus:** https://github.com/jalyfeng/pi-telegram-plus — alternative Telegram integration.
- **grammY:** https://grammy.dev/ — fallback if the Pi-native Telegram integrations cannot satisfy the shared-session behavior.
- **Netdata:** https://www.netdata.cloud/ — example monitoring source; its webhook/script capability may need adapter-specific configuration.

## Early proof-of-concept tests (before committing to Pitgram)

1. Run Pi persistently with `pi-caretaker` and Pitgram loaded.
2. Trigger a Pi turn from a local webhook and ensure the agent receives the event.
3. Verify **no Telegram output** occurs when Pi decides not to notify.
4. Trigger an explicit proactive Telegram notification and verify delivery.
5. Reply in Telegram and confirm the agent retains the background event's context.
6. Deliver several webhooks while Pi is busy and verify sequential handling alongside Telegram messages.
7. Restart the Pi container and confirm session recovery, with documented loss of any unprocessed in-memory events.
8. Confirm request authentication, overload behavior, notification permissions, and approval before host-changing actions.

If Pitgram does not support the needed interactions, retain the Pi-native webhook extension and implement the smallest possible Telegram bridge instead. Do not introduce a full external RPC service unless these extension-level constraints make it necessary.

## Potential evolution (only when needed)

Durable ingestion, better deduplication, event history search, richer source integrations, multiple Telegram users, explicit notification policies, spending telemetry, and optional specialized classification can all be introduced later based on usage.

**Bottom line:** One Pi runtime, one small native webhook extension, one Telegram integration, and any number of systems posting events. The agent—not a bespoke triage platform—decides what deserves attention.
