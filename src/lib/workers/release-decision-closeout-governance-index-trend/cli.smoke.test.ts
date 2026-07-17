// @vitest-environment node
/**
 * End-to-end smoke test for the real `pnpm worker:release-decision-closeout-governance-index-trend` CLI: it spawns the
 * actual binary (via tsx), which reads committed content-free governance-index window fixtures and composes the trend
 * summary — the tier the in-process tests cannot cover (real spawn, real filesystem, real stdin, real output file). The
 * fixtures are self-consistent + content-free, so the exit code is deterministic regardless of the wall clock.
 */

import { describe, expect, it } from "vitest";
import { execPnpmSync } from "@/tests/exec-pnpm";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SPAWN_TIMEOUT_MS = 60_000;
const D = "docs/examples/release-decision-closeout-governance-index-trend";
const IDX = `${D}/window-indexed.json`;
const WATCH = `${D}/window-watch.json`;
const INC = `${D}/window-incomplete.json`;
const BLK = `${D}/window-blocked.json`;
const TAMP = `${D}/window-tampered.json`;
const NOT = `${D}/not-a-governance-index.json`;

function runCli(
  args: string[],
  input?: string,
): { status: number; stdout: string } {
  try {
    const stdout = execPnpmSync(
      [
        "-s",
        "worker:release-decision-closeout-governance-index-trend",
        ...args,
      ],
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

describe("worker:release-decision-closeout-governance-index-trend CLI smoke", () => {
  it(
    "--help exits 0 and prints usage",
    () => {
      const r = runCli(["--help"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(
        /release decision closeout governance index trend/i,
      );
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
    "a clean history of indexed windows → trend-stable (exit 0)",
    () => {
      const r = runCli([
        `--file=${IDX}`,
        `--file=${IDX}`,
        `--file=${IDX}`,
        "--json",
      ]);
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.schema).toBe(
        "pdfxyz.release-decision-closeout-governance-index-trend/1",
      );
      expect(parsed.governanceIndexTrend.verdict).toBe("trend-stable");
      expect(parsed.summary.indexesUsable).toBe(3);
      expect(parsed.summary.indexVerdictCounts.indexed).toBe(3);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a latest-open / degrading history → trend-watch (exit 3)",
    () => {
      const r = runCli([`--file=${IDX}`, `--file=${WATCH}`, "--json"]);
      expect(r.status).toBe(3);
      expect(JSON.parse(r.stdout).governanceIndexTrend.verdict).toBe(
        "trend-watch",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a flat incomplete history → trend-incomplete (exit 2)",
    () => {
      const r = runCli([`--file=${INC}`, `--file=${INC}`, "--json"]);
      expect(r.status).toBe(2);
      expect(JSON.parse(r.stdout).governanceIndexTrend.verdict).toBe(
        "trend-incomplete",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a blocked window → trend-blocked (exit 4)",
    () => {
      const r = runCli([`--file=${IDX}`, `--file=${BLK}`, "--json"]);
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).governanceIndexTrend.reasons).toContain(
        "latest-blocked",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a tampered window, or an unreadable decoy → fail-closed, never a fabricated pass",
    () => {
      const t = runCli([`--file=${IDX}`, `--file=${TAMP}`, "--json"]);
      expect(t.status).toBe(4);
      expect(JSON.parse(t.stdout).governanceIndexTrend.reasons).toContain(
        "index-tampered",
      );
      const n = runCli([`--file=${IDX}`, `--file=${NOT}`, "--json"]);
      expect(n.status).toBe(2);
      expect(JSON.parse(n.stdout).summary.indexesUnreadable).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "--strict-watch escalates a watch history to blocked (exit 4); a clean one is untouched (exit 0)",
    () => {
      expect(
        runCli([`--file=${IDX}`, `--file=${WATCH}`, "--strict-watch"]).status,
      ).toBe(4);
      expect(
        runCli([`--file=${IDX}`, `--file=${IDX}`, "--strict-watch"]).status,
      ).toBe(0);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reads a JSON array of windows from stdin (--stdin)",
    () => {
      const arr = JSON.stringify([
        JSON.parse(readFileSync(IDX, "utf8")),
        JSON.parse(readFileSync(BLK, "utf8")),
      ]);
      const r = runCli(["--stdin", "--json"], arr);
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).governanceIndexTrend.verdict).toBe(
        "trend-blocked",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reads an NDJSON stream of windows from stdin (--stdin)",
    () => {
      const nd = [readFileSync(IDX, "utf8"), readFileSync(IDX, "utf8")]
        .map((s) => JSON.stringify(JSON.parse(s)))
        .join("\n");
      const r = runCli(["--stdin", "--json"], nd);
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout).summary.indexesUsable).toBe(2);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "writes to --output without printing to stdout",
    () => {
      const dir = mkdtempSync(
        join(tmpdir(), "release-decision-closeout-governance-index-trend-"),
      );
      const out = join(dir, "trend.json");
      try {
        const r = runCli([`--file=${IDX}`, `--output=${out}`]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe("");
        expect(
          JSON.parse(readFileSync(out, "utf8")).governanceIndexTrend.verdict,
        ).toBe("trend-stable");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "never leaks the fixture path or filename into the result",
    () => {
      // Use the clean indexed history (only informational reasons), so no fixture stem can appear as a reason id.
      const r = runCli([`--file=${IDX}`, `--file=${IDX}`, "--text"]);
      expect(r.stdout).not.toContain("docs/examples");
      expect(r.stdout).not.toContain(".json");
      expect(r.stdout).not.toContain("window-indexed");
    },
    SPAWN_TIMEOUT_MS,
  );
});
