/**
 * GET /health (ADR-0001).
 *
 * Reports listener health only — not LLM or Telegram reachability. `commit`
 * is injected at build time by tsup (see tsup.config.ts); `version` is passed
 * in by the extension entry from the built package so health can never report
 * a hardcoded version that drifts from the release.
 */
export interface HealthReport {
  status: "ok";
  version: string;
  commit: string;
}

declare const __PI_CARETAKER_COMMIT__: string | undefined;

function injectedCommit(): string {
  return typeof __PI_CARETAKER_COMMIT__ !== "undefined"
    ? __PI_CARETAKER_COMMIT__
    : "dev";
}

/** Pure constructor — tests pin the shape with a fake version/commit. */
export function buildHealth(version: string, commit: string): HealthReport {
  return { status: "ok", version, commit };
}

/** Production entry: build-time commit plus the caller-supplied version. */
export function getHealth(version: string): HealthReport {
  return buildHealth(version, injectedCommit());
}
