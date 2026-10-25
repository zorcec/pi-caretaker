import { describe, expect, it } from "vitest";
import { buildHealth, getHealth } from "../src/health.js";

// Pins ADR-0001 (health half): GET /health returns exactly
// {status, version, commit} with the caller-supplied version.
describe("health report", () => {
  it("returns the {status, version, commit} shape with fake values", () => {
    expect(buildHealth("9.9.9-test", "deadbee")).toEqual({
      status: "ok",
      version: "9.9.9-test",
      commit: "deadbee",
    });
  });

  it("never hardcodes the version: it echoes what the caller passes", () => {
    const a = buildHealth("0.1.0", "abc1234");
    const b = buildHealth("0.2.0", "abc1234");
    expect(a.version).toBe("0.1.0");
    expect(b.version).toBe("0.2.0");
    expect(a).not.toEqual(b);
  });

  it("getHealth reports ok with a non-empty injected commit", () => {
    const report = getHealth("0.1.0");
    expect(report.status).toBe("ok");
    expect(report.version).toBe("0.1.0");
    expect(typeof report.commit).toBe("string");
    expect(report.commit.length).toBeGreaterThan(0);
  });
});
