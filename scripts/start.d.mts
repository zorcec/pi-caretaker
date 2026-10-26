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
  /** File vars merged under the operator env — what the child Pi runs with. */
  env: NodeJS.ProcessEnv;
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

export interface PortProbeSocket {
  once(event: string, listener: (...args: unknown[]) => void): void;
  setTimeout(timeoutMs: number, callback: () => void): void;
  destroy(): void;
}

export interface PortIsFreeDeps {
  connect?: (options: { host: string; port: number }) => PortProbeSocket;
  timeoutMs?: number;
  retryDelayMs?: number;
}

export interface WaitForPortFreeDeps {
  probe?: (host: string, port: number) => Promise<boolean>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  pollIntervalMs?: number;
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

export function portIsFree(
  host: string,
  port: number,
  deps?: PortIsFreeDeps,
): Promise<boolean>;

export function waitForPortFree(
  host: string,
  port: number,
  deps?: WaitForPortFreeDeps,
): Promise<boolean>;

export type SupervisorLine =
  | { kind: "pid"; pid: number }
  | { kind: "error"; message: string };

export function parseSupervisorLine(line: string): SupervisorLine | null;

export function waitForFirstLine(
  stream: NodeJS.EventEmitter,
  options?: {
    timeoutMs?: number;
    setTimeoutFn?: (fn: () => void, ms: number) => unknown;
    clearTimeoutFn?: (id: unknown) => void;
  },
): Promise<string | null>;

export function waitForHealth(
  url: string,
  deps?: WaitForHealthDeps,
): Promise<boolean>;
