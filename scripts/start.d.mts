/** Parsed secrets file: variable name to raw value. Never logged. */
export type SecretsVars = Record<string, string>;

export interface StartPlanOk {
  ok: true;
  command: string;
  args: string[];
  foreground: boolean;
  detached: boolean;
  logFile: string;
  pidFile: string;
  healthUrl: string;
}

export interface StartPlanFailure {
  ok: false;
  exitCode: number;
  message: string;
}

export type StartPlan = StartPlanOk | StartPlanFailure;

export interface WaitForHealthDeps {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

export function parseSecretsEnv(text: string): SecretsVars;

export function resolveStartConfig(options: {
  env: NodeJS.ProcessEnv;
  secretsText?: string;
  hasDist: boolean;
  foreground?: boolean;
  root?: string;
}): StartPlan;

export function buildRpcBootInput(): string[];

export function waitForHealth(
  url: string,
  deps?: WaitForHealthDeps,
): Promise<boolean>;
