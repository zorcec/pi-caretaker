export function parsePidFile(text: string): number | null;
export type StopPlan = { running: true; pid: number } | { running: false; reason: "missing" | "invalid" | "stale"; pid?: number };
export function resolveStopPlan(pidText: string, fileExists?: boolean): StopPlan;
