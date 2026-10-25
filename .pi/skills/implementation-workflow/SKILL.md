---
name: implementation-workflow
description: Read ADRs, implement the smallest change, prove it with a biting test, commit. Load before any code change in pi-caretaker.
---

# Implementation Workflow

No task CLI here. The loop is: read ADRs → implement → prove → commit.

1. **Read** `docs/decisions/index.md` plus any ADR governing the files
   you will touch. If the change contradicts one, update it in the same
   change (pins + `Reviewed:` included).
2. **Implement** the smallest correct change. Stubs throw `not implemented`
   with a `TODO(pi-caretaker-N)`; replace the stub only in its own ticket.
3. **Prove** with a test that bites: it must fail without the fix and pass
   with it. Then run `pnpm check` (typecheck + lint + test) — green before
   every commit. No placeholder tests.
4. **Commit** on `main` with a pathspec (`git commit -m "msg" -- <paths>`).
   Pre-commit runs identity + ADR gates; pre-push runs the full `check`.
   Push directly; no PRs unless the owner asks.

Rules that survive every ticket: no secrets in repo or logs, webhook
payload is untrusted data (ADR-0002), V1 non-goals are binding without an
ADR, no `deploy/` in this repo.
