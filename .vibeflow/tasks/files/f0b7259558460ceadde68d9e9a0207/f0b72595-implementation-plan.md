# Answer the CI gating question - implementation plan
Ticket: f0b7259558460ceadde68d9e9a0207 | Parent: Initial testing (d8f35c7cd6eea8d8dfb9ed5da58759)
## Goal
Resolve the open question in AGENTS.md about how strangers' PRs get gated, given no remote CI today.
## Non-goals (explicit)
- No implementation of a CI system unless owner chooses it.
- No weakening of local hooks or bypasses.
- No deploy/ or Dockerfile.
## Current state (what exists today, what throws, with file:line)
- `AGENTS.md` "Open question" section asks how strangers' PRs get gated; no CI; local hooks do not run on someone else's fork.
- `.husky/pre-commit` runs identity + ADR gate; `.husky/pre-push` runs typecheck + lint + test.
- `CONTRIBUTING.md` documents five commands and hooks; `package.json` has no CI scripts.
## Steps (ordered and concrete, naming exact files, exports and commands)
1. Owner decision among: (A) require remote CI before external merge, (B) required reviews only, (C) both. Document chosen policy.
2. If A or C: add minimal GitHub Actions workflow under `.github/workflows/check.yml` running `pnpm install`, `pnpm check`, `pnpm build` on pull_request and push to main. Config, not deploy/.
3. If B or C: add `CODEOWNERS` and branch protection docs in `CONTRIBUTING.md` (require owner review, status checks if CI chosen).
4. Update `AGENTS.md` "Open question" section: replace question with decided policy and pointer to workflow/CODEOWNERS.
5. Update `CONTRIBUTING.md` with external-PR path and note local hooks are not a substitute for CI on forks.
6. If workflow added, pin with guard test under `tests/guards/` asserting file exists and runs `pnpm check` (optional but consistent).
7. Run `pnpm check`.
## Files touched (new / modified)
- Modified: `AGENTS.md`, `CONTRIBUTING.md`
- Possibly new: `.github/workflows/check.yml`, `CODEOWNERS`, `tests/guards/ci-gating.test.ts`
## ADR obligations (pointer + pin, or "none" and why)
- If policy constrains future code, write ADR governing `.github/workflows/` and `CONTRIBUTING.md` with pins; otherwise "none" — process decision recorded in docs.
## Test plan (each new test, which existing it.todo or guard it replaces, and the red proof: what fails without this change)
- If workflow guard added, asserts file exists and contains `pnpm check`; red before workflow added.
## Open decisions for the owner (never guess - list them instead)
- Which gating option (A/B/C) and required reviewers.
- Whether CI also runs `pnpm build` and on which Node version matrix.
- Whether owner self-merges allowed.
## Out of scope for this ticket
Persistence, deploy config, or changing local hook chain.
