// @vitest-environment node
/**
 * End-to-end smoke test for the real
 * `pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout` CLI: it spawns the
 * actual binary (via tsx), which reads committed content-free record fixtures and composes the closeout — the tier the
 * in-process tests cannot cover (real spawn, real filesystem, real stdin, real output file). The fixtures are
 * self-consistent + content-free, so the exit code is deterministic regardless of the wall clock.
 */

import { describe, expect, it } from "vitest";
import { execPnpmSync } from "@/tests/exec-pnpm";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SPAWN_TIMEOUT_MS = 60_000;
const WORKER =
  "worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout";
const D =
  "docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout";
const COMPLETED = `${D}/receipt-completed.json`;
const OPEN = `${D}/receipt-followup-open.json`;
const INCOMPLETE = `${D}/receipt-incomplete.json`;
const BLOCKED = `${D}/receipt-blocked.json`;
const INVALID = `${D}/receipt-invalid.json`;
const TAMPERED = `${D}/receipt-tampered.json`;
const NOT = `${D}/not-a-receipt.json`;

function runCli(
  args: string[],
  input?: string,
): { status: number; stdout: string } {
  try {
    const stdout = execPnpmSync(["-s", WORKER, ...args], {
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

describe("worker:release-decision-closeout-…-finalize-index-trend-closeout CLI smoke", () => {
  it(
    "--help exits 0 and prints usage",
    () => {
      const r = runCli(["--help"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/release decision closeout/i);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an unknown flag / no receipt supplied / stdin+receipt is a usage error (exit 1)",
    () => {
      expect(runCli(["--nope"]).status).toBe(1);
      expect(runCli([]).status).toBe(1);
      expect(runCli(["--stdin", "--receipt=x"]).status).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a completed receipt alone is closed (exit 0)",
    () => {
      const done = runCli([`--receipt=${COMPLETED}`, "--json"]);
      expect(done.status).toBe(0);
      const parsed = JSON.parse(done.stdout);
      expect(parsed.schema).toBe(
        "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout/1",
      );
      expect(parsed.verdict).toBe("closed");
      expect(parsed.coverage.planClass).toBe("clear");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "the primary receipt's own state drives the baseline (open/incomplete/blocked)",
    () => {
      expect(runCli([`--file=${OPEN}`]).status).toBe(3);
      expect(runCli([`--receipt=${INCOMPLETE}`]).status).toBe(2);
      expect(runCli([`--receipt=${BLOCKED}`]).status).toBe(4);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an invalid-verdict receipt, a tampered receipt, and a non-receipt decoy all fail closed as invalid (exit 4)",
    () => {
      expect(runCli([`--receipt=${INVALID}`]).status).toBe(4);

      const t = runCli([`--receipt=${TAMPERED}`, "--json"]);
      expect(t.status).toBe(4);
      const tp = JSON.parse(t.stdout);
      expect(tp.verdict).toBe("invalid");
      expect(tp.primaryReceipt.state).toBe("tampered");

      const n = runCli([`--receipt=${NOT}`, "--json"]);
      expect(n.status).toBe(4);
      const np = JSON.parse(n.stdout);
      expect(np.verdict).toBe("invalid");
      expect(np.primaryReceipt.state).toBe("unreadable");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a coherent plan keeps it closed; a contradictory plan fails closed (exit 4)",
    () => {
      expect(
        runCli([`--receipt=${COMPLETED}`, `--plan=${D}/plan-coherent.json`])
          .status,
      ).toBe(0);
      const bad = runCli([
        `--receipt=${COMPLETED}`,
        `--plan=${D}/plan-contradictory.json`,
        "--json",
      ]);
      expect(bad.status).toBe(4);
      expect(JSON.parse(bad.stdout).coverage.reasons).toContain(
        "plan-contradiction",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an advisory finalization-index window opens the closeout (exit 3); a blocked one blocks it (exit 4)",
    () => {
      expect(
        runCli([`--receipt=${COMPLETED}`, `--index=${D}/index-advisory.json`])
          .status,
      ).toBe(3);
      expect(
        runCli([`--receipt=${COMPLETED}`, `--index=${D}/index-blocked.json`])
          .status,
      ).toBe(4);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a tampered related record fails closed (exit 4, related-tampered)",
    () => {
      const r = runCli([
        `--receipt=${COMPLETED}`,
        `--plan=${D}/plan-tampered.json`,
        "--json",
      ]);
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).coverage.reasons).toContain(
        "related-tampered",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "--require-plan without a plan is incomplete (exit 2)",
    () => {
      expect(runCli([`--receipt=${COMPLETED}`, "--require-plan"]).status).toBe(
        2,
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "--strict-open escalates an open closeout to blocked (exit 4); a closed one is untouched",
    () => {
      expect(runCli([`--receipt=${OPEN}`, "--strict-open"]).status).toBe(4);
      expect(runCli([`--receipt=${COMPLETED}`, "--strict-open"]).status).toBe(
        0,
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reads the primary receipt from stdin (--stdin)",
    () => {
      const r = runCli(["--stdin", "--json"], readFileSync(BLOCKED, "utf8"));
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).verdict).toBe("blocked");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "writes to --output without printing to stdout",
    () => {
      const dir = mkdtempSync(
        join(tmpdir(), "release-decision-closeout-fitfitc-"),
      );
      const out = join(dir, "closeout.json");
      try {
        const r = runCli([`--receipt=${COMPLETED}`, `--output=${out}`]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe("");
        expect(JSON.parse(readFileSync(out, "utf8")).verdict).toBe("closed");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "never leaks the fixture path or filename into the result",
    () => {
      const r = runCli([`--receipt=${COMPLETED}`, "--text"]);
      expect(r.stdout).not.toContain("docs/examples");
      expect(r.stdout).not.toContain(".json");
    },
    SPAWN_TIMEOUT_MS,
  );
});
