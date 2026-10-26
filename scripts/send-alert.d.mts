export const DEFAULT_ALERT_MESSAGE: string;

export interface AlertConfigOk {
  ok: true;
  host: string;
  port: string;
  token: string;
}

export interface AlertConfigFailure {
  ok: false;
  exitCode: number;
  message: string;
}

export type AlertConfig = AlertConfigOk | AlertConfigFailure;

export interface AlertPayload {
  source: string;
  host: string;
  event: string;
  message: string;
}

export interface AlertOutcome {
  ok: boolean;
  exitCode: number;
  log: string;
  error?: string;
}

export function parseAlertMessage(argv: string[]): string;

export function resolveAlertConfig(options: {
  env: NodeJS.ProcessEnv;
  secretsText?: string;
}): AlertConfig;

export function buildAlertPayload(message: string): AlertPayload;

export function formatAlertOutcome(
  status: number,
  bodyText: string,
  token: string,
): AlertOutcome;
