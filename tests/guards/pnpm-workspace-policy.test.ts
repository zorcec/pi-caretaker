import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const POLICY_NAMES = [
  "bufferutil",
  "es5-ext",
  "utf-8-validate",
  "@google/genai",
  "protobufjs",
];

async function allowBuildsEntries(): Promise<Map<string, string>> {
  const workspace = await readFile(new URL("../../pnpm-workspace.yaml", import.meta.url), "utf8");
  const lines = workspace.split(/\r?\n/);
  const start = lines.indexOf("allowBuilds:");
  if (start === -1) return new Map();
  const entries = new Map<string, string>();
  for (const line of lines.slice(start + 1)) {
    if (line !== "" && !line.startsWith(" ") && !line.startsWith("\t")) break;
    const entry = /^\s+['"]?([^:'"]+)['"]?:\s*(true|false)\s*$/.exec(line);
    if (entry?.[1] !== undefined && entry[2] !== undefined) entries.set(entry[1], entry[2]);
  }
  return entries;
}

describe("pnpm workspace build-script policy", () => {
  it.each(POLICY_NAMES)("explicitly denies install scripts for %s", async (packageName) => {
    const entries = await allowBuildsEntries();
    expect(entries.get(packageName)).toBe("false");
  });
});
