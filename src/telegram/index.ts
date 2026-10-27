/**
 * Telegram transport types for the one conversation path (ADR-0003).
 *
 * The managed grammY adapter owns paired-chat ingress and sends owner replies
 * through that same chat. The generic `notify` surface is used for outbound
 * notifications; there is no second sender or alternate conversation.
 */
export interface TelegramMessageHandler {
  (text: string): void;
}

export interface TelegramAdapter {
  notify(text: string): Promise<void>;
  /** @deprecated Legacy generic ingress; the managed adapter uses onPairedMessage. */
  onMessage(handler: TelegramMessageHandler): void;
}
