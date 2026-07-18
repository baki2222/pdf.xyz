// @vitest-environment node
/**
 * End-to-end smoke test for the real `pnpm worker:release-decision-trend` CLI: it spawns the actual binary (via tsx),
 * which reads committed content-free decision-index window fixtures and composes the trend summary — the tier the
 * in-process tests cannot cover (real spawn, real filesystem, real stdin, real output file). The fixtures are
 * self-consistent + content-free, so the exit code is deterministic regardless of the wall clock.
 */

import { describe, expect, it } from "vitest";
import { runWorkerCliSync } from "@/tests/run-worker-cli";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SPAWN_TIMEOUT_MS = 60_000;
const D = "docs/examples/release-decision-trend";
const S = `${D}/window-stable.json`;
const W = `${D}/window-watch.json`;
const INS = `${D}/window-insufficient.json`;
const B = `${D}/window-blocked.json`;
const TAMP = `${D}/window-tampered.json`;
const NOT = `${D}/not-a-decision-index.json`;

function runCli(
  args: string[],
  input?: string,
): { status: number; stdout: string } {
  try {
    const stdout = runWorkerCliSync(
      ["-s", "worker:release-decision-trend", ...args],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
        encoding: "utf8",
        timeout: SPAWN_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        ...(input !== undefined ? { input } : {}),
      },
    );
    return { status: 0, stdout };
  } catch (err) {
    const e = err as {
      status?: number | null;
      signal?: string | null;
      stdout?: string;
    };
    if (typeof e.status === "number")
      return { status: e.status, stdout: String(e.stdout ?? "") };
    throw err; // killed by a signal / spawn failure — surface it
  }
}

describe("worker:release-decision-trend CLI smoke", () => {
  it(
    "--help exits 0 and prints usage",
    () => {
      const r = runCli(["--help"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/release decision index trend summary/i);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an unknown flag / no window supplied / stdin+file is a usage error (exit 1)",
    () => {
      expect(runCli(["--nope"]).status).toBe(1);
      expect(runCli([]).status).toBe(1);
      expect(runCli(["--stdin", "--file=x"]).status).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a clean history of stable windows → stable (exit 0)",
    () => {
      const r = runCli([`--file=${S}`, `--file=${S}`, `--file=${S}`, "--json"]);
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.schema).toBe("pdfxyz.release-decision-trend/1");
      expect(parsed.trend.verdict).toBe("stable");
      expect(parsed.summary.windowsUsable).toBe(3);
      expect(parsed.summary.windowVerdictCounts.stable).toBe(3);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a recovering / worsening arc → improving (exit 0) / degrading (exit 3)",
    () => {
      expect(runCli([`--file=${W}`, `--file=${S}`, "--json"]).status).toBe(0);
      const deg = runCli([`--file=${S}`, `--file=${W}`, "--json"]);
      expect(deg.status).toBe(3);
      expect(JSON.parse(deg.stdout).trend.verdict).toBe("degrading");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an only-insufficient history → insufficient (exit 2)",
    () => {
      const r = runCli([`--file=${INS}`, `--file=${INS}`, "--json"]);
      expect(r.status).toBe(2);
      expect(JSON.parse(r.stdout).trend.verdict).toBe("insufficient");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a blocked window → blocked (exit 4)",
    () => {
      const r = runCli([`--file=${S}`, `--file=${B}`, "--json"]);
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).trend.reasons).toContain("window-blocked");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a tampered window, or an unreadable decoy → invalid (exit 4), never a fabricated pass",
    () => {
      const t = runCli([`--file=${S}`, `--file=${TAMP}`, "--json"]);
      expect(t.status).toBe(4);
      expect(JSON.parse(t.stdout).trend.reasons).toContain("window-tampered");
      const n = runCli([`--file=${S}`, `--file=${NOT}`, "--json"]);
      expect(n.status).toBe(4);
      expect(JSON.parse(n.stdout).summary.windowsUnreadable).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "--strict escalates a non-stable history to blocked (exit 4); a clean one is untouched (exit 0)",
    () => {
      expect(runCli([`--file=${S}`, `--file=${W}`, "--strict"]).status).toBe(4);
      expect(runCli([`--file=${S}`, `--file=${S}`, "--strict"]).status).toBe(0);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reads a JSON array of windows from stdin (--stdin)",
    () => {
      const arr = JSON.stringify([
        JSON.parse(readFileSync(S, "utf8")),
        JSON.parse(readFileSync(B, "utf8")),
      ]);
      const r = runCli(["--stdin", "--json"], arr);
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).trend.verdict).toBe("blocked");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reads an NDJSON stream of windows from stdin (--stdin)",
    () => {
      const nd = [readFileSync(S, "utf8"), readFileSync(S, "utf8")]
        .map((s) => JSON.stringify(JSON.parse(s)))
        .join("\n");
      const r = runCli(["--stdin", "--json"], nd);
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout).summary.windowsUsable).toBe(2);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "writes to --output without printing to stdout",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "release-decision-trend-"));
      const out = join(dir, "trend.json");
      try {
        const r = runCli([`--file=${S}`, `--output=${out}`]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe("");
        expect(JSON.parse(readFileSync(out, "utf8")).trend.verdict).toBe(
          "stable",
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "never leaks the fixture path or filename into the result",
    () => {
      // Use the clean stable history (no reasons fire), so no fixture stem can appear as a legitimate reason id.
      // (`window-stable` is not a reason id; `window-blocked` / `window-watch` etc. are, so they must not be used here.)
      const r = runCli([`--file=${S}`, `--file=${S}`, "--text"]);
      expect(r.stdout).not.toContain("docs/examples");
      expect(r.stdout).not.toContain(".json");
      expect(r.stdout).not.toContain("window-stable");
    },
    SPAWN_TIMEOUT_MS,
  );
});
