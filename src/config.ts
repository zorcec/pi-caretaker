/**
 * Runtime configuration (ADR-0005; env only — never files, never secrets in logs).
 *
 * The names below are the owner-approved operator contract (decided
 * 2026-10-25). Renaming a key is a compatible change to one place
 * (readCaretakerConfig) plus its tests; changing requiredness, defaults,
 * or validation updates ADR-0005 in the same commit. Values never appear in
 * errors or logs.
 */
export interface CaretakerConfig {
  /** Bearer token POST /events must present. No default — required. */
  token: string;
  /** Interface the webhook listener binds. Default 127.0.0.1. */
  host: string;
  /**
   * Webhook listener port. Default 8787 (deliberately not 3700 — that is
   * the owner's dev-board port and must never be bound by accident).
   * 0 means OS-assigned (tests).
   */
  port: number;
  /** In-memory queue capacity. Default 100. */
  queueCapacity: number;
}

export type ConfigurationErrorCode =
  | "MISSING_WEBHOOK_TOKEN"
  | "INVALID_PORT"
  | "INVALID_QUEUE_CAPACITY";

export class ConfigurationError extends Error {
  readonly code: ConfigurationErrorCode;
  constructor(code: ConfigurationErrorCode, message: string) {
    super(message);
    this.name = "ConfigurationError";
    this.code = code;
  }
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const DEFAULT_QUEUE_CAPACITY = 100;

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ConfigurationError(
      "INVALID_PORT",
      "PI_CARETAKER_PORT must be an integer between 0 and 65535",
    );
  }
  return port;
}

function parseCapacity(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_QUEUE_CAPACITY;
  const capacity = Number(raw);
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new ConfigurationError(
      "INVALID_QUEUE_CAPACITY",
      "PI_CARETAKER_ALERTS_QUEUE_CAPACITY must be a positive integer",
    );
  }
  return capacity;
}

/**
 * Read and validate the caretaker configuration. Takes the env record as a
 * parameter so tests never mutate process.env; the entry passes the real one.
 */
export function readCaretakerConfig(
  env: NodeJS.ProcessEnv,
): CaretakerConfig {
  const token = env["PI_CARETAKER_TOKEN"];
  if (typeof token !== "string" || token.length === 0) {
    throw new ConfigurationError(
      "MISSING_WEBHOOK_TOKEN",
      "PI_CARETAKER_TOKEN is required: set a bearer token for POST /events",
    );
  }
  const host =
    env["PI_CARETAKER_HOST"] === undefined ||
    env["PI_CARETAKER_HOST"] === ""
      ? DEFAULT_HOST
      : env["PI_CARETAKER_HOST"];
  return {
    token,
    host,
    port: parsePort(env["PI_CARETAKER_PORT"]),
    queueCapacity: parseCapacity(env["PI_CARETAKER_ALERTS_QUEUE_CAPACITY"]),
  };
}
