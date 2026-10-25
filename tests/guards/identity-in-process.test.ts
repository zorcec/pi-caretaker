import { describe, expect, it } from "vitest";
import {
  identityViolations,
  isTestIdentity,
  selfTest,
  type CommitIdentity,
} from "../../scripts/check-git-identity.mjs";

/**
 * In-process coverage for scripts/check-git-identity.mjs.
 *
 * The child-process suite in check-git-identity.test.ts proves the CLI
 * contract (exit codes, usage line, --history and --pre-push backstops).
 * These cases pin the predicate itself: the exact identities refused and
 * accepted, and how author vs committer vs grandfathered offenders filter.
 * A predicate change that the CLI tests only reach through git fixtures
 * shows up here as a direct unit failure first.
 */
function commit(
  overrides: Partial<CommitIdentity> & { sha: string },
): CommitIdentity {
  return {
    authorName: "Real Author",
    authorEmail: "author@real-domain.org",
    committerName: "Real Committer",
    committerEmail: "committer@real-domain.org",
    ...overrides,
  };
}

describe("git identity predicate in process", () => {
  it.each([
    ["p5", "p5@test.local", true],
    ["test", "someone@example.com", true],
    ["  p5  ", "author@real-domain.org", true],
    ["Test", "AUTHOR@EXAMPLE.COM", true],
    ["Tomislav Zorcec", "zorcec@gmail.com", false],
    ["Real Author", "author@real-domain.org", false],
  ])("isTestIdentity(%j, %j) is %j", (name, email, expected) => {
    expect(isTestIdentity(name, email)).toBe(expected);
  });

  it("flags an offender on either the author or the committer side", () => {
    const badAuthor = commit({
      sha: "a".repeat(40),
      authorName: "p5",
      authorEmail: "p5@test.local",
    });
    const badCommitter = commit({
      sha: "b".repeat(40),
      committerEmail: "someone@example.com",
    });
    const clean = commit({ sha: "c".repeat(40) });

    expect(identityViolations([badAuthor, badCommitter, clean])).toEqual([
      badAuthor,
      badCommitter,
    ]);
  });

  it("reports no violations for an all-clean history", () => {
    expect(
      identityViolations([commit({ sha: "c".repeat(40) })]),
    ).toEqual([]);
  });

  it("self-test passes: the guard refuses its own test identities", () => {
    expect(selfTest()).toBe(0);
  });
});
