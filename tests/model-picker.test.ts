import { describe, expect, it, vi } from "vitest";
import { prioritizeConfiguredModels, readConfiguredModelIds } from "../src/model-picker.js";

describe("configured model picker", () => {
  it("reads at most five configured provider/id entries in owner order", () => {
    const read = vi.fn(() => JSON.stringify({ models: ["p/third", "q/first", "r/fifth", "s/fourth", "t/second"] }));
    expect(readConfiguredModelIds(read)).toEqual(["p/third", "q/first", "r/fifth", "s/fourth", "t/second"]);
  });

  it("only selects configured entries Pi reports available, preserving configured ordering", () => {
    const first = { provider: "q", id: "first" };
    const second = { provider: "p", id: "second" };
    expect(prioritizeConfiguredModels([first, second], ["p/second", "private/hidden", "q/first"])).toEqual([second, first]);
  });

  it("falls back for absent, malformed, empty, and overlong config", () => {
    const available = [{ provider: "p", id: "one" }, { provider: "q", id: "two" }];
    expect(readConfiguredModelIds(() => { throw new Error("missing"); })).toEqual([]);
    expect(readConfiguredModelIds(() => "{broken")).toEqual([]);
    expect(readConfiguredModelIds(() => JSON.stringify({ models: [] }))).toEqual([]);
    expect(readConfiguredModelIds(() => JSON.stringify({ models: ["a/1", "b/2", "c/3", "d/4", "e/5", "f/6"] }))).toEqual([]);
    expect(prioritizeConfiguredModels(available, [])).toEqual(available);
    expect(prioritizeConfiguredModels(available, ["not-configured/anywhere"])).toEqual([]);
  });

  it("rejects credential-like config fields without exposing their values", () => {
    const sentinel = "synthetic-credential-sentinel-not-a-secret";
    const input = JSON.stringify({ models: ["safe-provider/safe-model"], credential: sentinel });
    const configured = readConfiguredModelIds(() => input);
    const displayed = prioritizeConfiguredModels([{ provider: "safe-provider", id: "safe-model" }], configured);
    const diagnostic = `invalid model picker configuration`;
    expect(configured).toEqual([]);
    expect(displayed.map(({ provider, id }) => `${provider}/${id}`)).toEqual(["safe-provider/safe-model"]);
    expect(JSON.stringify({ displayed, diagnostic })).not.toContain(sentinel);
  });

  it("rejects malformed entries as a whole configuration", () => {
    expect(readConfiguredModelIds(() => JSON.stringify({ models: ["valid/model", "not-qualified"] }))).toEqual([]);
  });
});
