import { afterEach, describe, expect, it } from "vitest";
import { runCheck } from "../../scripts/check-adrs.mjs";
import {
  createRepoFixture,
  REPO_ROOT,
  type RepoFixture,
} from "../setup/repo-fixture.js";

/**
 * In-process coverage for scripts/check-adrs.mjs.
 *
 * The child-process suite in check-adrs.test.ts proves the CLI contract (exit
 * codes and stderr). These cases exercise the same rules through the exported
 * function, which is what lets the script appear in the coverage report at
 * all — and the first test fails while the guard still runs its checks at
 * import time and exits the process instead of exposing a function.
 *
 * Both layers are deliberate: the CLI tests would still pass if someone broke
 * the module boundary, and these would still pass if someone changed the
 * exit codes. Neither is redundant with the other.
 */
let active: RepoFixture | undefined;

// Decision ids are assembled at runtime. A literal `ADR-` + four digits in
// this file would make the real guard scan it as a pointer to a decision
// that does not exist — rule (a) would then fail the repository itself.
// (tests/guards/check-adrs.test.ts does the same via adrId().)
const orphanId = (n: number): string => `ADR-${String(n).padStart(4, "0")}`;
const ORPHAN_NUM = "0042"; // fixture space (see check-adrs.test.ts)
const DANGLING_NUM = "9999";

afterEach(() => {
  active?.dispose();
  active = undefined;
});

function fixture(): RepoFixture {
  active = createRepoFixture();
  return active;
}

describe("ADR guard in process (runCheck)", () => {
  it("exposes a function instead of exiting at import time", () => {
    expect(typeof runCheck).toBe("function");
  });

  it("reports this repository as clean", () => {
    const result = runCheck(REPO_ROOT);

    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.adrCount).toBeGreaterThanOrEqual(4);
  });

  it("returns problems as data rather than printing and exiting", () => {
    const f = fixture();
    const dangling = orphanId(Number(DANGLING_NUM));
    f.write("src/dangling.ts", `// governed by ${dangling}\nexport const x = 1;\n`);

    const result = runCheck(f.root);

    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain(
      `(a) dangling reference: src/dangling.ts -> ${dangling}`,
    );
  });

  it("reports an accepted decision with no code pointer as a problem", () => {
    const f = fixture();
    const orphan = orphanId(Number(ORPHAN_NUM));
    const file = `${ORPHAN_NUM}-orphan.md`;
    f.write(
      `docs/decisions/${file}`,
      [
        `# ${orphan}: Orphan`,
        "- Status: accepted · Date: 2026-10-25 · Decided by: owner",
        "## Decision",
        "x",
        "## Why",
        "y",
        "## Consequence",
        "z",
        "## Pins",
        "- `tests/health.test.ts`",
        "",
      ].join("\n"),
    );
    const index = f.read("docs/decisions/index.md").trimEnd();
    f.write(
      "docs/decisions/index.md",
      `${index}\n| [${ORPHAN_NUM}](${file}) | fixture | 2026-10-25 | n | \`tests/health.test.ts\` |\n`,
    );

    const result = runCheck(f.root);

    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain(
      `(d) ${orphan} has no code reference`,
    );
  });
});
