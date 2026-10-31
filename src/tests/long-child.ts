/**
 * A real, long-running child process to stand in for an engine binary.
 *
 * The abort tests must kill a PROCESS, not a promise: a fake exec that merely
 * rejects when its signal aborts proves the signal arrived at the fake, which
 * is the author's artifact (CLAUDE.md rule 5), not that a child dies. So each
 * test keeps the engine's REAL exec / launch function and swaps only the
 * command and argv for this one — a Node process that writes its pid to a file
 * and then sleeps for a minute. Killed promptly is the only way it is gone
 * within a test's bound.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** How long the stand-in sleeps: far past any bound a test asserts. */
export const LONG_CHILD_MS = 60_000;

export interface LongChild {
  /** The command to run in place of the engine binary. */
  command: string;
  /** Its argv: write the pid to `pidFile`, then sleep. */
  args: string[];
  pidFile: string;
}

/** A stand-in whose pid lands in `dir/<name>.pid`. */
export function longChild(dir: string, name = "child"): LongChild {
  const pidFile = path.join(dir, `${name}.pid`);
  return {
    command: process.execPath,
    args: [
      "-e",
      `require("fs").writeFileSync(process.argv[1], String(process.pid)); setTimeout(() => {}, ${LONG_CHILD_MS});`,
      pidFile,
    ],
    pidFile,
  };
}

/** Is a process with this pid alive? (`kill 0` sends nothing; it only asks.) */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists, we may not signal it. ESRCH: it is gone.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Wait for the stand-in to report its pid (it is running from then on). */
export async function waitForPid(pidFile: string, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (existsSync(pidFile)) {
      const text = readFileSync(pidFile, "utf8").trim();
      const pid = Number(text);
      if (Number.isInteger(pid) && pid > 0) return pid;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`the stand-in child never started (${pidFile})`);
}

/** Wait until `pid` is gone, or the bound passes; returns whether it is gone. */
export async function waitForExit(pid: number, timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!isAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return !isAlive(pid);
}
