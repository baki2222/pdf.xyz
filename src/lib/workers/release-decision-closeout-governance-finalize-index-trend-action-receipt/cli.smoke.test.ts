// @vitest-environment node
/**
 * End-to-end smoke test for the real `pnpm worker:release-decision-closeout-governance-finalize-index-trend-action-receipt`
 * CLI: it spawns the actual binary (via tsx), which reads committed content-free plan fixtures and records the execution
 * receipt — the tier the in-process tests cannot cover (real spawn, real filesystem, real stdin, real output file). The
 * fixtures are self-consistent + content-free, so the exit code is deterministic regardless of the wall clock.
 */

import { describe, expect, it } from "vitest";
import { execPnpmSync } from "@/tests/exec-pnpm";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SPAWN_TIMEOUT_MS = 60_000;
const D =
  "docs/examples/release-decision-closeout-governance-finalize-index-trend-action-receipt";
const CLEAR = `${D}/plan-clear.json`;
const MONITOR = `${D}/plan-monitor.json`;
const INVESTIGATE = `${D}/plan-investigate.json`;
const BLOCK = `${D}/plan-block.json`;
const INVALID = `${D}/plan-invalid.json`;
const TAMPERED = `${D}/plan-tampered.json`;
const NOT = `${D}/not-a-plan.json`;

function runCli(
  args: string[],
  input?: string,
): { status: number; stdout: string } {
  try {
    const stdout = execPnpmSync(
      [
        "-s",
        "worker:release-decision-closeout-governance-finalize-index-trend-action-receipt",
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

describe("worker:release-decision-closeout-governance-finalize-index-trend-action-receipt CLI smoke", () => {
  it(
    "--help exits 0 and prints usage",
    () => {
      const r = runCli(["--help"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(
        /finalize index trend action-plan execution receipt/i,
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an unknown flag / no plan supplied / stdin+plan is a usage error (exit 1)",
    () => {
      expect(runCli(["--nope"]).status).toBe(1);
      expect(runCli([]).status).toBe(1);
      expect(runCli(["--stdin", "--plan=x"]).status).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a clear plan: reviewed → completed (exit 0); unacked → incomplete (exit 2)",
    () => {
      const done = runCli([`--plan=${CLEAR}`, "--ack-plan", "--json"]);
      expect(done.status).toBe(0);
      const parsed = JSON.parse(done.stdout);
      expect(parsed.schema).toBe(
        "pdfxyz.release-decision-closeout-governance-finalize-index-trend-action-receipt/1",
      );
      expect(parsed.verdict).toBe("completed");
      expect(parsed.planClass).toBe("clear");

      expect(runCli([`--plan=${CLEAR}`, "--json"]).status).toBe(2);
      // --ack-reviewed is an alias for --ack-plan.
      expect(
        runCli([`--plan=${CLEAR}`, "--ack-reviewed", "--json"]).status,
      ).toBe(0);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a monitor plan: reviewed-but-unacked → incomplete (exit 2); fully acked → completed (exit 0)",
    () => {
      const open = runCli([`--file=${MONITOR}`, "--ack-plan", "--json"]);
      expect(open.status).toBe(2);
      expect(JSON.parse(open.stdout).verdict).toBe("incomplete");
      expect(
        runCli([
          `--plan=${MONITOR}`,
          "--ack-plan",
          "--ack-monitor",
          "--ack-executed",
        ]).status,
      ).toBe(0);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an investigate plan reviewed-but-unacked → incomplete (exit 2)",
    () => {
      const r = runCli([`--plan=${INVESTIGATE}`, "--ack-plan", "--json"]);
      expect(r.status).toBe(2);
      expect(JSON.parse(r.stdout).planClass).toBe("investigate");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a block plan is blocked (exit 4) whether unacknowledged or fully acknowledged — the release stays held",
    () => {
      const b = runCli([`--plan=${BLOCK}`, "--json"]);
      expect(b.status).toBe(4);
      expect(JSON.parse(b.stdout).actionReceipt.reasons).toContain(
        "block-not-acknowledged",
      );
      const acked = runCli([
        `--plan=${BLOCK}`,
        "--ack-plan",
        "--ack-block",
        "--ack-executed",
        "--json",
      ]);
      expect(acked.status).toBe(4);
      expect(JSON.parse(acked.stdout).verdict).toBe("blocked");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an invalid plan, a tampered plan, or an unreadable decoy → fails closed to invalid (exit 4)",
    () => {
      const inv = runCli([
        `--plan=${INVALID}`,
        "--ack-plan",
        "--ack-executed",
        "--json",
      ]);
      expect(inv.status).toBe(4);
      expect(JSON.parse(inv.stdout).verdict).toBe("invalid");
      expect(JSON.parse(inv.stdout).source.state).toBe("usable");

      const t = runCli([
        `--plan=${TAMPERED}`,
        "--ack-plan",
        "--ack-monitor",
        "--ack-executed",
        "--json",
      ]);
      expect(t.status).toBe(4);
      expect(JSON.parse(t.stdout).source.state).toBe("tampered");

      const n = runCli([`--plan=${NOT}`, "--ack-plan", "--json"]);
      expect(n.status).toBe(4);
      expect(JSON.parse(n.stdout).source.state).toBe("unreadable");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a contradictory acknowledgement (ack-block on a clear plan) → blocked (exit 4)",
    () => {
      const r = runCli([
        `--plan=${CLEAR}`,
        "--ack-plan",
        "--ack-block",
        "--json",
      ]);
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).actionReceipt.mismatchedAcks).toContain(
        "block",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "--strict-open escalates a missing-ack receipt to blocked (exit 4); a completed close-out is untouched",
    () => {
      expect(
        runCli([`--plan=${MONITOR}`, "--ack-plan", "--strict-open"]).status,
      ).toBe(4);
      expect(
        runCli([`--plan=${CLEAR}`, "--ack-plan", "--strict-open"]).status,
      ).toBe(0);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reads the plan from stdin (--stdin)",
    () => {
      const r = runCli(["--stdin", "--json"], readFileSync(BLOCK, "utf8"));
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).verdict).toBe("blocked");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "writes to --output without printing to stdout",
    () => {
      const dir = mkdtempSync(
        join(tmpdir(), "finalize-index-trend-action-receipt-"),
      );
      const out = join(dir, "receipt.json");
      try {
        const r = runCli([`--plan=${CLEAR}`, "--ack-plan", `--output=${out}`]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe("");
        expect(JSON.parse(readFileSync(out, "utf8")).verdict).toBe("completed");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "never leaks the fixture path or filename into the result",
    () => {
      // Use the clear plan (its stem `plan-clear` is NOT a reason id; `plan-tampered` / `plan-invalid` ARE, so must not be used).
      const r = runCli([`--plan=${CLEAR}`, "--ack-plan", "--text"]);
      expect(r.stdout).not.toContain("docs/examples");
      expect(r.stdout).not.toContain(".json");
      expect(r.stdout).not.toContain("plan-clear");
    },
    SPAWN_TIMEOUT_MS,
  );
});
