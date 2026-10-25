import { afterEach, describe, expect, it } from "vitest";
import {
  createRepoFixture,
  runRepoScript,
  type RepoFixture,
} from "../setup/repo-fixture.js";

/**
 * E2E for `scripts/check-adrs.mjs`, the pre-commit ADR gate.
 *
 * The guard is an executable: it resolves paths from its own location, shells
 * out to git for the drift day, and reports through exit codes. So each case
 * builds a scratch repository, mutates it, and runs the copied script as a
 * real child process — asserting both the exit status and the human-readable
 * message, because a guard that "fails" without naming the problem is not
 * much of a guard.
 *
 * NOTE: decision ids are assembled at runtime (`adrId()`). Writing a literal
 * `ADR-` + four digits into this file would make the real guard scan it as a
 * pointer to a decision that does not exist — rule (a) would then fail on the
 * repository itself.
 */

const GUARD = "scripts/check-adrs.mjs";
const DECISION_FILE = "0005-fixture-decision.md";
const GOVERNED_FILE = "src/fixture-decision.ts";
const VALID_PIN = "tests/health.test.ts";

/** Runtime-only decision id, so this file never carries a literal pointer. */
function adrId(n: number): string {
  return `ADR-${String(n).padStart(4, "0")}`;
}

let active: RepoFixture | undefined;

afterEach(() => {
  active?.dispose();
  active = undefined;
});

function fixture(): RepoFixture {
  active = createRepoFixture();
  return active;
}

interface DecisionOptions {
  status?: string;
  /** Bold label form (`**Status:** accepted`) — the shape the parser must also read. */
  boldLabel?: boolean;
  pins?: string[];
  /** Add a row to index.md. */
  index?: boolean;
  /** Add a source file pointing at this decision (rule (d) / drift set). */
  governed?: boolean;
}

/** Write an extra decision file (plus index row and governed code) into the fixture. */
function addDecision(f: RepoFixture, n: number, options: DecisionOptions = {}): void {
  const {
    status = "accepted",
    boldLabel = false,
    pins = [VALID_PIN],
    index = true,
    governed = true,
  } = options;

  const statusLine = boldLabel ? `- **Status:** ${status}` : `- Status: ${status}`;
  const body = [
    `# ${adrId(n)}: Fixture decision`,
    `${statusLine} · Date: 2026-10-25 · Decided by: owner`,
    "## Decision",
    "Fixture decision, written only to exercise the guard.",
    "## Why",
    "The guard needs a file to read.",
    "## Consequence",
    "Nothing outside this scratch repository.",
    ...(pins.length > 0 ? ["## Pins", ...pins.map((p) => `- \`${p}\``)] : []),
    "",
  ].join("\n");
  f.write(`docs/decisions/${DECISION_FILE}`, body);

  if (index) {
    const current = f.read("docs/decisions/index.md").trimEnd();
    f.write(
      "docs/decisions/index.md",
      `${current}\n| [${String(n).padStart(4, "0")}](${DECISION_FILE}) | fixture | 2026-10-25 | n | \`${VALID_PIN}\` |\n`,
    );
  }

  if (governed) {
    f.write(GOVERNED_FILE, `// governed by ${adrId(n)}\nexport const fixture = 1;\n`);
  }
}

