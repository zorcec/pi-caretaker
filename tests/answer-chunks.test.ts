import { describe, expect, it } from "vitest";
import { ANSWER_CHUNK_OFFER, formatAnswerChunks } from "../src/answer-chunks.js";

function chunkBody(chunk: string): string {
  return chunk.replace(/^\(\d+\/\d+\)(?: |\n)/u, "");
}

function hasUnpairedSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

describe("formatAnswerChunks", () => {
  it("keeps answers below Telegram's limit byte-for-byte and does not HTML-escape", () => {
    const answer = "Plain <text> & unchanged\nsecond paragraph";
    expect(formatAnswerChunks(answer)).toEqual({ chunks: [answer], hasMore: false });
  });

  it("splits long multi-paragraph answers at safe boundaries and numbers chunks", () => {
    const first = "first paragraph ".repeat(180);
    const second = "second paragraph ".repeat(180);
    const answer = `${first}\n\n${second}`;
    const result = formatAnswerChunks(answer);
    expect(result.hasMore).toBe(false);
    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0]).toMatch(/^\(1\/2\) /u);
    expect(result.chunks[1]).toMatch(/^\(2\/2\) /u);
    expect(result.chunks.every((chunk) => chunk.length <= 4096)).toBe(true);
    expect(result.chunks.map(chunkBody)).toEqual([`${first}\n\n`, second]);
  });

  it("splits emoji and CJK text without splitting a surrogate pair", () => {
    const answer = "😀漢字🚀水火".repeat(900);
    const result = formatAnswerChunks(answer);
    expect(result.chunks.length).toBeGreaterThan(1);
    expect(result.chunks.every((chunk) => !hasUnpairedSurrogate(chunk))).toBe(true);
    expect(result.chunks.map(chunkBody).join("")).toBe(answer);
  });

  it("closes and reopens a fenced code block when the block spans chunks", () => {
    const body = "const item = 1;\n".repeat(400);
    const answer = `intro\n\n\`\`\`ts\n${body}\`\`\`\n\nend`;
    const result = formatAnswerChunks(answer);
    expect(result.chunks.length).toBeGreaterThanOrEqual(3);
    const codeChunks = result.chunks.filter((chunk) => chunk.includes("```ts"));
    expect(codeChunks).toHaveLength(2);
    expect(codeChunks[0]).toMatch(/\n```$/u);
    expect(codeChunks[1]).toMatch(/^\(\d+\/\d+\)\n```ts\n/u);
    expect(codeChunks[1]).toMatch(/```\n\nend$/u);
    expect(result.chunks.every((chunk) => chunk.length <= 4096)).toBe(true);
  });

  it("hard-splits one oversized paragraph on code-point boundaries", () => {
    const answer = "line-😀-漢".repeat(900);
    const result = formatAnswerChunks(answer);
    expect(result.hasMore).toBe(false);
    expect(result.chunks.length).toBeGreaterThan(1);
    expect(result.chunks.every((chunk) => chunk.length <= 4096 && !hasUnpairedSurrogate(chunk))).toBe(true);
    expect(result.chunks.map(chunkBody).join("")).toBe(answer);
  });

  it("caps output at four numbered chunks and reports that more remains", () => {
    const result = formatAnswerChunks("x".repeat(4096 * 8));
    expect(result.chunks).toHaveLength(4);
    expect(result.chunks.map((chunk) => chunk.slice(0, 5))).toEqual(["(1/4)", "(2/4)", "(3/4)", "(4/4)"]);
    expect(result.chunks.every((chunk) => chunk.length <= 4096)).toBe(true);
    expect(result.hasMore).toBe(true);
    expect(ANSWER_CHUNK_OFFER).toBe("The rest was omitted; ask me to continue.");
  });
});
