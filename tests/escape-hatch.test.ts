import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Pins ADR-0004: "must never be missed" alerts must not depend on the model
// deciding they matter. The V1 enforcement point is the triage guidance: it
// must name the deterministic escape hatch. Delete the hatch, fail the build.
describe("deterministic escape hatch", () => {
  const prompt = readFileSync(
    new URL("../src/prompts/triage.md", import.meta.url),
    "utf8",
  );

  it("names the escape hatch as deterministic, not model-judged", () => {
    expect(prompt).toMatch(/escape hatch/i);
    expect(prompt).toMatch(/must never be missed/i);
    expect(prompt).toMatch(/must not depend on the model/i);
  });

  it("lists host-dark and dead-backups as bypassing triage", () => {
    expect(prompt).toMatch(/host gone dark/i);
    expect(prompt).toMatch(/backups dead/i);
    expect(prompt).toMatch(/bypasses triage|notify\s+deterministically/i);
  });
});
