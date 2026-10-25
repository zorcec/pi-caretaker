/**
 * Throwaway git repositories for guard e2e tests.
 *
 * A guard is an executable, not a function: it resolves paths from its own
 * location, shells out to git, and reports through exit codes. The only honest
 * way to test it is to give it a real repository and a real process, so each
 * case builds a scratch clone under the OS temp dir and runs the copied
 * script inside it. Nothing here writes to the pi-caretaker checkout.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path of the pi-caretaker checkout (tests/setup -> repo root). */
export const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/** What to copy from the real checkout into the scratch repository. */
export interface FixtureContents {
  decisions?: boolean;
  src?: boolean;
  tests?: boolean;
  scripts?: boolean;
}

export interface RunResult {
  /** Process exit status; null when the process was killed by a signal. */
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  /** stdout + stderr, the way a human reads a guard's output. */
  output: string;
  /** True when the process died from an uncaught exception (crash, not report). */
  crashed: boolean;
}

export interface RunOptions {
  args?: string[];
  /** Lines written to the child's stdin (used by --pre-push). */
  input?: string;
  env?: NodeJS.ProcessEnv;
}

export interface RepoFixture {
  /** Absolute path of the scratch repository root. */
  readonly root: string;
  /** Write a file (parents created) and return its absolute path. */
  write(relPath: string, contents: string): string;
  /** Read a file inside the fixture. */
  read(relPath: string): string;
  /** True when a path exists inside the fixture. */
  exists(relPath: string): boolean;
  /** Run a git command inside the fixture. */
  git(args: string[], env?: NodeJS.ProcessEnv): string;
  /** Stage everything and commit; optionally pin author/committer dates. */
  commitAll(message: string, isoDate?: string): void;
  /** Execute a copied script with node, capturing status and output. */
  runScript(relPath: string, options?: RunOptions): RunResult;
  /** Delete the scratch repository. Safe to call twice. */
  dispose(): void;
}

// Identity deliberately avoids the patterns check-git-identity.mjs refuses
// (isTestIdentity), so a fixture commit is "accepted" unless a test asks for
// a bad identity on purpose.
const GIT_IDENTITY = [
  "-c",
  "user.name=Fixture Owner",
  "-c",
  "user.email=fixture@pi-caretaker.dev",
];

/**
 * Build a scratch repository containing the repo's guard-relevant layout.
 * Every case gets its own directory, so mutations never leak between tests.
 */
export function createRepoFixture(contents: FixtureContents = {}): RepoFixture {
  const {
    decisions = true,
    src = true,
    tests = true,
    scripts = true,
  } = contents;

  const root = mkdtempSync(join(tmpdir(), "pi-caretaker-fixture-"));

  const copy = (rel: string) => {
    const from = join(REPO_ROOT, rel);
    const to = join(root, rel);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true });
  };

  if (decisions) copy("docs/decisions");
  if (src) copy("src");
  if (tests) copy("tests");
  if (scripts) copy("scripts");

  // Every guard shells out to git, so the scratch directory is a repository
  // from the moment it is created.
  execFileSync("git", ["init", "--quiet"], { cwd: root });

  const git = (args: string[], env?: NodeJS.ProcessEnv): string =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    }).trim();

  const fixture: RepoFixture = {
    root,

    write(relPath, contents) {
      const full = join(root, relPath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, contents);
      return full;
    },

    read(relPath) {
      return readFileSync(join(root, relPath), "utf8");
    },

    exists(relPath) {
      return existsSync(join(root, relPath));
    },

    git(args, env) {
      return git(args, env);
    },

    commitAll(message, isoDate) {
      git(["add", "--all"]);
      const dateEnv = isoDate
        ? { GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate }
        : {};
      git([...GIT_IDENTITY, "commit", "--message", message], dateEnv);
    },

    runScript(relPath, options = {}) {
      const { args = [], input, env } = options;
      const result = spawnSync(
        process.execPath,
        [join(root, relPath), ...args],
        {
          cwd: root,
          encoding: "utf8",
          input,
          env: { ...process.env, ...env },
        },
      );
      const stdout = result.stdout ?? "";
      const stderr = result.stderr ?? "";
      return {
        status: result.status,
        signal: result.signal,
        stdout,
        stderr,
        output: stdout + stderr,
        // An uncaught exception prints a Node stack trace; a guard that
        // "fails" by crashing reports nothing a contributor can act on.
        crashed: /TypeError|ReferenceError|SyntaxError|at file:/.test(stderr),
      };
    },

    dispose() {
      rmSync(root, { recursive: true, force: true });
    },
  };

  return fixture;
}

/** Run a guard from the REAL checkout (no fixture), capturing its result. */
export function runRepoScript(
  relPath: string,
  options: RunOptions = {},
): RunResult {
  const { args = [], input, env } = options;
  const result = spawnSync(process.execPath, [join(REPO_ROOT, relPath), ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    input,
    env: { ...process.env, ...env },
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return {
    status: result.status,
    signal: result.signal,
    stdout,
    stderr,
    output: stdout + stderr,
    crashed: /TypeError|ReferenceError|SyntaxError|at file:/.test(stderr),
  };
}
