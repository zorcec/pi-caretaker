import { describe, expect, it } from "vitest";
import {
  extractReleaseNotes,
  readPackageVersion,
  RELEASE_REPO,
} from "../../scripts/release.mjs";
import { REPO_ROOT } from "../setup/repo-fixture.js";

/**
 * In-process coverage for scripts/release.mjs.
 *
 * The child-process suite in release.test.ts proves the CLI refusals (exit 1
 * on a missing section, exit 2 on an unknown flag). These cases pin the
 * extraction logic itself: section boundaries, the empty-section refusal,
 * and the exact error naming the version. A format change that the CLI tests
 * only reach through --print-notes shows up here as a direct unit failure.
 */
const CHANGELOG = [
  "# Changelog",
  "",
  "## 0.2.0",
  "",
  "- second change",
  "- another line",
  "",
  "## 0.1.0",
  "",
  "- first change",
  "",
].join("\n");

describe("release notes extraction in process", () => {
  it("extracts a middle section without its neighbours", () => {
    const notes = extractReleaseNotes(CHANGELOG, "0.2.0");

    expect(notes).toContain("## 0.2.0");
    expect(notes).toContain("second change");
    expect(notes).not.toContain("first change");
    expect(notes).not.toContain("## 0.1.0");
  });

  it("extracts the last section through the end of the file", () => {
    const notes = extractReleaseNotes(CHANGELOG, "0.1.0");

    expect(notes).toContain("## 0.1.0");
    expect(notes).toContain("first change");
  });

  it("refuses a missing section and names the version", () => {
    expect(() => extractReleaseNotes(CHANGELOG, "9.9.9")).toThrow(
      /no CHANGELOG section for version 9\.9\.9/,
    );
  });

  it("refuses an empty section instead of publishing blank notes", () => {
    const empty = "# Changelog\n\n## 1.0.0\n\n## 0.9.0\n\n- older\n";

    expect(() => extractReleaseNotes(empty, "1.0.0")).toThrow(
      /is empty — refusing to publish unreadable release notes/,
    );
  });

  it("reads this repo's version from its package.json", () => {
    expect(readPackageVersion(REPO_ROOT)).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("targets this repository", () => {
    expect(RELEASE_REPO).toBe("zorcec/pi-caretaker");
  });
});
