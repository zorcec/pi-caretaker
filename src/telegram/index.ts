/**
 * The single Telegram path (ADR-0003).
 *
 * This project owns the Telegram conversation: `notify(text)` is the only way
 * pi-caretaker sends a Telegram message, and `onMessage(handler)` is the only
 * inbound path. No second notifier may also post here. Interface only — the
 * adapter (Pitgram validation first, grammY fallback) lands in its own ticket.
 */
export interface TelegramMessageHandler {
  (text: string): void;
}

export interface TelegramAdapter {
  notify(text: string): Promise<void>;
  onMessage(handler: TelegramMessageHandler): void;
}
