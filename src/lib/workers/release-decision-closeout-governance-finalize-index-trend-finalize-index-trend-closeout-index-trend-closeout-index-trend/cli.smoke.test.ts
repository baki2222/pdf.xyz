// @vitest-environment node
/**
 * End-to-end smoke over the real `pnpm worker:release-decision-…-closeout-index-trend` CLI via tsx. Deterministic exit codes
 * regardless of the wall clock, over the committed content-free window fixtures.
 */

import { describe, expect, it } from "vitest";
import { runWorkerCliSync } from "@/tests/run-worker-cli";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SPAWN_TIMEOUT_MS = 60_000;
const D =
  "docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend";
const IDX = `${D}/window-all-closed.json`;
const OPEN = `${D}/window-open.json`;
const INC = `${D}/window-incomplete.json`;
const BLK = `${D}/window-blocked.json`;
const INV = `${D}/window-invalid.json`;
const TAMP = `${D}/window-tampered.json`;
const NOT = `${D}/not-a-closeout-index.json`;
const WORKER =
  "worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend";

/** Run the CLI with `args` (and optional stdin `input`), returning its exit `status` + `stdout`. */
function runCli(
  args: string[],
  input?: string,
): { status: number; stdout: string } {
  try {
    const stdout = runWorkerCliSync(["-s", WORKER, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8",
      timeout: SPAWN_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      ...(input !== undefined ? { input } : {}),
    });
    return { status: 0, stdout };
  } catch (err) {
    const e = err as { status?: number; signal?: string; stdout?: string };
    if (typeof e.status === "number")
      return { status: e.status, stdout: String(e.stdout ?? "") };
    throw err; // a signal / spawn failure is a real error
  }
}

describe(`${WORKER} CLI smoke`, () => {
  it(
    "--help exits 0 and prints usage",
    () => {
      const { status, stdout } = runCli(["--help"]);
      expect(status).toBe(0);
      expect(stdout).toMatch(
        /release decision closeout governance finalize index trend finalize index trend closeout index trend closeout index trend/i,
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
    "a clean history of indexed windows → stable (exit 0)",
    () => {
      const { status, stdout } = runCli([
        `--file=${IDX}`,
        `--file=${IDX}`,
        `--file=${IDX}`,
        "--json",
      ]);
      expect(status).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.schema).toBe(
        "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend/1",
      );
      expect(parsed.verdict).toBe("stable");
      expect(parsed.coverage.indexesUsable).toBe(3);
      expect(parsed.windowDistribution.verdictCounts["all-closed"]).toBe(3);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an improving history → improving (exit 0); a degrading one → degrading (exit 3)",
    () => {
      const up = runCli([`--file=${OPEN}`, `--file=${IDX}`, "--json"]);
      expect(up.status).toBe(0);
      expect(JSON.parse(up.stdout).verdict).toBe("improving");

      const down = runCli([`--file=${IDX}`, `--file=${OPEN}`, "--json"]);
      expect(down.status).toBe(3);
      expect(JSON.parse(down.stdout).verdict).toBe("degrading");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a flat incomplete history → insufficient (exit 2)",
    () => {
      const { status, stdout } = runCli([
        `--file=${INC}`,
        `--file=${INC}`,
        "--json",
      ]);
      expect(status).toBe(2);
      expect(JSON.parse(stdout).verdict).toBe("insufficient");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a blocked / invalid window → blocked (exit 4)",
    () => {
      const blk = runCli([`--file=${IDX}`, `--file=${BLK}`, "--json"]);
      expect(blk.status).toBe(4);
      expect(
        JSON.parse(blk.stdout).reasons.map((r: { id: string }) => r.id),
      ).toContain("latest-blocked");

      const inv = runCli([`--file=${IDX}`, `--file=${INV}`, "--json"]);
      expect(inv.status).toBe(4);
      expect(JSON.parse(inv.stdout).verdict).toBe("blocked");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a tampered window, or an unreadable decoy → invalid (exit 4), never a fabricated pass",
    () => {
      const tamp = runCli([`--file=${IDX}`, `--file=${TAMP}`, "--json"]);
      expect(tamp.status).toBe(4);
      expect(
        JSON.parse(tamp.stdout).reasons.map((r: { id: string }) => r.id),
      ).toContain("index-tampered");

      const unreadable = runCli([`--file=${IDX}`, `--file=${NOT}`, "--json"]);
      expect(unreadable.status).toBe(4);
      expect(JSON.parse(unreadable.stdout).coverage.indexesUnreadable).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "--strict-open escalates a watch / degrading history to blocked (exit 4); a clean one is untouched (exit 0)",
    () => {
      expect(
        runCli([`--file=${IDX}`, `--file=${OPEN}`, "--strict-open"]).status,
      ).toBe(4);
      expect(
        runCli([`--file=${IDX}`, `--file=${IDX}`, "--strict-open"]).status,
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
      const { status, stdout } = runCli(["--stdin", "--json"], arr);
      expect(status).toBe(4);
      expect(JSON.parse(stdout).verdict).toBe("blocked");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reads an NDJSON stream of windows from stdin (--stdin)",
    () => {
      const nd = [readFileSync(IDX, "utf8"), readFileSync(IDX, "utf8")]
        .map((s) => JSON.stringify(JSON.parse(s)))
        .join("\n");
      const { status, stdout } = runCli(["--stdin", "--json"], nd);
      expect(status).toBe(0);
      expect(JSON.parse(stdout).coverage.indexesUsable).toBe(2);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "writes to --output without printing to stdout",
    () => {
      const dir = mkdtempSync(
        join(tmpdir(), "release-decision-closeout-index-trend-"),
      );
      const out = join(dir, "trend.json");
      try {
        const { status, stdout } = runCli([`--file=${IDX}`, `--output=${out}`]);
        expect(status).toBe(0);
        expect(stdout.trim()).toBe("");
        expect(JSON.parse(readFileSync(out, "utf8")).verdict).toBe("stable");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "never leaks the fixture path or filename into the result",
    () => {
      const { stdout } = runCli([`--file=${IDX}`, `--file=${IDX}`, "--text"]);
      expect(stdout).not.toContain("docs/examples");
      expect(stdout).not.toContain(".json");
      expect(stdout).not.toContain("window-all-closed");
    },
    SPAWN_TIMEOUT_MS,
  );
});
