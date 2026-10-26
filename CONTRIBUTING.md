# Contributing

## Local setup

```bash
nvm use          # Node 22
pnpm install
pnpm check       # must be green before every commit
```

## Gate commands

| Command              | What it runs                  |
|----------------------|-------------------------------|
| `pnpm build`         | tsup build to `dist/`         |
| `pnpm test`          | vitest, single run            |
| `pnpm test:coverage` | vitest with V8 coverage       |
| `pnpm lint`          | eslint over src/tests/scripts |
| `pnpm typecheck`     | `tsc --noEmit`                |
| `pnpm check`         | typecheck + lint + test       |
| `pnpm release`       | tag + GitHub release from CHANGELOG (refuses empty notes) |

Hooks (installed via husky): `pre-commit` runs the ADR gate, fail fast,
no network. `pre-push` runs typecheck + lint + test.

## ADR requirement

A design decision that constrains other code, reverses a previous choice, or
guards a silent failure needs an ADR in `docs/decisions/`: copy
`TEMPLATE.md`, add the index row, pin it with a test that bites, and leave a
one-line `ADR-NNNN` pointer where it governs. No pin, no decision.

## When the ADR gate blocks your commit

The gate compares days, not lines: if you touched code carrying an
`ADR-NNNN` pointer on a later day than the ADR document was last touched,
rule (e) fails. This is deliberate — governed code must not silently age
past its decision. The fix is one of three, in the same commit:

1. Read the ADR, then `touch` it (a re-affirming touch) when the decision
   still holds — the new date is the review record.
2. Update the ADR when the decision evolved.
3. Supersede it with a new ADR when the decision changed.

Decided 2026-10-25 (ticket d3322341): the rule stays strict. A grace
window or body-only comparison would let governed code drift quietly,
which is exactly what the rule exists to catch.

## No secrets

Never commit tokens, keys, `.env` files, or credentials in fixtures and
logs. There is no `.env` support in this repo on purpose — configuration
arrives via the environment at runtime, never via files.
