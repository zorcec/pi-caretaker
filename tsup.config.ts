import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

// Package version injected into the entry at build time (owner decision
// 2026-10-25: the reported version is the built package's version, never a
// hardcoded string). Falls back to "dev" outside a built bundle.
function commitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "dev";
  }
}

function packageVersion(): string {
  try {
    const manifest = JSON.parse(
      readFileSync(new URL("./package.json", import.meta.url), "utf8"),
    );
    if (typeof manifest.version === "string" && manifest.version.length > 0) {
      return manifest.version;
    }
  } catch {
    // fall through to dev
  }
  return "dev";
}

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  define: {
    __PI_CARETAKER_COMMIT__: JSON.stringify(commitSha()),
    __PI_CARETAKER_VERSION__: JSON.stringify(packageVersion()),
  },
});
