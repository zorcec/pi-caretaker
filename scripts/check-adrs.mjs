#!/usr/bin/env node
/**
 * ADR reference guard — the pre-commit gate for docs/decisions.
 *
 * Adapted from vibeflow-private's check-adrs.mjs for pi-caretaker's flat
 * layout (src/, scripts/, tests/ instead of packages/*).
 *
 * Why a standalone script and not only the vitest suite: the pre-commit hook
 * must run in about a second, without booting the test runner. The pin tests
 * assert the same rules inside the suite; this file exists so they also block
 * a commit (AGENTS.md is the "read it" side, the hook is the "cannot skip it"
 * side). There is no remote CI, so this local gate is the only gate.
 *
 * ADR shape (owner rule: reviewable in under a minute, 12–18 lines):
 * `# ADR-NNNN: Title`, a `- Status: accepted · Date: … · Decided by: …`
 * line, `## Decision` / `## Why` / `## Consequence` sections, and a
 * `## Pins` section listing `- `path/to/test.ts`` entries. No Governed: or
 * Reviewed: metadata lines — the drift check derives the governed set from
 * the code files that carry `ADR-NNNN` pointers instead.
 *
 * Rules (each one exists because its failure is silent otherwise):
 *   (a) every `ADR-NNNN` reference in code resolves to a decisions file — a
 *       pointer to a deleted ADR sends the next agent nowhere;
 *   (b) every ACCEPTED ADR has a `## Pins` section and each pinned path
 *       exists — an ADR with no test is a preference, not a decision;
 *   (c) `index.md` lists every ADR file and has no phantom rows;
 *   (d) every ADR file is referenced from at least one source file — a decision
 *       nobody can find from the code is the one that gets undone;
 *   (e) DRIFT: code carrying an ADR pointer must not be newer than the ADR
 *       document itself. Compared by DAY. Deliberately coarse — per-line
 *       precision is what the Pins tests provide; this only asks "did someone
 *       touch governed code without revisiting the decision?". Fix by reading
 *       the ADR and committing an update (or a re-affirming touch), or by
 *       updating/superseding the decision.
 *
 * Exit 1 with a list of problems. Exit 0 when clean.
 *
 * Import-safe by design: the rules live in exported runCheck(), which
 * returns the report as data and never prints or exits. Only main() owns
 * output and the exit code, so tests can import this module for coverage
 * without killing their own worker.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ADR_REF = /\bADR-(\d{4})\b/g;
const SRC_EXT = /\.(ts|mjs|js)$/;

const here = dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = resolve(here, "..");

/**
 * Run every ADR rule against `root` and return the report as data.
 * Prints nothing and never exits — see the module header.
 */
export function runCheck(root = defaultRepoRoot) {
  const repoRoot = resolve(root);
  const decisionsDir = resolve(repoRoot, "docs/decisions");
  const scanRoots = ["src", "scripts", "tests"].map((p) =>
    resolve(repoRoot, p),
  );

  if (!existsSync(decisionsDir)) {
    return { ok: true, adrCount: 0, problems: [] };
  }

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SRC_EXT.test(entry.name)) out.push(full);
  }
  return out;
}

