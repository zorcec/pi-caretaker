/**
 * pi-caretaker extension entry (ADR-0001, ADR-0003, ADR-0004).
 *
 * A native Pi extension: authenticated webhook listener, in-memory queue,
 * background event turns, and one owned Telegram conversation. The listener
 * factory is re-exported here so activation (a later ticket) and tests share
 * one construction surface; activation itself still throws until its
 * wiring/environment ticket lands.
 */
import {
  getHealth as buildHealth,
  type HealthReport,
} from "./health.js";

export {
  createWebhookListener,
  type WebhookListenerOptions,
} from "./listener.js";
export type { HealthReport };

/**
 * Entry-owned health accessor (ADR-0001): the packaged entry reports the
 * built package's version with the build-injected commit, so consumers of
 * dist/index.js reach the same report the future GET /health route serves.
 * Zero-argument by design — the entry supplies its own version; this is the
 * proposed shape pending owner confirmation on ticket 4ef82184.
 */
export function getHealth(): HealthReport {
  return buildHealth(extension.version);
}
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
