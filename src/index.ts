/**
 * pi-caretaker extension entry (ADR-0001, ADR-0003, ADR-0004).
 *
 * A native Pi extension: authenticated webhook listener, in-memory queue,
 * background event turns, and one owned Telegram conversation. Entry shape
 * only — activation wiring lands in its own ticket.
 */
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
