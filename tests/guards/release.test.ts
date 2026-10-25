import { afterEach, describe, expect, it } from "vitest";
import { createRepoFixture, runRepoScript, type RepoFixture } from "../setup/repo-fixture.js";

/**
 * E2E for `scripts/release.mjs`.
 *
 * Release refuses more often than it succeeds, and every refusal is a guard:
 * an empty CHANGELOG section would publish notes nobody can read, and an
 * unknown argument would silently release the wrong version. Both are
 * exercised here as child processes against scratch repositories, so the real
 * checkout's CHANGELOG is never touched.
 */

const GUARD = "scripts/release.mjs";
const MISSING_VERSION = "9.9.9";

let active: RepoFixture | undefined;

afterEach(() => {
  active?.dispose();
  active = undefined;
});

function fixture(): RepoFixture {
  active = createRepoFixture();
  return active;
}

describe("release guard (scripts/release.mjs)", () => {
  it("refuses a version with no CHANGELOG section and names it", () => {
    const result = runRepoScript(GUARD, {
      args: ["--print-notes", "--version", MISSING_VERSION],
    });

    expect(result.status).toBe(1);
    expect(result.crashed).toBe(false);
    expect(result.output).toContain(
      `no CHANGELOG section for version ${MISSING_VERSION}`,
    );
    expect(result.output).toContain(`## ${MISSING_VERSION}`);
  });

  it("refuses an unknown argument with its usage line", () => {
    const result = runRepoScript(GUARD, { args: ["--definitely-not-a-flag"] });

    expect(result.status).toBe(2);
    expect(result.output).toContain(
      "usage: node scripts/release.mjs [--version <x.y.z>] [--print-notes]",
    );
  });

  it("prints the notes for a version that has them, without touching git", () => {
    const f = fixture();
    f.write("package.json", JSON.stringify({ name: "fixture", version: MISSING_VERSION }, null, 2));
    f.write(
      "CHANGELOG.md",
      [
        "# Changelog",
        "",
        `## ${MISSING_VERSION}`,
        "",
        "- a change worth reading about",
        "",
        "## 1.0.0",
        "",
        "- an older change",
        "",
      ].join("\n"),
    );

    const result = f.runScript(GUARD, {
      args: ["--print-notes", "--version", MISSING_VERSION],
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`## ${MISSING_VERSION}`);
    expect(result.stdout).toContain("a change worth reading about");
    expect(result.stdout).not.toContain("an older change");
  });

  it("refuses to publish a version whose section is empty", () => {
    const f = fixture();
    f.write("package.json", JSON.stringify({ name: "fixture", version: MISSING_VERSION }, null, 2));
    f.write(
      "CHANGELOG.md",
      ["# Changelog", "", `## ${MISSING_VERSION}`, "", "## 1.0.0", "", "- older", ""].join("\n"),
    );

    const result = f.runScript(GUARD, {
      args: ["--print-notes", "--version", MISSING_VERSION],
    });

    expect(result.status).toBe(1);
    expect(result.output).toContain("is empty — refusing to publish unreadable release notes");
  });

  // The remaining paths (tag creation, tag push, `gh release create`) all
  // mutate git or GitHub. They need a scratch remote and a stub `gh` on PATH
  // before they can be proven without side effects.
  it.todo("creates an annotated tag and a GitHub release with the extracted notes");
  it.todo("reports \"already released\" and exits 0 when the tag exists");
  it.todo("fails loudly when gh is missing or unauthenticated");
});
