import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REPO_ROOT } from "../setup/repo-fixture.js";

/**
 * Artifact e2e — the tier that proves the package users actually install.
 *
 * Source-level tests cannot see build-time `define` substitution: a broken
 * tsup config still leaves every vitest assertion green because the tests
 * import `src/`. So this suite runs the real build into a scratch directory
 * (never `dist/`) and asserts on the emitted files.
 */

const TSUP = join(REPO_ROOT, "node_modules", ".bin", "tsup");

interface BuiltHealth {
  buildHealth(version: string, commit: string): { status: string; version: string; commit: string };
  getHealth(version: string): { status: string; version: string; commit: string };
}

interface BuiltIndex {
  extension: { name: string; version: string; activate(): void };
}

let outDir: string;

function built(file: string): string {
  return pathToFileURL(join(outDir, file)).href;
}

function shortHead(): string {
  return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
}

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), "pi-caretaker-build-"));
  // Two entries: the packaged entry, and the health module — which the entry
  // does not import yet (see the todo at the bottom of this file), so it has
  // to be built explicitly for its injected commit to be observable.
  execFileSync(TSUP, ["-d", outDir, "src/index.ts", "src/health.ts"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
}, 180_000);

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

describe("built artifact", () => {
  it("emits the entry and health bundles with their declarations", () => {
    for (const file of ["index.js", "index.d.ts", "health.js", "health.d.ts"]) {
      expect(existsSync(join(outDir, file)), `${file} was not emitted`).toBe(
        true,
      );
    }
  });

  it("reports the deployed commit — injected by tsup, not read at runtime", async () => {
    const health = (await import(built("health.js"))) as BuiltHealth;

    expect(health.getHealth("9.9.9")).toEqual({
      status: "ok",
      version: "9.9.9",
      commit: shortHead(),
    });
  });

  it("leaves no compile-time placeholder in the emitted bundle", () => {
    const source = readFileSync(join(outDir, "health.js"), "utf8");
    expect(source).not.toContain("__PI_CARETAKER_COMMIT__");
  });

  it("exposes the extension surface from the packaged entry", async () => {
    const entry = (await import(built("index.js"))) as BuiltIndex;

    expect(entry.extension.name).toBe("pi-caretaker");
    expect(entry.extension.version).toBe("0.1.0");
    expect(() => entry.extension.activate()).toThrow(/not implemented/);
  });

  it("emits a declaration for the extension contract", () => {
    const dts = readFileSync(join(outDir, "index.d.ts"), "utf8");
    expect(dts).toContain("CaretakerExtension");
    expect(dts).toContain("activate");
  });

  // src/index.ts never imports src/health.ts, so the health report (and the
  // commit injection behind it) is absent from the packaged entry: a consumer
  // cannot reach GET /health from `dist/index.js` at all. The tsup `define`
  // is therefore unreachable through the public surface — this todo becomes a
  // real assertion as soon as the HTTP listener ticket wires health in.
  it.todo(
    "GET /health is reachable from the packaged entry, carrying the injected commit",
  );
});
