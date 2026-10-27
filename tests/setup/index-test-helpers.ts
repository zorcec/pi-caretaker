import { vi } from "vitest";
import piCaretaker from "../../src/index.js";
import { createFakePi, fakeContext } from "./fake-pi.js";

export function attachManaged(fake: ReturnType<typeof createFakePi>) {
    const calls: { type: string; args: unknown[] }[] = [];
    const inboundHandlers: ((text: string, messageId: number) => void)[] = [];
    const commands = new Map<string, Set<(messageId: number) => void>>();
    const commandCallbacks = new Set<(data: string, messageId: number) => void>();
    const managed = {
      notify: vi.fn(async (...args: unknown[]) => { calls.push({ type: "notify", args }); }),
      onMessage: vi.fn(),
      onPairedMessage: vi.fn((handler: (text: string, messageId: number) => void) => { inboundHandlers.push(handler); }),
      onCommand: vi.fn((name: string, handler: (messageId: number) => void) => {
        const handlers = commands.get(name) ?? new Set<(messageId: number) => void>();
        handlers.add(handler);
        commands.set(name, handlers);
      }),
      onCommandCallback: vi.fn((handler: (data: string, messageId: number) => void) => { commandCallbacks.add(handler); }),
      react: vi.fn(async (...args: unknown[]) => { calls.push({ type: "react", args }); }),
      sendChatAction: vi.fn(async (...args: unknown[]) => { calls.push({ type: "typing", args }); }),
      sendMessage: vi.fn(async (...args: unknown[]): Promise<number> => {
        calls.push({ type: "send", args });
        return args[0] === "working…" ? 72 : 73;
      }),
      editMessageText: vi.fn(async (...args: unknown[]) => { calls.push({ type: "edit", args }); }),
    };
    const piControls = fake.api as unknown as { getThinkingLevel: () => string; setThinkingLevel: (level: string) => void; setModel: (model: unknown) => Promise<boolean> };
    piControls.getThinkingLevel = () => "minimal";
    piControls.setThinkingLevel = vi.fn();
    piControls.setModel = vi.fn(async () => true);
    const controls = piCaretaker(fake.api);
    controls.attachTelegram(managed);
    return {
      calls,
      managed,
      inbound: (text: string, id: number): void => { for (const handler of inboundHandlers) handler(text, id); },
      command: (name: string, id: number): void => { for (const handler of commands.get(name) ?? []) handler(id); },
      callback: (data: string, id: number): void => { for (const handler of commandCallbacks) handler(data, id); },
      controls,
    };
  }

export async function beginRelay(fake: ReturnType<typeof createFakePi>, attached: ReturnType<typeof attachManaged>, text = "prompt", id = 29): Promise<void> {
    attached.inbound(text, id);
    await fake.handlers.get("before_agent_start")?.({ messageType: "user", prompt: text }, fakeContext(fake.notifies));
  }

export const assistantEnd = (fake: ReturnType<typeof createFakePi>, text = "answer") =>
    fake.handlers.get("agent_end")?.({ messages: [{ role: "assistant", content: [{ type: "text", text }] }] }, fakeContext(fake.notifies));


