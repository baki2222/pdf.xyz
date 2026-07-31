// @vitest-environment node
/**
 * End-to-end smoke test for the real `pnpm worker:release-decision-closeout-governance` CLI: it spawns the actual binary
 * (via tsx), which reads committed content-free record fixtures and composes the governance bundle — the tier the
 * in-process tests cannot cover (real spawn, real filesystem, real stdin, real output file). The fixtures are
 * self-consistent + content-free, so the exit code is deterministic regardless of the wall clock.
 */

import { describe, expect, it } from "vitest";
import { runWorkerCliSync } from "@/tests/run-worker-cli";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SPAWN_TIMEOUT_MS = 60_000;
const D = "docs/examples/release-decision-closeout-governance";
const COMPLETED = `${D}/receipt-completed.json`;
const INCOMPLETE = `${D}/receipt-incomplete.json`;
const OPEN = `${D}/receipt-followup-open.json`;
const BLOCKED = `${D}/receipt-blocked.json`;
const TAMPERED = `${D}/receipt-tampered.json`;
const NOT = `${D}/not-a-receipt.json`;
const PLAN_OK = `${D}/plan-coherent.json`;
const PLAN_BAD = `${D}/plan-contradictory.json`;
const INDEX_BLOCKED = `${D}/index-blocked.json`;

function runCli(
  args: string[],
  input?: string,
): { status: number; stdout: string } {
  try {
    const stdout = runWorkerCliSync(
      ["-s", "worker:release-decision-closeout-governance", ...args],
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

describe("worker:release-decision-closeout-governance CLI smoke", () => {
  it(
    "--help exits 0 and prints usage",
    () => {
      const r = runCli(["--help"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/release decision closeout governance bundle/i);
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
    "the primary receipt folds its own verdict: completed → closed (0), incomplete → 2, open → 3, blocked → 4",
    () => {
      const closed = runCli([`--receipt=${COMPLETED}`, "--json"]);
      expect(closed.status).toBe(0);
      const parsed = JSON.parse(closed.stdout);
      expect(parsed.schema).toBe(
        "pdfxyz.release-decision-closeout-governance/1",
      );
      expect(parsed.verdict).toBe("closed");

      expect(runCli([`--receipt=${INCOMPLETE}`, "--json"]).status).toBe(2);
      expect(runCli([`--file=${OPEN}`, "--json"]).status).toBe(3);
      expect(runCli([`--receipt=${BLOCKED}`, "--json"]).status).toBe(4);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a completed receipt + a coherent plan stays closed (exit 0); a contradictory plan is blocked (exit 4)",
    () => {
      expect(
        runCli([`--receipt=${COMPLETED}`, `--plan=${PLAN_OK}`, "--json"])
          .status,
      ).toBe(0);
      const bad = runCli([
        `--receipt=${COMPLETED}`,
        `--plan=${PLAN_BAD}`,
        "--json",
      ]);
      expect(bad.status).toBe(4);
      expect(JSON.parse(bad.stdout).governance.reasons).toContain(
        "plan-contradiction",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a blocked source chain is blocked (exit 4)",
    () => {
      const r = runCli([
        `--receipt=${COMPLETED}`,
        `--index=${INDEX_BLOCKED}`,
        "--json",
      ]);
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).governance.reasons).toContain(
        "source-chain-blocked",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "--require-plan without a plan is incomplete (exit 2)",
    () => {
      expect(
        runCli([`--receipt=${COMPLETED}`, "--require-plan", "--json"]).status,
      ).toBe(2);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "--strict-open escalates an open governance to blocked (exit 4); a closed chain is untouched",
    () => {
      expect(runCli([`--receipt=${OPEN}`, "--strict-open"]).status).toBe(4);
      expect(runCli([`--receipt=${COMPLETED}`, "--strict-open"]).status).toBe(
        0,
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a tampered receipt → blocked (exit 4); an unreadable decoy → incomplete (exit 2), never a fabricated close",
    () => {
      const t = runCli([`--receipt=${TAMPERED}`, "--json"]);
      expect(t.status).toBe(4);
      expect(JSON.parse(t.stdout).source.state).toBe("tampered");

      const n = runCli([`--receipt=${NOT}`, "--json"]);
      expect(n.status).toBe(2);
      expect(JSON.parse(n.stdout).source.state).toBe("unreadable");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reads the primary receipt from stdin (--stdin)",
    () => {
      const r = runCli(["--stdin", "--json"], readFileSync(BLOCKED, "utf8"));
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).verdict).toBe("governance-blocked");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "writes to --output without printing to stdout",
    () => {
      const dir = mkdtempSync(
        join(tmpdir(), "release-decision-closeout-governance-"),
      );
      const out = join(dir, "bundle.json");
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
      // The full filename must not leak. (The bare stem `receipt-completed` is legitimately a REASON id here — like
      // `plan-tampered` in the sibling worker — so we assert the filename WITH its extension, which is not a reason id.)
      expect(r.stdout).not.toContain("receipt-completed.json");
    },
    SPAWN_TIMEOUT_MS,
  );
});
