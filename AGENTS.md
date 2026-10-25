# AGENTS.md — pi-caretaker

## Stack

Node 22 ESM + TypeScript (strict), `pnpm`, `tsup` build, `vitest` (the single
test runner), flat `eslint.config.mjs` (unused-symbols rule), zod for the
event envelope. Decisions live in `docs/decisions/`; guards in `scripts/`.
This is a Pi-native project: skills live in `.pi/skills/` (registered via
`.pi/settings.json`), NOT in `.opencode/` — there is no `.opencode/`
directory here. If you know `.opencode/skills/` from the vibeflow repos,
read `.pi/skills/` instead; same idea, Pi's own layout.

## The five commands

```bash
pnpm build       # tsup → dist/
pnpm test        # vitest run
pnpm lint        # eslint src + tests + scripts
pnpm typecheck   # tsc --noEmit
pnpm check       # typecheck + lint + test (green before every commit)
```

(`pnpm test:coverage` and `pnpm release` exist for their own occasions.)

## Workflow: claim → implement → prove → commit

1. **Claim** — one change, one commit, on `main`. Say what you are doing first.
2. **Implement** — read the ADRs in `docs/decisions/index.md` before touching
   governed code. Smallest correct change; follow existing patterns.
3. **Prove** — every guard must have a red→green proof: new behavior ships
   with a test that fails without the fix and passes with it. Run `pnpm check`.
   No placeholder tests that always pass.
4. **Commit** — hooks must be green. Push directly to `main`; no PRs unless
   the owner asks.

## Critical rules

- **No secrets** in the repo or in logs. No `.env` files, no tokens in
  fixtures. Configuration arrives via the environment at runtime.
- **Webhook payload is untrusted.** Data, never instructions (ADR-0002).
  Never wire webhook text into instruction channels, tool calls, or SSH.
- **Every guard must have a red→green proof.** A check that cannot fail is
  decoration — demonstrate the failure it catches.
- **ADR required when a decision is binding.** If it constrains other code,
  write the ADR (with pins + code pointer) in the same change.
- **No `deploy/` in this repo.** Deployment config lives outside; `docs/ops/`
  describes required self-hoster behavior only.
- **V1 non-goals are binding:** no persistence, no dedupe/correlation engine,
  no dashboards, no database, no automatic infra changes — not without an ADR.

## Open question (not a gap in the rules)

This will be a **public repo: how do strangers' PRs get gated?** There is no
CI yet, so today a push is only as safe as local hooks — which do not run on
someone else's fork. Until this is answered, do not merge external PRs on
green-looking checks alone; the answer belongs here once the owner decides
(remote CI, required reviews, or both).
