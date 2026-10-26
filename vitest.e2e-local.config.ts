import { defineConfig } from "vitest/config";

/**
 * Tier 6 — e2e-local: the real Pi, a real model, a mocked Telegram.
 *
 * Boots `pi --mode rpc` with the built caretaker bundle and
 * `opencode-go/mimo-v2.6-flash` (override with PI_E2E_MODEL), drives it
 * over the documented JSONL protocol, and asserts on session messages
 * plus the loopback Bot API mock. Opt-in only (`pnpm test:e2e-local`);
 * never runs in `pnpm check`, so a default run can never spend model
 * budget or touch the network beyond loopback.
 */
export default defineConfig({
  test: {
    include: ["tests/e2e-local/**/*.test.ts"],
    testTimeout: 240_000,
    hookTimeout: 120_000,
    teardownTimeout: 30_000,
  },
});
