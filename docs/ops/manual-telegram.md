# Manual Telegram tooling

These scripts provide a one-off operator check of Telegram MTProto using GramJS.
They are separate from the caretaker runtime: `src/` never reads the operator
secrets file, and the caretaker continues to use its process environment as
described in [ADR-0005](../decisions/0005-runtime-configuration.md).

## Install

Use Node 22 and pnpm, then install the repository dependencies from its root:

```sh
pnpm install
```

The GramJS npm package is named `telegram`; it is a development dependency used
only by the manual scripts. The production extension does not import it.

## Prepare private configuration

The default file is the operator-owned, gitignored repository-root
`secrets.env`. Create it with owner-only permissions, then use a local editor
to add these keys (values are intentionally not shown here):

- `TELEGRAM_API_ID` — numeric API ID from the operator's Telegram application.
- `TELEGRAM_API_HASH` — API hash from that application.

The login script appends `TELEGRAM_MT_SESSION` after a successful login. Never
commit `secrets.env`, paste its contents into chat, or copy any of its values
into documentation, examples, fixtures, command arguments, or logs. The
`PI_CARETAKER_SECRETS` environment variable can point the scripts at a different
private file when needed; keep that file private as well.

## First login

Run this interactively in a terminal from the repository root:

```sh
node scripts/manual-telegram/login.mjs
```

Enter the phone number and the Telegram-delivered login code when prompted. If
two-step verification is enabled, the password prompt is hidden. End-of-file or
empty input cancels without writing a session. On success, the session is
appended to `secrets.env`; its value is never displayed. The script refuses to
mint another session while a non-empty `TELEGRAM_MT_SESSION` is present.

## Send and read

Send a message to the default target (`@SarahTelegramBot`):

```sh
node scripts/manual-telegram/send.mjs "manual test ping"
```

Read the last five messages, or pass a non-negative limit as the first argument:

```sh
node scripts/manual-telegram/read.mjs 5
```

Both scripts check that the stored session is authorized before making a
request. To use another target, set `TELEGRAM_TEST_BOT` in the invoking shell.
The send script prints message identifiers and text length, not the message
body. The read script prints recent message text but redacts configured secret
values before writing output.

## Revoke and remove a session

To revoke the MTProto session, open Telegram's **Settings → Devices** (the
active sessions list), identify the session used by this operator tool, and
terminate that session. Then remove the `TELEGRAM_MT_SESSION` line from the
local `secrets.env` file. Do not remove other configuration lines unless you
intend to remove those settings too. Only after revocation and local removal
will the login script mint a replacement session. A revoked or expired session
causes send/read to report that login must be repeated.

The stored session lives only in the private secrets file (repository-root
`secrets.env` by default); it is not stored in the Pi session, caretaker
configuration, or tracked source.