/** Day (YYYY-MM-DD) of the newest commit touching any of `paths`, or null. */
function gitLastCommitDay(paths) {
  try {
    const out = execFileSync(
      "git",
      ["log", "-1", "--format=%cs", "--", ...paths],
      { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return out || null;
  } catch {
    // Not a git checkout, or git unavailable: the date check is best-effort.
    return null;
  }
}

const adrFiles = readdirSync(decisionsDir).filter((f) =>
  /^\d{4}-.*\.md$/.test(f),
);
const adrIdOf = (file) => file.slice(0, 4);
const adrPath = (id) => {
  const hit = adrFiles.find((f) => f.startsWith(`${id}-`));
  return hit ? resolve(decisionsDir, hit) : null;
};

const problems = [];
const referenced = new Set();
// ADR id -> repo-relative paths of scanned files pointing at it. The drift
// check (e) treats these as the governed set, so ADRs need no metadata lines.
const pointerFiles = new Map();

for (const file of scanRoots.flatMap((root) => walk(root))) {
  const source = readFileSync(file, "utf8");
  for (const m of source.matchAll(ADR_REF)) {
    referenced.add(m[1]);
    if (!pointerFiles.has(m[1])) pointerFiles.set(m[1], new Set());
    pointerFiles.get(m[1]).add(file.replace(`${repoRoot}/`, ""));
    if (!adrPath(m[1])) {
      problems.push(
        `(a) dangling reference: ${file.replace(`${repoRoot}/`, "")} -> ADR-${m[1]}`,
      );
    }
  }
}

for (const f of adrFiles) {
  const body = readFileSync(resolve(decisionsDir, f), "utf8");
  // Accept both `- Status: accepted` and `- **Status:** accepted`. A regex
  // that only matches the bold form silently skips every rule below it —
  // which is exactly how a guard stops guarding.
  const status = body.match(/^[\s-]*(?:\*\*)?Status:(?:\*\*)?\s*(\S+)/m)?.[1];
  if (status !== "accepted") continue;

  const pinsSection = body.match(/^## Pins\s*$/m);
  const pins = pinsSection
    ? [
        ...body
          .slice(pinsSection.index)
          .matchAll(/^-\s*`([^`]+)`/gm),
      ].map((m) => m[1])
    : [];
  if (pins.length === 0) {
    problems.push(`(b) ${f}: accepted but its ## Pins section names no tests`);
  } else {
    for (const pin of pins) {
      if (!existsSync(resolve(repoRoot, pin)))
        problems.push(`(b) ${f}: pin does not exist: ${pin}`);
    }
  }

  // Governed set = repo-relative paths of scanned files pointing at this ADR.
  // `get` returns undefined when nothing points at it — the case rule (d)
  // exists to report — so default to an empty set instead of spreading
  // undefined and dying before (d) can print its message.
  const governed = [...(pointerFiles.get(adrIdOf(f) ?? "") ?? [])];
  if (governed.length === 0) {
    // Reported under (d) below; drift has nothing to compare — skip quietly.
  } else {
    const adrDay = gitLastCommitDay([`docs/decisions/${f}`]);
    const codeDay = gitLastCommitDay(governed);
    if (adrDay && codeDay && codeDay > adrDay) {
      problems.push(
        `(e) ${f}: governed code changed on ${codeDay}, ADR last touched ${adrDay} — ` +
          `read it again and commit an update (or a re-affirming touch), or supersede it`,
      );
    }
  }
}

const index = readFileSync(resolve(decisionsDir, "index.md"), "utf8");
for (const f of adrFiles) {
  if (!index.includes(adrIdOf(f))) problems.push(`(c) ${f}: no row in index.md`);
}
for (const m of index.matchAll(/\[(\d{4})\]\((\d{4}-[^)]+)\)/g)) {
  if (!existsSync(resolve(decisionsDir, m[2]))) {
    problems.push(`(c) index.md: phantom row ADR-${m[1]} -> ${m[2]}`);
  }
}

for (const f of adrFiles) {
  const id = adrIdOf(f);
  if (!referenced.has(id)) {
    problems.push(
      `(d) ADR-${id} has no code reference — add a one-line pointer where it governs`,
    );
  }
}

  return { ok: problems.length === 0, adrCount: adrFiles.length, problems };
}

/** CLI entry: print the report and return the exit code. */
export function main() {
  const result = runCheck();
  if (result.adrCount === 0) {
    console.log("check-adrs: no docs/decisions directory — nothing to check.");
    return 0;
  }
  if (!result.ok) {
    console.error(
      `✗ ADR check failed:\n${result.problems.map((p) => `  ${p}`).join("\n")}`,
    );
    console.error(
      "\nFix the pointers/ADRs, or update the decision with a new ADR that supersedes it.",
    );
    return 1;
  }
  console.log(
    `✓ ADR check: ${result.adrCount} decisions, all referenced, pins, index and drift in sync.`,
  );
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
