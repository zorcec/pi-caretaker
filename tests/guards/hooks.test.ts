import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../setup/repo-fixture.js";

/**
 * The hooks are the only gate this repo has — there is no remote CI, so a
 * hook that quietly stopped running a guard is indistinguishable from a
 * guard that passed. These tests read the hook files themselves and pin that
 * every guard is wired in and cannot be neutralised with `|| true`.
 */

function hook(name: string): string {
  return readFileSync(join(REPO_ROOT, ".husky", name), "utf8");
}

describe("git hooks", () => {
  describe("pre-commit", () => {
    const body = hook("pre-commit");

    it("runs the identity guard", () => {
      expect(body).toContain("scripts/check-git-identity.mjs");
    });

    it("runs the ADR guard", () => {
      expect(body).toContain("scripts/check-adrs.mjs");
    });

    it("fails the commit when a guard fails", () => {
      for (const line of body.split("\n").filter((l) => l.trim())) {
        expect(line).toMatch(/\|\|\s*exit 1/);
        expect(line).not.toMatch(/\|\|\s*true/);
      }
    });
  });

  describe("pre-push", () => {
    const body = hook("pre-push");

    it("runs typecheck, lint and test", () => {
      expect(body).toContain("pnpm run typecheck");
      expect(body).toContain("pnpm run lint");
      expect(body).toContain("pnpm run test");
    });

    it("fails the push when a gate fails", () => {
      for (const line of body.split("\n").filter((l) => l.trim())) {
        expect(line).toMatch(/\|\|\s*exit 1/);
        expect(line).not.toMatch(/\|\|\s*true/);
      }
    });
  });
});
