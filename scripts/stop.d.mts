export function parsePidFile(text: string): number | null;
export type StopPlan = { running: true; pid: number } | { running: false; reason: "missing" | "invalid" | "stale"; pid?: number };
export function resolveStopPlan(
  pidText: string,
  fileExists?: boolean,
  kill?: (pid: number, signal: number | NodeJS.Signals) => void,
): StopPlan;

export interface StopPreviousInstanceDeps {
  pidFile: string;
  exists?: (path: string) => boolean;
  readFile?: (path: string, encoding: "utf8") => string;
  unlink?: (path: string) => void;
  kill?: (pid: number, signal: number | NodeJS.Signals) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export type StopPreviousInstanceResult =
  | { stopped: true; pid: number; forced: boolean }
  | { stopped: false; reason: "missing" | "invalid" | "stale" };

export function stopPreviousInstance(
  deps: StopPreviousInstanceDeps,
): Promise<StopPreviousInstanceResult>;
