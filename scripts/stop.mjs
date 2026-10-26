#!/usr/bin/env node
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function parsePidFile(text) {
  const value = String(text).trim();
  if (!/^\d+$/.test(value) || Number(value) < 1) return null;
  return Number(value);
}
export function resolveStopPlan(pidText, fileExists = true) {
  if (!fileExists) return { running: false, reason: "missing" };
  const pid = parsePidFile(pidText);
  if (pid === null) return { running: false, reason: "invalid" };
  try { process.kill(pid, 0); return { running: true, pid }; }
  catch (error) { if (error.code === "EPERM") return { running: true, pid }; return { running: false, reason: "stale", pid }; }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
  const file = process.env.PI_CARETAKER_PID_FILE ?? new URL("../pi-caretaker.pid", import.meta.url).pathname;
  if (!existsSync(file)) { console.log("Pi caretaker is not running (pidfile missing)."); return; }
  const plan = resolveStopPlan(readFileSync(file, "utf8"));
  if (!plan.running) { unlinkSync(file); console.log("Pi caretaker is not running (stale pidfile)."); return; }
  try { process.kill(plan.pid, "SIGTERM"); } catch {}
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try { process.kill(plan.pid, 0); } catch { unlinkSync(file); console.log("Pi caretaker stopped."); return; }
    await sleep(100);
  }
  try { process.kill(plan.pid, "SIGKILL"); } catch {}
  unlinkSync(file);
  console.log("Pi caretaker stopped (SIGKILL fallback).");
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
