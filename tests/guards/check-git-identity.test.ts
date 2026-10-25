import { afterEach, describe, expect, it } from "vitest";
import {
  createRepoFixture,
  runRepoScript,
  type RepoFixture,
} from "../setup/repo-fixture.js";

/**
 * E2E for `scripts/check-git-identity.mjs`, the commit/push identity gate.
 *
 * The script resolves git from its own location and reports through exit
 * codes, so the CLI paths are exercised as real child processes against
 * scratch repositories. The predicate itself is pure and exported, so it is
 * also pinned directly — both halves matter: a guard that refuses the wrong
 * identities or accepts the wrong ones is the failure this file exists for.
 */

const GUARD = "scripts/check-git-identity.mjs";

/** An identity that must be refused (matches isTestIdentity). */
const BAD_IDENTITY: NodeJS.ProcessEnv = {
  GIT_AUTHOR_NAME: "p5",
  GIT_AUTHOR_EMAIL: "p5@test.local",
};

let active: RepoFixture | undefined;

afterEach(() => {
  active?.dispose();
  active = undefined;
});

function fixture(): RepoFixture {
  active = createRepoFixture();
  return active;
}

describe("git identity guard (scripts/check-git-identity.mjs)", () => {
  it("passes its own self-test", () => {
    const result = runRepoScript(GUARD, { args: ["--self-test"] });
    expect(result.status).toBe(0);
    expect(result.output).toContain("self-test");
  });

  it("accepts the configured identity of this checkout", () => {
    const result = runRepoScript(GUARD);
    expect(result.status).toBe(0);
    expect(result.crashed).toBe(false);
    expect(result.output).toContain("accepted author");
  });

  it("rejects an unknown argument with its usage line", () => {
    const result = runRepoScript(GUARD, { args: ["--not-a-flag"] });
    expect(result.status).toBe(1);
    expect(result.output).toContain("usage: node scripts/check-git-identity.mjs");
  });

  it("refuses to commit under a test identity and prints the fix", () => {
    const f = fixture();
    f.write("scratch.txt", "content\n");
    f.commitAll("baseline");

    const result = f.runScript(GUARD, { env: BAD_IDENTITY });

    expect(result.status).toBe(1);
    expect(result.output).toContain("refusing commit with a test identity");
    expect(result.output).toContain("Fix: git config user.name");
    expect(result.output).toContain("p5@test.local");
  });

  describe("--history backstop", () => {
    it("is clean when every commit carries a real identity", () => {
      const f = fixture();
      f.write("a.txt", "one\n");
      f.commitAll("first");
      f.write("b.txt", "two\n");
      f.commitAll("second");

      const result = f.runScript(GUARD, { args: ["--history"] });

      expect(result.status).toBe(0);
      expect(result.output).toContain("no new test identities");
    });

    it("names the offending commit when history contains a test identity", () => {
      const f = fixture();
      f.write("a.txt", "one\n");
      f.commitAll("clean baseline");
      f.write("b.txt", "two\n");
      f.git(["add", "--all"]);
      f.git([
        "-c",
        "user.name=p5",
        "-c",
        "user.email=p5@test.local",
        "commit",
        "--message",
        "bad identity",
      ]);
      const offender = f.git(["rev-parse", "HEAD"]);

      const result = f.runScript(GUARD, { args: ["--history"] });

      expect(result.status).toBe(1);
      expect(result.output).toContain(`Commit: ${offender}`);
      expect(result.output).toContain("p5@test.local");
    });
  });

  describe("--pre-push backstop", () => {
    /** git's pre-push stdin line: <localRef> <localSha> <remoteRef> <remoteSha>. */
    const pushLine = (local: string, remote: string): string =>
      `refs/heads/main ${local} refs/heads/main ${remote}\n`;

    it("accepts a push whose new commits are clean", () => {
      const f = fixture();
      f.write("a.txt", "one\n");
      f.commitAll("base");
      const base = f.git(["rev-parse", "HEAD"]);
      f.write("b.txt", "two\n");
      f.commitAll("head");
      const head = f.git(["rev-parse", "HEAD"]);

      const result = f.runScript(GUARD, {
        args: ["--pre-push", "origin"],
        input: pushLine(head, base),
      });

      expect(result.status).toBe(0);
      expect(result.output).toContain("no new test identities");
    });

    it("refuses a push that would publish a test identity", () => {
      const f = fixture();
      f.write("a.txt", "one\n");
      f.commitAll("base");
      const base = f.git(["rev-parse", "HEAD"]);
      f.write("b.txt", "two\n");
      f.git(["add", "--all"]);
      f.git([
        "-c",
        "user.name=test",
        "-c",
        "user.email=someone@example.com",
        "commit",
        "--message",
        "bad identity",
      ]);
      const head = f.git(["rev-parse", "HEAD"]);

      const result = f.runScript(GUARD, {
        args: ["--pre-push", "origin"],
        input: pushLine(head, base),
      });

      expect(result.status).toBe(1);
      expect(result.output).toContain(`Commit: ${head}`);
    });

    it("rejects a malformed ref update instead of checking nothing", () => {
      const f = fixture();
      f.write("a.txt", "one\n");
      f.commitAll("base");

      const result = f.runScript(GUARD, {
        args: ["--pre-push", "origin"],
        input: "garbage line\n",
      });

      expect(result.status).toBe(1);
      expect(result.output).toContain("invalid pre-push ref update");
    });

    it("publishes nothing when a ref is deleted, so it checks nothing", () => {
      const f = fixture();
      f.write("a.txt", "one\n");
      f.commitAll("base");
      const zero = "0".repeat(40);
      const head = f.git(["rev-parse", "HEAD"]);

      const result = f.runScript(GUARD, {
        args: ["--pre-push", "origin"],
        input: pushLine(zero, head),
      });

      expect(result.status).toBe(0);
      expect(result.output).toContain("no new test identities");
    });
  });

  // The grandfathering mechanism exists (GRANDFATHERED_COMMITS) but the repo
  // starts with an empty list by owner decision — a test that filled it would
  // be testing a state that must stay empty until an actual incident.
  it.todo("filters a grandfathered SHA out of the violation list");
});