describe("ADR guard (scripts/check-adrs.mjs)", () => {
  it("passes on this repository as it stands", () => {
    const result = runRepoScript(GUARD);
    expect(result.status).toBe(0);
    expect(result.crashed).toBe(false);
    expect(result.output).toContain("ADR check:");
  });

  describe("rule (a): every decision reference resolves", () => {
    it("reports a pointer to a decision file that does not exist", () => {
      const f = fixture();
      const missing = adrId(9999);
      f.write("src/dangling.ts", `// governed by ${missing}\nexport const x = 1;\n`);
      f.commitAll("add a dangling decision pointer");

      const result = f.runScript(GUARD);

      expect(result.status).toBe(1);
      expect(result.crashed).toBe(false);
      expect(result.output).toContain(
        `(a) dangling reference: src/dangling.ts -> ${missing}`,
      );
    });
  });

  describe("rule (b): accepted decisions must pin a test that exists", () => {
    it("refuses an accepted decision with no pins section at all", () => {
      const f = fixture();
      addDecision(f, 5, { pins: [] });
      f.commitAll("add accepted decision without pins");

      const result = f.runScript(GUARD);

      expect(result.status).toBe(1);
      expect(result.output).toContain(
        `(b) ${DECISION_FILE}: accepted but its ## Pins section names no tests`,
      );
    });

    it("refuses a pin that points at a file nobody wrote", () => {
      const f = fixture();
      addDecision(f, 5, { pins: ["tests/never-written.test.ts"] });
      f.commitAll("add accepted decision with a broken pin");

      const result = f.runScript(GUARD);

      expect(result.status).toBe(1);
      expect(result.output).toContain(
        `(b) ${DECISION_FILE}: pin does not exist: tests/never-written.test.ts`,
      );
    });

    it("reads the bold `**Status:**` label instead of silently skipping the file", () => {
      const f = fixture();
      addDecision(f, 5, { boldLabel: true, pins: [] });
      f.commitAll("add decision with a bold status label");

      const result = f.runScript(GUARD);

      // If the status regex only matched the plain form, the file would look
      // non-accepted and this complaint would never be produced.
      expect(result.status).toBe(1);
      expect(result.output).toContain(
        `(b) ${DECISION_FILE}: accepted but its ## Pins section names no tests`,
      );
    });
  });

  describe("rule (c): index.md matches the decisions directory", () => {
    it("reports a decision file with no index row", () => {
      const f = fixture();
      addDecision(f, 5, { index: false });
      f.commitAll("add decision without an index row");

      const result = f.runScript(GUARD);

      expect(result.status).toBe(1);
      expect(result.output).toContain(`(c) ${DECISION_FILE}: no row in index.md`);
    });

    it("reports an index row whose file does not exist", () => {
      const f = fixture();
      const current = f.read("docs/decisions/index.md").trimEnd();
      f.write(
        "docs/decisions/index.md",
        `${current}\n| [9999](9999-not-a-file.md) | phantom | 2026-10-25 | n | \\\`${VALID_PIN}\\\` |\n`,
      );
      f.commitAll("add a phantom index row");

      const result = f.runScript(GUARD);

      expect(result.status).toBe(1);
      expect(result.output).toContain(
        `(c) index.md: phantom row ${adrId(9999)} -> 9999-not-a-file.md`,
      );
    });
  });

  describe("rule (e): governed code cannot outdate the decision", () => {
    it("flags code committed after the decision it points at", () => {
      const f = fixture();
      addDecision(f, 5, {});
      f.commitAll("decisions and governed code", "2026-10-01T10:00:00Z");

      f.write(GOVERNED_FILE, `// governed by ${adrId(5)}\nexport const fixture = 2;\n`);
      f.commitAll("touch governed code only", "2026-10-25T10:00:00Z");

      const result = f.runScript(GUARD);

      expect(result.status).toBe(1);
      expect(result.output).toContain(`(e) ${DECISION_FILE}: governed code changed on 2026-10-25`);
      expect(result.output).toContain("ADR last touched 2026-10-01");
    });

    it("stays quiet when code and decision are touched on the same day", () => {
      const f = fixture();
      addDecision(f, 5, {});
      f.commitAll("everything together", "2026-10-01T10:00:00Z");

      const result = f.runScript(GUARD);

      expect(result.status).toBe(0);
      expect(result.output).toContain("ADR check:");
    });
  });

  describe("status handling", () => {
    it("lets a draft decision ship without pins, while still needing a code pointer", () => {
      const f = fixture();
      addDecision(f, 5, { status: "proposed", pins: [] });
      f.commitAll("add a draft decision");

      const result = f.runScript(GUARD);

      expect(result.status).toBe(0);
      expect(result.output).not.toContain(`(b) ${DECISION_FILE}`);
    });
  });

  describe("rule (d): an accepted decision must be referenced from code", () => {
    it("reports the missing pointer instead of crashing", () => {
      const f = fixture();
      // Valid pins and an index row, so (b) and (c) stay silent and the only
      // problem left is that no source file points at this decision.
      addDecision(f, 5, { governed: false });
      f.commitAll("add accepted decision nothing points at");

      const result = f.runScript(GUARD);

      // The crash is the bug: dying with a TypeError prints a stack trace
      // instead of the actionable message, so rule (d) never guards anything.
      expect(result.crashed).toBe(false);
      expect(result.status).toBe(1);
      expect(result.output).toContain(`(d) ${adrId(5)} has no code reference`);
      expect(result.output).not.toContain("TypeError");
    });

    it("stays quiet when some source file does point at the decision", () => {
      const f = fixture();
      addDecision(f, 5, { governed: true });
      f.commitAll("add accepted decision with a governed source file");

      const result = f.runScript(GUARD);

      expect(result.crashed).toBe(false);
      expect(result.status).toBe(0);
      expect(result.output).not.toContain(`(d) ${adrId(5)}`);
    });
  });
});
