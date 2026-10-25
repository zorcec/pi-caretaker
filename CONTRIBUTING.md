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

Hooks (installed via husky): `pre-commit` runs the identity check and the
ADR gate, fail fast, no network. `pre-push` runs typecheck + lint + test.

## ADR requirement

A design decision that constrains other code, reverses a previous choice, or
guards a silent failure needs an ADR in `docs/decisions/`: copy
`TEMPLATE.md`, add the index row, pin it with a test that bites, and leave a
one-line `ADR-NNNN` pointer where it governs. No pin, no decision.

## No secrets

Never commit tokens, keys, `.env` files, or credentials in fixtures and
logs. There is no `.env` support in this repo on purpose — configuration
arrives via the environment at runtime, never via files.
