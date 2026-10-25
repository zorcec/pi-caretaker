import { describe, expect, it } from "vitest";
import { extension } from "../src/index.js";
import { handlePostEvents, TRIAGE_INSTRUCTIONS } from "../src/events.js";

// The scaffold contract, pinned as it stands today.
//
// Every test below documents a `not implemented` stub, so each one turns RED
// the moment its ticket lands — on purpose. When TODO(pi-caretaker-1) (the
// authenticated listener + queue admission) ships, delete this file and let
// tests/e2e/webhook.e2e.test.ts replace it with real listener assertions. A
// stub that silently became real is exactly what must not go unnoticed.
describe("scaffold state", () => {
  it("exposes the extension entry under the expected name and version", () => {
    expect(extension.name).toBe("pi-caretaker");
    expect(extension.version).toBe("0.1.0");
  });

  it("activation is still a stub naming its ticket", () => {
    expect(() => extension.activate()).toThrow(/not implemented/);
    expect(() => extension.activate()).toThrow(/TODO\(pi-caretaker-1\)/);
  });

  it("POST /events admission is still a stub naming its ticket", () => {
    expect(() => handlePostEvents({ headers: {}, rawBody: "{}" })).toThrow(
      /not implemented/,
    );
  });

  it("the triage instruction channel stays a fixed repo-owned string", () => {
    // Cheap standing pin for the data/instruction split: the constant must be
    // a literal owned by this file's module, never assembled from input.
    expect(TRIAGE_INSTRUCTIONS).toBeTypeOf("string");
    expect(TRIAGE_INSTRUCTIONS).not.toContain("{{");
    expect(TRIAGE_INSTRUCTIONS).not.toContain("eventText");
  });
});
