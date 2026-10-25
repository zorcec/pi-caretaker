import { defineConfig } from "vitest/config";

/**
 * Tier 5 — live tests. Real network, real credentials, real Telegram.
 *
 * Kept in its own config file (not a project of vitest.config.ts) so that a
 * plain `pnpm test` / `pnpm check` can never reach the network by accident.
 * Opt in explicitly:
 *
 *   pnpm test:live
 *
 * Nothing here runs in CI or in a hook. Each case is opt-in by design: a live
 * test that flakes must never be able to block a commit.
 */
export default defineConfig({
  test: {
    include: ["tests/live/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Live cases assert on third-party behavior; do not fail the run for a
    // teardown that hangs after the assertion already passed.
    teardownTimeout: 30_000,
  },
});
