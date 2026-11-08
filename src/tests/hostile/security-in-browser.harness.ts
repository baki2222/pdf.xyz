/**
 * Runs the security-in-browser cells in a child process
 * (`security-in-browser.runner.ts`) under a per-cell wall-clock bound. A cell
 * that overruns is recorded as `hang` and the child is killed; a child that
 * dies mid-cell is recorded as `memory` (its watchdog fired) or `crash`; in
 * both cases a fresh child resumes from the next cell.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Entry } from "./security-in-browser.cells";

export type CellResult =
  | {
      status: "ok";
      value: unknown;
      ms: number;
      peakMb: number;
      growthMb: number;
    }
  | {
      status: "threw";
      name: string;
      message: string;
      ms: number;
      peakMb: number;
      growthMb: number;
    }
  | { status: "hang"; ms: number }
  | { status: "memory"; ms: number; rssMb: number }
  | { status: "crash"; ms: number; exit: string; stderr: string };

export interface CellPlan {
  id: string;
  entry: Entry | "__hang" | "__alloc";
  /** Wall-clock bound for this cell, ms. */
  boundMs: number;
  /**
   * Run in a child of its own. RSS is not handed back to the OS after a big
   * cell, so a cell measured after one inherits its peak and its own growth
   * reads as zero — the bomb cells are isolated so each is measured cold.
   */
  isolate?: boolean;
}

const RUNNER = path.join(
  process.cwd(),
  "src/tests/hostile/security-in-browser.runner.ts",
);

export async function runCells(
  plans: readonly CellPlan[],
  opts: { rssLimitMb?: number } = {},
): Promise<CellResult[]> {
  const dir = mkdtempSync(path.join(tmpdir(), "hostile-sec-"));
  const list = path.join(dir, "cells.json");
  writeFileSync(list, JSON.stringify(plans.map((p) => [p.id, p.entry])));
  const results: (CellResult | undefined)[] = new Array(plans.length);
  try {
    let start = 0;
    while (start < plans.length) {
      // A segment ends before an isolated cell, or right after one.
      let end = start + 1;
      if (!plans[start]!.isolate)
        while (end < plans.length && !plans[end]!.isolate) end++;
      while (start < end)
        start = await runFrom(
          start,
          end,
          plans,
          list,
          results,
          opts.rssLimitMb,
        );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return results.map(
    (r) => r ?? { status: "crash", ms: 0, exit: "never ran", stderr: "" },
  );
}

/** One child from `start`; resolves with the index to resume from. */
function runFrom(
  start: number,
  end: number,
  plans: readonly CellPlan[],
  list: string,
  results: (CellResult | undefined)[],
  rssLimitMb = 1536,
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", RUNNER, list, String(start), String(end)],
      {
        cwd: process.cwd(),
        env: { ...process.env, HOSTILE_RSS_LIMIT_MB: String(rssLimitMb) },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let current = -1;
    let startedAt = 0;
    let timer: NodeJS.Timeout | undefined;
    let stdout = "";
    let stderr = "";
    let memory: number | null = null;
    let settled = false;
    // Loading tsx + pdf.js before the first cell gets its own bound.
    const arm = (ms: number, onFire: () => void) => {
      clearTimeout(timer);
      timer = setTimeout(onFire, ms);
    };
    arm(60_000, () => {
      if (current === -1) {
        stderr += "\n[harness] child never started a cell";
        child.kill("SIGKILL");
      }
    });
    child.stdout.setEncoding("latin1");
    child.stderr.setEncoding("latin1");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      let nl: number;
      while ((nl = stdout.indexOf("\n")) >= 0) {
        const line = stdout.slice(0, nl).trimEnd();
        stdout = stdout.slice(nl + 1);
        if (line.startsWith("S ")) {
          current = Number(line.slice(2));
          startedAt = Date.now();
          const bound = plans[current]!.boundMs;
          arm(bound, () => {
            results[current] = { status: "hang", ms: Date.now() - startedAt };
            child.kill("SIGKILL");
          });
        } else if (line.startsWith("R ")) {
          const sp = line.indexOf(" ", 2);
          const i = Number(line.slice(2, sp));
          results[i] = JSON.parse(line.slice(sp + 1)) as CellResult;
          clearTimeout(timer);
        }
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      const m = /(?:^|\n)M (\d+) (\d+)/.exec(stderr);
      if (m) memory = Number(m[2]);
      if (stderr.length > 20_000) stderr = stderr.slice(-10_000);
    });
    child.on("exit", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (current >= 0 && results[current] === undefined) {
        results[current] =
          memory !== null
            ? { status: "memory", ms: Date.now() - startedAt, rssMb: memory }
            : {
                status: "crash",
                ms: Date.now() - startedAt,
                exit: `code=${code} signal=${signal}`,
                stderr: stderr.slice(-600),
              };
      }
      if (current === -1) {
        // The child died before any cell: every remaining cell is a crash.
        for (let i = start; i < end; i++)
          results[i] = {
            status: "crash",
            ms: 0,
            exit: `code=${code} signal=${signal}`,
            stderr: stderr.slice(-600),
          };
        resolve(end);
        return;
      }
      // Resume after the last cell that has a result.
      let next = current + 1;
      while (next < end && results[next] !== undefined) next++;
      resolve(next);
    });
  });
}
