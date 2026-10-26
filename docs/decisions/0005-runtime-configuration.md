# ADR-0005: Runtime configuration contract
- Status: accepted · Date: 2026-10-25 · Decided by: owner
## Decision
The caretaker reads six environment variables, validated at startup on
`session_start`: `PI_CARETAKER_TOKEN` (required bearer token, no default),
`PI_CARETAKER_HOST` (default 127.0.0.1), `PI_CARETAKER_PORT` (default 8787,
0 allowed for tests), `PI_CARETAKER_ALERTS_QUEUE_CAPACITY` (default 100,
positive integer), plus the optional Telegram pair
`PI_CARETAKER_TELEGRAM_BOT_TOKEN` / `PI_CARETAKER_TELEGRAM_CHAT_ID`
(required together, no defaults; absent pair means triage-only mode), and
`PI_CARETAKER_THINKING` (default `low`; one of off, minimal, low,
medium, high, xhigh, max).
Invalid values fail loudly with `MISSING_WEBHOOK_TOKEN`, `INVALID_PORT`,
`INVALID_QUEUE_CAPACITY`, `MISSING_TELEGRAM_BOT_TOKEN`, or
`MISSING_TELEGRAM_CHAT_ID`; values never appear in errors or logs.
## Why
Secrets stay out of files (repo rule: no `.env`, ever), so env is the only
channel. Defaults make the zero-config path the normal path — most
installations never set anything but the token, and the 100-event default
plus 503 backpressure is the automatic overload protection. Loud failure
beats a silently misconfigured listener that looks alive but admits nothing.
## Consequence
Renaming a key touches `src/config.ts` plus `tests/config.test.ts` only.
New keys, changed requiredness, or changed defaults update this ADR in the
same change, or supersede it.
## Pins
- `tests/config.test.ts`
