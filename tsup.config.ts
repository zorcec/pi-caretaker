import { execSync } from "node:child_process";
import { defineConfig } from "tsup";

// Commit SHA injected into GET /health at build time (ADR-0001: health must
// report the deployed commit, never a hardcoded string). Falls back to "dev"
// for local builds with no git checkout.
function commitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "dev";
  }
}

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  define: {
    __PI_CARETAKER_COMMIT__: JSON.stringify(commitSha()),
  },
});
