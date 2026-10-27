import { createInterface } from "node:readline";
import { StringDecoder } from "node:string_decoder";

function askLine(input, output, question) {
  return new Promise((resolve) => {
    const terminal = Boolean(input.isTTY && output.isTTY);
    const lineReader = createInterface({ input, output, terminal });
    let settled = false;
    const onClose = () => {
      if (settled) return;
      settled = true;
      resolve(null);
    };
    lineReader.once("close", onClose);
    lineReader.question(question, (answer) => {
      if (settled) return;
      settled = true;
      lineReader.removeListener("close", onClose);
      lineReader.close();
      resolve(answer);
    });
  });
}

function askHidden(input, output, question) {
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    return Promise.reject(new Error("hidden password input requires an interactive terminal"));
  }
  const wasRaw = input.isRaw === true;
  const decoder = new StringDecoder("utf8");
  output.write(question);
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve) => {
    let answer = "";
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      input.removeListener("data", onData);
      input.removeListener("close", onClose);
      input.setRawMode(wasRaw);
      output.write("\n");
      resolve(result);
    };
    const onClose = () => finish(null);
    const onData = (chunk) => {
      for (const character of decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))) {
        if (character === "\u0003" || character === "\u0004") {
          finish(null);
          return;
        }
        if (character === "\r" || character === "\n") {
          finish(answer);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          answer = Array.from(answer).slice(0, -1).join("");
          continue;
        }
        answer += character;
      }
    };
    input.on("data", onData);
    input.once("close", onClose);
  });
}

/** @typedef {import("node:stream").Readable & {isTTY?: boolean, isRaw?: boolean, setRawMode?: (mode: boolean) => void}} PromptInput */
/** @typedef {import("node:stream").Writable & {isTTY?: boolean}} PromptOutput */

/** @param {{input?: PromptInput, output?: PromptOutput}} [streams] */
export function createPrompt({ input = process.stdin, output = process.stdout } = {}) {
  return (question, { hidden = false } = {}) => hidden
    ? askHidden(input, output, question)
    : askLine(input, output, question);
}
