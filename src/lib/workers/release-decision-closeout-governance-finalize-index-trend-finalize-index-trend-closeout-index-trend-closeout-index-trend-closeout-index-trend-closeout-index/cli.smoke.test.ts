// @vitest-environment node
/**
 * End-to-end smoke test for the real
 * `pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index` CLI: it
 * spawns the actual binary (via tsx), which reads committed content-free closeout-record fixtures and composes the
 * closeout index — the tier the in-process tests cannot cover (real spawn, real filesystem, real stdin, real output
 * file). The fixtures are self-consistent + content-free, so the exit code is deterministic regardless of the wall clock.
 */

import { describe, expect, it } from "vitest";
import { runWorkerCliSync } from "@/tests/run-worker-cli";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SPAWN_TIMEOUT_MS = 60_000;
const D =
  "docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index";
const CLO = `${D}/closeout-closed.json`;
const COH = `${D}/closeout-closed-coherent.json`;
const OPEN = `${D}/closeout-open.json`;
const INC = `${D}/closeout-incomplete.json`;
const BLK = `${D}/closeout-blocked.json`;
const TAMP = `${D}/closeout-tampered.json`;
const NOT = `${D}/not-a-closeout.json`;

const SCRIPT =
  "worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index";

function runCli(
  args: string[],
  input?: string,
): { status: number; stdout: string } {
  try {
    const stdout = runWorkerCliSync(["-s", SCRIPT, ...args], {
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

describe(`${SCRIPT} CLI smoke`, () => {
  it(
    "--help exits 0 and prints usage",
    () => {
      const r = runCli(["--help"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(
        /release decision closeout governance finalize index/i,
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an unknown flag / no record supplied / stdin+file is a usage error (exit 1)",
    () => {
      expect(runCli(["--nope"]).status).toBe(1);
      expect(runCli([]).status).toBe(1);
      expect(runCli(["--stdin", "--file=x"]).status).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a coherent all-closed history → all-closed (exit 0)",
    () => {
      const r = runCli([
        `--file=${CLO}`,
        `--file=${COH}`,
        `--file=${CLO}`,
        "--json",
      ]);
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.schema).toBe(
        "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index-trend-closeout-index/1",
      );
      expect(parsed.closeoutIndex.verdict).toBe("all-closed");
      expect(parsed.coverage.closeoutsUsable).toBe(3);
      expect(parsed.distribution.verdictCounts.closed).toBe(3);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a latest-open history → open (exit 3)",
    () => {
      expect(runCli([`--file=${CLO}`, `--file=${OPEN}`, "--json"]).status).toBe(
        3,
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a latest-incomplete history → incomplete (exit 2)",
    () => {
      const r = runCli([`--file=${CLO}`, `--file=${INC}`, "--json"]);
      expect(r.status).toBe(2);
      expect(JSON.parse(r.stdout).closeoutIndex.verdict).toBe("incomplete");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a blocked history → blocked (exit 4)",
    () => {
      const r = runCli([`--file=${CLO}`, `--file=${BLK}`, "--json"]);
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).closeoutIndex.reasons).toContain(
        "latest-blocked",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a tampered OR unreadable record → invalid (exit 4), never a fabricated all-closed",
    () => {
      const t = runCli([`--file=${CLO}`, `--file=${TAMP}`, "--json"]);
      expect(t.status).toBe(4);
      expect(JSON.parse(t.stdout).closeoutIndex.verdict).toBe("invalid");
      expect(JSON.parse(t.stdout).closeoutIndex.reasons).toContain(
        "closeout-tampered",
      );
      expect(JSON.parse(t.stdout).coverage.closeoutsTampered).toBe(1);

      const n = runCli([`--file=${NOT}`, "--json"]);
      expect(n.status).toBe(4);
      expect(JSON.parse(n.stdout).closeoutIndex.verdict).toBe("invalid");
      expect(JSON.parse(n.stdout).closeoutIndex.reasons).toContain(
        "closeout-unreadable",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "--max-closeouts drops older records and surfaces the count",
    () => {
      const r = runCli([
        `--file=${OPEN}`,
        `--file=${INC}`,
        `--file=${CLO}`,
        "--max-closeouts=1",
        "--json",
      ]);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.coverage.closeoutsSupplied).toBe(3);
      expect(parsed.coverage.closeoutsConsidered).toBe(1);
      expect(parsed.coverage.truncated).toBe(true);
      expect(parsed.coverage.droppedOldest).toBe(2);
      expect(parsed.closeoutIndex.verdict).toBe("all-closed"); // only the newest (closed) is considered
      expect(r.status).toBe(0);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "--max-open tolerates a bounded number of OLDER opens (latest closed) → all-closed (exit 0)",
    () => {
      expect(runCli([`--file=${OPEN}`, `--file=${CLO}`, "--json"]).status).toBe(
        3,
      ); // default max-open=0
      expect(
        runCli([`--file=${OPEN}`, `--file=${CLO}`, "--max-open=1", "--json"])
          .status,
      ).toBe(0);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "--strict-open escalates an open OR incomplete history to blocked (exit 4); a clean history is untouched (exit 0)",
    () => {
      expect(
        runCli([`--file=${CLO}`, `--file=${OPEN}`, "--strict-open"]).status,
      ).toBe(4);
      expect(
        runCli([`--file=${CLO}`, `--file=${INC}`, "--strict-open"]).status,
      ).toBe(4);
      expect(
        runCli([`--file=${CLO}`, `--file=${CLO}`, "--strict-open"]).status,
      ).toBe(0);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reads a JSON array of records from stdin (--stdin)",
    () => {
      const arr = JSON.stringify([
        JSON.parse(readFileSync(CLO, "utf8")),
        JSON.parse(readFileSync(BLK, "utf8")),
      ]);
      const r = runCli(["--stdin", "--json"], arr);
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).closeoutIndex.verdict).toBe("blocked");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reads an NDJSON stream from stdin (--stdin)",
    () => {
      // NDJSON = one compact JSON value per line (the committed fixtures are pretty-printed, so compact them first).
      const compact = (f: string): string =>
        JSON.stringify(JSON.parse(readFileSync(f, "utf8")));
      const nd = `${compact(CLO)}\n${compact(OPEN)}\n`;
      const r = runCli(["--stdin", "--json"], nd);
      expect(r.status).toBe(3);
      expect(JSON.parse(r.stdout).closeoutIndex.verdict).toBe("open");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an empty stdin array → invalid (exit 4), never a vacuous all-closed",
    () => {
      const r = runCli(["--stdin", "--json"], "[]");
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).closeoutIndex.verdict).toBe("invalid");
      expect(JSON.parse(r.stdout).closeoutIndex.reasons).toContain(
        "no-closeouts",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "writes to --output without printing to stdout",
    () => {
      const dir = mkdtempSync(
        join(tmpdir(), "release-decision-closeout-index-"),
      );
      const out = join(dir, "index.json");
      try {
        const r = runCli([`--file=${CLO}`, `--output=${out}`]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe("");
        expect(
          JSON.parse(readFileSync(out, "utf8")).closeoutIndex.verdict,
        ).toBe("all-closed");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "never leaks the fixture path or filename into the result",
    () => {
      const r = runCli([`--file=${CLO}`, `--file=${COH}`, "--text"]);
      expect(r.stdout).not.toContain("docs/examples");
      expect(r.stdout).not.toContain(".json");
      expect(r.stdout).not.toContain("closeout-closed");
    },
    SPAWN_TIMEOUT_MS,
  );
});
