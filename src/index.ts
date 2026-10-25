/**
 * pi-caretaker extension entry (ADR-0001, ADR-0003, ADR-0004).
 *
 * A native Pi extension: authenticated webhook listener, in-memory queue,
 * background event turns, and one owned Telegram conversation. The listener
 * factory is re-exported here so activation (a later ticket) and tests share
 * one construction surface; activation itself still throws until its
 * wiring/environment ticket lands.
 */
export {
  createWebhookListener,
  type WebhookListenerOptions,
} from "./listener.js";
export interface CaretakerExtension {
  name: string;
  version: string;
  activate(): void;
}

export const extension: CaretakerExtension = {
  name: "pi-caretaker",
  version: "0.1.0",
  activate(): void {
    throw new Error(
      "not implemented: extension activation (TODO(pi-caretaker-1): listener + queue wiring ticket)",
    );
  },
};
