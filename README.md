# pi-caretaker

A native Pi extension for an always-on AI caretaker. External systems report
events through an HTTP webhook; Pi reasons about each event in the context of
its session and contacts you on Telegram only when attention is warranted.

**Product promise:** Connect your existing alert sources to one agent that
knows what matters to you, and talk to it from anywhere.

## Status: V1 scaffold

This repo currently holds the contract, not the implementation: zod envelope
schema, health shape, queue interface, Telegram adapter interface, triage
guidance draft, four binding ADRs, and the guard scripts. Stubs throw
`not implemented` until their tickets land. The full product reasoning lives
in the source concept: `docs/concept/pi-caretaker-high-level-concept-v3.md`.

## V1 scope

Include: authenticated `POST /events` + `GET /health`, in-memory queue with
sequential delivery into Pi, LLM triage with Telegram only on deliberate
notify, two-way Telegram conversation, Pi-native configuration.

Explicit non-goals (binding — see `AGENTS.md`): event persistence,
deterministic dedupe/correlation, dashboards, collectors, a database, and
automatic infrastructure changes. None of these land without an ADR.

## Install sketch

```bash
nvm use        # Node 22, see .nvmrc
pnpm install
pnpm check     # typecheck + lint + test
pnpm build     # dist/ via tsup
```

## Run it

Create a repo-root `secrets.env` containing `PI_CARETAKER_TOKEN=<your token>`
(generate one with `openssl rand -hex 24`). Operator environment variables take
precedence, and token values are never printed. `pnpm start` runs Pi under a
background supervisor and waits for `/health` before writing the pidfile and
printing the listener details. Use `pnpm start -- --foreground` for attached
interactive debugging, and stop the background service with `pnpm stop`. Output
is appended to `pi-caretaker.log` in the repository root. Trigger a fake
host-dark alert with
`pnpm send:alert [message]`. The listener defaults to `127.0.0.1:8787`; use
`PI_CARETAKER_HOST` and `PI_CARETAKER_PORT` to override it. Run `send:alert`
with the same environment as the listener (or no overrides); both scripts read
`secrets.env` themselves.

## The `202` honesty

`202 Accepted` means the event entered the **in-memory queue**. It does not
mean Pi processed it or Telegram delivered anything. Events may be lost on
restart. Unauthorized, invalid, oversized, or overloaded requests get real
error codes, never a fake 202. See `docs/decisions/0001-webhook-event-contract.md`.

## Security posture

Webhook token auth, body-size caps, untrusted-payload handling, least-privilege
SSH. Details and how to report issues: `SECURITY.md`. Threat model in short:
the webhook token, the untrusted payload, and the SSH capability — see
`SECURITY.md`.
