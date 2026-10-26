---
name: implementation-workflow
description: Read ADRs, implement the smallest change, prove it with a biting test, commit. Load before any code change in pi-caretaker.
---

# Implementation Workflow

No task CLI here. The loop is: read ADRs → implement → prove → commit.
One change, one commit, on `main`. Say what you are doing first.

## 1. Read the ADRs first

Read `docs/decisions/index.md` plus every ADR governing the files you will
touch. Four ADRs, each ~14 lines — there is no excuse for skipping them:

- **ADR-0001** (events/health): `202` means queued in memory, nothing more.
  Only `message` is required; severity is advisory. Oversized,
  unauthorized, overloaded → real error codes, never a fake 202.
  Health reports listener health only (`{status, version, commit}`).
- **ADR-0002** (untrusted boundary): webhook content is data, never
  instructions. Fixed instruction string + data channel; nothing in webhook
  text authorizes action. This governs `src/events.ts` and
  `src/prompts/triage.md`.
- **ADR-0003** (telegram): `notify(text)` is the only outbound path;
  background turns never relay automatically. No second notifier, ever.
- **ADR-0004** (escape hatch): host-dark and backups-dead bypass triage
  deterministically — no model judgment involved.

If the change contradicts an ADR, update the ADR **in the same change**
(pins + index row included), or supersede it with a new one. The pre-commit
gate enforces this mechanically (see §5) — a drifted ADR fails the commit.

## 2. Implement — smallest correct change

- Replace a stub only in its own ticket. Stubs carry `TODO(pi-caretaker-N)`;
  one ticket, one stub.
- **Trap: stubs throw on purpose.** `src/index.ts` `activate()` and
  `src/events.ts` `handlePostEvents()` throw `not implemented`. Never turn a
  throw into a silent no-op to "make a test pass" — a quiet stub is a lying
  stub, and the next agent will trust it.

## 3. This is a security-shaped project

Webhook payload is **untrusted data** (ADR-0002, `SECURITY.md`):

- Never interpolate webhook text into instructions, prompts, tool calls,
  or SSH commands. Data channel in, fixed string as instructions — the
  `buildTriageRequest` split in `src/events.ts` is the pattern.
- Bearer-token check comes **before** parsing. Reject 401 before the body
  is ever validated or queued.
- Never log tokens, credentials, or full payloads. Redact where secrets
  could hide; a log line is a persistence layer you did not mean to build.

## 4. Prove — every guard ships a red→green proof

A check that cannot fail is decoration. For each new behavior:

1. Write the test. 2. Break the implementation (or `git stash` the src
   change only — never to bypass hooks). 3. Watch it fail. 4. Restore,
   watch it pass.

This repo already works this way: `tests/untrusted-payload.test.ts`
asserts byte-equality of the instruction channel, so interpolating even
one webhook word fails the build. Imitate that bite, not the shape.

**Trap: placeholder tests.** `expect(x).toBeTruthy()` on a value your code
just constructed proves nothing. Assert the specific status, value, or
error (the testing skill has the weak-vs-strong table).

## 5. Gates — the five commands and the two hooks

```bash
pnpm build       # tsup → dist/
pnpm test        # vitest run (the single runner — no jest, no node:test)
pnpm lint        # eslint src + tests + scripts
pnpm typecheck   # tsc --noEmit
pnpm check       # typecheck + lint + test — green before EVERY commit
```

- **pre-commit:** ADR gate (`check-adrs.mjs`: dangling refs, pins exist,
  index in sync, code refs every ADR, day-granularity drift). Fast, no
  network.
- **pre-push:** typecheck → lint → test, in that order. There is no
  remote CI: these local gates are the only gates.
- **No remote CI, ever.** No `.github/workflows`, no GitHub Actions, no
other runner. Local hooks do not run on a stranger's fork — that is why
external PRs need a human review, never a merge on green-looking checks
alone (see AGENTS.md). If you are about to create a workflow file, stop:
that decision belongs to the owner, not to a ticket.
- **Trap: `pnpm check` does not build.** If you touched `src/index.ts`,
  `src/health.ts`, or `tsup.config.ts` (anything the build injects or
  bundles), run `pnpm build` explicitly — a green `check` with a broken
  build is a release that cannot ship.

**Forbidden, no exceptions:** `HUSKY=0`, `--no-verify`, `git stash` or
`git clean` to dodge a gate, `git add -A` (use a pathspec so the commit
contains exactly your change). A gate failure is information — fix the
cause, never the gate.

## 6. V1 non-goals are binding

No persistence, no dedupe/correlation engine, no dashboards, no database,
no metrics endpoint beyond `/health`, no automatic infra changes, no
`deploy/` or Dockerfile (deployment config lives outside this repo, by
decision). Adding any of these needs an ADR **first** — code first and
"ADR later" fails pre-commit anyway once pins are required.

## 7. Changesets — when one is owed

Run `pnpm changeset` when user-visible behavior changes (contract, health
shape, Telegram behavior, queue semantics). Honestly skip it for
docs-only, hook-only, or skill-only changes — but say so in the commit
body ("no changeset: docs-only"). `scripts/release.mjs` refuses empty
CHANGELOG notes, so a missing changeset for a real change breaks the
release, not just etiquette.

## 8. Commit and review discipline

- Conventional message (`feat:`, `fix:`, `docs(skills):`, …), pathspec
  commit (`git commit -m "msg" -- <paths>`), push directly to `main` —
  no PRs unless the owner asks.
- Say what you verified in the body: `pnpm check` green, red→green proof
  performed, which test bites. The claim must be re-runnable, not vibes.
- Keep decisions short: the owner reviews ADRs under a minute. Reasoning
  that explains *code* belongs in code comments next to the constraint;
  the ADR states the rule, the pins, and nothing else.
- Do not merge external PRs on green-looking checks alone — there is no
  remote CI yet, and local hooks do not run on someone else's fork.

## 9. Bugs found mid-work — ticket it, then fix if in scope

- If you find a product bug while working (yours or not): file it as a
  Bug ticket first (vibeflow task management skill — repro + expected /
  actual). Never silently fix without a ticket, never silently walk past.
- Fix it in the same change only if it is small, adjacent to your ticket's
  scope, and keeps the one-change-one-commit rule intact. Otherwise leave
  the fix to the ticket with a pointer to the code.
- A fix follows §4 like any other change: biting test, red→green proof.

- Vibeflow ticket ops (claim, comment, move) in this repo go through the
  `vibeflow` CLI from the repo root — always, unless the owner says
  otherwise for a given task. The MCP server is rooted at vibeflow-private
  and cannot reach this store.

## 10. Anything bigger gets a task first

- Work that is more than a trivial fix — multi-file, feature-sized, or
  anything you would brief to a worker — gets a vibeflow task created and
  claimed BEFORE starting, even on a direct owner order. Small fixes and
  §9's bug rule stay exempt.

## Execution invariants (learned 2026-10-25 on vibeflow)

- **One deliverable per lane brief.** A brief with six deliverables burned
  two 30-minute timeouts in a row; >20 min means two lanes.
- **Commit in stages.** A committed partial with an honest "not finished"
  beats an uncommitted finished change that a timeout deletes.
- **The doer writes the evidence and moves its own ticket** to review with
  the commands it ran — splitting do/verify piles tickets in `review`.
- **An unknown response shape is an error, never "pending"** (or any other
  optimistic default). A four-shape device-poll contract where the CLI
  handled three turned an authorization success into a false "expired".
