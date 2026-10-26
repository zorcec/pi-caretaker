const TELEGRAM_MESSAGE_LIMIT = 4096;
const MAX_ANSWER_CHUNKS = 4;
const CHUNK_LABEL_BUDGET = "(4/4) ".length;
const CODE_FENCE = "\u0060\u0060\u0060";

export const ANSWER_CHUNK_OFFER = "The rest was omitted; ask me to continue.";

export interface FormattedAnswerChunks {
  chunks: string[];
  hasMore: boolean;
}

type AnswerSegment =
  | { kind: "text"; text: string }
  | { kind: "fence"; opener: string; body: string; closer: string };

function splitAnswerSegments(answer: string): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  const lines = answer.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
  let plain = "";
  let opener: string | undefined;
  let body = "";

  for (const line of lines) {
    if (opener === undefined) {
      if (line.includes("\n") && /^[ \t]{0,3}```[^\r\n]*(?:\r?\n)$/u.test(line)) {
        if (plain.length > 0) segments.push({ kind: "text", text: plain });
        plain = "";
        opener = line;
      } else {
        plain += line;
      }
    } else if (/^[ \t]{0,3}```[ \t]*(?:\r?\n|$)/u.test(line)) {
      segments.push({ kind: "fence", opener, body, closer: line });
      opener = undefined;
      body = "";
    } else {
      body += line;
    }
  }

  if (opener !== undefined) segments.push({ kind: "fence", opener, body, closer: CODE_FENCE });
  else if (plain.length > 0) segments.push({ kind: "text", text: plain });
  return segments;
}

function splitParagraphs(text: string): string[] {
  const units: string[] = [];
  const separator = /\r?\n[ \t]*\r?\n(?:[ \t]*\r?\n)*/gu;
  let start = 0;
  for (const match of text.matchAll(separator)) {
    const end = match.index + match[0].length;
    units.push(text.slice(start, end));
    start = end;
  }
  if (start < text.length) units.push(text.slice(start));
  return units;
}

function takeCodePoints(text: string, maxUnits: number): [string, string] {
  let end = 0;
  let units = 0;
  for (const character of text) {
    if (units + character.length > maxUnits) break;
    units += character.length;
    end += character.length;
  }
  if (end === 0 && text.length > 0) end = text.codePointAt(0)! > 0xffff ? 2 : 1;
  return [text.slice(0, end), text.slice(end)];
}

function splitAtLimit(text: string, maxUnits: number): string[] {
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    const [part, rest] = takeCodePoints(remaining, maxUnits);
    parts.push(part);
    remaining = rest;
  }
  return parts;
}

function isFenceStart(text: string): boolean {
  return /^[ \t]{0,3}```/u.test(text);
}

export function formatAnswerChunks(answer: string): FormattedAnswerChunks {
  if (answer.length <= TELEGRAM_MESSAGE_LIMIT) {
    return { chunks: [answer], hasMore: false };
  }

  const bodyLimit = TELEGRAM_MESSAGE_LIMIT - CHUNK_LABEL_BUDGET;
  const rawChunks: string[] = [];
  let current = "";
  let hasMore = false;

  const emit = (chunk: string): void => {
    rawChunks.push(chunk);
    if (rawChunks.length > MAX_ANSWER_CHUNKS) hasMore = true;
  };
  const flush = (): void => {
    if (current.length === 0) return;
    emit(current);
    current = "";
  };
  const appendText = (text: string): void => {
    let remaining = text;
    while (remaining.length > 0 && !hasMore) {
      const available = bodyLimit - current.length;
      if (remaining.length <= available) {
        current += remaining;
        return;
      }
      if (current.length > 0) {
        flush();
        continue;
      }
      const [part, rest] = takeCodePoints(remaining, bodyLimit);
      current = part;
      flush();
      remaining = rest;
    }
  };
  const appendFence = (segment: Extract<AnswerSegment, { kind: "fence" }>): void => {
    const whole = segment.opener + segment.body + segment.closer;
    if (current.length + whole.length <= bodyLimit) {
      current += whole;
      return;
    }
    flush();
    if (whole.length <= bodyLimit) {
      current = whole;
      return;
    }

    const bodyLimitInsideFence = bodyLimit - segment.opener.length - Math.max(4, segment.closer.length);
    if (bodyLimitInsideFence <= 0) {
      appendText(whole);
      return;
    }
    const parts = splitAtLimit(segment.body, bodyLimitInsideFence);
    if (parts.length === 0) {
      appendText(whole);
      return;
    }
    parts.forEach((part, index) => {
      if (hasMore) return;
      const isLast = index === parts.length - 1;
      const close = isLast
        ? segment.closer
        : `${part.endsWith("\n") || part.endsWith("\r") ? "" : "\n"}${CODE_FENCE}`;
      if (isLast) current = segment.opener + part + close;
      else emit(segment.opener + part + close);
    });
  };

  for (const segment of splitAnswerSegments(answer)) {
    if (hasMore) break;
    if (segment.kind === "fence") appendFence(segment);
    else for (const paragraph of splitParagraphs(segment.text)) {
      appendText(paragraph);
      if (hasMore) break;
    }
  }
  flush();

  const selected = rawChunks.slice(0, MAX_ANSWER_CHUNKS);
  const total = hasMore ? MAX_ANSWER_CHUNKS : selected.length;
  return {
    chunks: selected.map((chunk, index) => {
      const label = `(${index + 1}/${total})`;
      return `${label}${isFenceStart(chunk) ? "\n" : " "}${chunk}`;
    }),
    hasMore,
  };
}
