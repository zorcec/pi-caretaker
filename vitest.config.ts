import { defineConfig } from "vitest/config";

/**
 * One runner (vitest), four local projects. No custom harness, no wrapper
 * scripts — every tier is selected with vitest's own `--project` filter.
 *
 *   unit    tests/*.test.ts            pure contract/pin tests over src/
 *   guards  tests/guards/*.test.ts     the three guard scripts, run as real
 *                                      processes against temp git repos
 *   build   tests/build/*.test.ts      tsup artifact e2e (slow: spawns tsup)
 *   e2e     tests/e2e/*.test.ts        listener/queue/triage e2e over a real
 *                                      HTTP socket
 *
 * `pnpm test` runs all four — that is the pre-push gate. Live tests
 * (network + credentials) live in vitest.live.config.ts and are NEVER part
 * of `pnpm test`, so a default run can never touch the internet.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/*.test.ts"],
        },
      },
      {
        test: {
          name: "guards",
          include: ["tests/guards/**/*.test.ts"],
          // Each case builds a throwaway git repo and spawns a node process.
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        test: {
          name: "build",
          include: ["tests/build/**/*.test.ts"],
          // tsup + d.ts generation; slowest project in the suite.
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
      {
        test: {
          name: "e2e",
          include: ["tests/e2e/**/*.test.ts"],
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // scripts/ counts because guard and operator scripts expose importable
      // pure functions (runCheck, extractReleaseNotes, parseSecretsEnv,
      // resolveStartConfig, resolveAlertConfig, …) alongside their
      // child-process CLI surface. The child-process runs prove exit codes;
      // these numbers prove the logic itself is executed.
      include: ["src/**/*.ts", "scripts/**/*.mjs"],
      thresholds: {
        "src/**/*.ts": {
          statements: 95,
          functions: 100,
          branches: 85,
          lines: 95,
        },
        // Recursive glob aggregate includes manual Telegram scripts; measured at the reporter's precision.
        "scripts/**/*.mjs": {
          statements: 61.5,
          functions: 65.43,
          branches: 77.34,
          lines: 61.5,
        },
      },
    },
  },
});
