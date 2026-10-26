#!/usr/bin/env node
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function parsePidFile(text) {
  const value = String(text).trim();
  if (!/^\d+$/.test(value) || Number(value) < 1) return null;
  return Number(value);
}
export function resolveStopPlan(pidText, fileExists = true, kill = (pid, signal) => process.kill(pid, signal)) {
  if (!fileExists) return { running: false, reason: "missing" };
  const pid = parsePidFile(pidText);
  if (pid === null) return { running: false, reason: "invalid" };
  try { kill(pid, 0); return { running: true, pid }; }
  catch (error) { if (error.code === "EPERM") return { running: true, pid }; return { running: false, reason: "stale", pid }; }
}
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Stop the PID recorded by the caretaker pidfile, never a port's arbitrary holder. */
export async function stopPreviousInstance({
  pidFile,
  exists = existsSync,
  readFile = readFileSync,
  unlink = unlinkSync,
  kill = (pid, signal) => process.kill(pid, signal),
  sleep = defaultSleep,
  now = () => Date.now(),
  timeoutMs = 5000,
  pollIntervalMs = 100,
  readCmdline = (pid) => readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\\0", " "),
}) {
  if (!exists(pidFile)) return { stopped: false, reason: "missing" };
  const pid = parsePidFile(readFile(pidFile, "utf8"));
  if (pid === null) {
    unlink(pidFile);
    return { stopped: false, reason: "invalid" };
  }
  let cmdline;
  try {
    cmdline = readCmdline(pid);
  } catch {
    unlink(pidFile);
    return { stopped: false, reason: "stale" };
  }
  const caretakerSupervisor = cmdline.includes("start.mjs") && cmdline.includes("--supervise");
  if (!caretakerSupervisor) {
    unlink(pidFile);
    return { stopped: false, reason: "stale-foreign" };
  }
  const plan = resolveStopPlan(String(pid), true, kill);
  if (!plan.running) {
    unlink(pidFile);
    return { stopped: false, reason: plan.reason };
  }

  const signalGroup = (signal) => {
    try { kill(-plan.pid, signal); }
    catch { try { kill(plan.pid, signal); } catch {} }
  };
  signalGroup("SIGTERM");
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    try { kill(plan.pid, 0); }
    catch { unlink(pidFile); return { stopped: true, pid: plan.pid, forced: false }; }
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - now())));
  }
  signalGroup("SIGKILL");
  unlink(pidFile);
  return { stopped: true, pid: plan.pid, forced: true };
}

async function main() {
  const file = process.env.PI_CARETAKER_PID_FILE ?? new URL("../pi-caretaker.pid", import.meta.url).pathname;
  const result = await stopPreviousInstance({ pidFile: file });
  if (!result.stopped) {
    if (result.reason === "missing") console.log("Pi caretaker is not running (pidfile missing).");
    else if (result.reason === "stale-foreign") console.log("Pi caretaker is not running (stale foreign process).");
    else console.log("Pi caretaker is not running (stale pidfile).");
    return;
  }
  console.log(result.forced ? "Pi caretaker stopped (SIGKILL fallback)." : "Pi caretaker stopped.");
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
