// @vitest-environment node
/**
 * End-to-end smoke test for the real `pnpm worker:release-decision-action-plan` CLI: it spawns the actual binary (via
 * tsx), which reads committed content-free trend fixtures and composes the action plan — the tier the in-process tests
 * cannot cover (real spawn, real filesystem, real stdin, real output file). The fixtures are self-consistent +
 * content-free, so the exit code is deterministic regardless of the wall clock.
 */

import { describe, expect, it } from "vitest";
import { execPnpmSync } from "@/tests/exec-pnpm";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SPAWN_TIMEOUT_MS = 60_000;
const D = "docs/examples/release-decision-action-plan";
const STABLE = `${D}/trend-stable.json`;
const IMPROVING = `${D}/trend-improving.json`;
const WATCH = `${D}/trend-watch.json`;
const DEGRADING = `${D}/trend-degrading.json`;
const INSUFFICIENT = `${D}/trend-insufficient.json`;
const BLOCKED = `${D}/trend-blocked.json`;
const INVALID = `${D}/trend-invalid.json`;
const NOT = `${D}/not-a-trend.json`;

function runCli(
  args: string[],
  input?: string,
): { status: number; stdout: string } {
  try {
    const stdout = execPnpmSync(
      ["-s", "worker:release-decision-action-plan", ...args],
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

describe("worker:release-decision-action-plan CLI smoke", () => {
  it(
    "--help exits 0 and prints usage",
    () => {
      const r = runCli(["--help"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/release decision trend action plan/i);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an unknown flag / no trend supplied / stdin+trend is a usage error (exit 1)",
    () => {
      expect(runCli(["--nope"]).status).toBe(1);
      expect(runCli([]).status).toBe(1);
      expect(runCli(["--stdin", "--trend=x"]).status).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a clean stable trend → clear (exit 0)",
    () => {
      const r = runCli([`--trend=${STABLE}`, "--json"]);
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.schema).toBe("pdfxyz.release-decision-action-plan/1");
      expect(parsed.verdict).toBe("clear");
      expect(parsed.sourceTrendVerdict).toBe("stable");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an improving trend → benign monitor (exit 0); a watch / degrading trend → monitor (exit 3)",
    () => {
      expect(runCli([`--trend=${IMPROVING}`, "--json"]).status).toBe(0);
      expect(runCli([`--file=${WATCH}`, "--json"]).status).toBe(3);
      const deg = runCli([`--trend=${DEGRADING}`, "--json"]);
      expect(deg.status).toBe(3);
      expect(JSON.parse(deg.stdout).actionClass).toBe("stabilize-regression");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an insufficient trend → investigate (exit 2)",
    () => {
      const r = runCli([`--trend=${INSUFFICIENT}`, "--json"]);
      expect(r.status).toBe(2);
      expect(JSON.parse(r.stdout).verdict).toBe("investigate");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a blocked or invalid trend → block-release (exit 4)",
    () => {
      const b = runCli([`--trend=${BLOCKED}`, "--json"]);
      expect(b.status).toBe(4);
      expect(JSON.parse(b.stdout).plan.reasons).toContain("trend-blocked");
      const iv = runCli([`--trend=${INVALID}`, "--json"]);
      expect(iv.status).toBe(4);
      expect(JSON.parse(iv.stdout).plan.reasons).toContain("trend-invalid");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a tampered trend, or an unreadable decoy → invalid (exit 4), never a fabricated pass",
    () => {
      // Flip the recorded trend verdict at the CLI boundary so it no longer re-derives → CHECK-B tamper.
      const tampered = JSON.parse(readFileSync(STABLE, "utf8"));
      tampered.trend.verdict = "blocked";
      const t = runCli(["--stdin", "--json"], JSON.stringify(tampered));
      expect(t.status).toBe(4);
      expect(JSON.parse(t.stdout).source.state).toBe("tampered");

      const n = runCli([`--trend=${NOT}`, "--json"]);
      expect(n.status).toBe(4);
      expect(JSON.parse(n.stdout).source.state).toBe("unreadable");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "--strict escalates a non-clear trend to block-release (exit 4); a clean one is untouched (exit 0)",
    () => {
      expect(runCli([`--trend=${WATCH}`, "--strict"]).status).toBe(4);
      expect(runCli([`--trend=${STABLE}`, "--strict"]).status).toBe(0);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reads the trend from stdin (--stdin)",
    () => {
      const r = runCli(["--stdin", "--json"], readFileSync(BLOCKED, "utf8"));
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).verdict).toBe("block-release");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "caps the emitted actions with --max-actions and surfaces the drop",
    () => {
      const r = runCli([`--trend=${BLOCKED}`, "--max-actions=1", "--json"]);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.actions).toHaveLength(1);
      expect(parsed.receipt.actionsDropped).toBeGreaterThan(0);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "writes to --output without printing to stdout",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "release-decision-action-plan-"));
      const out = join(dir, "plan.json");
      try {
        const r = runCli([`--trend=${STABLE}`, `--output=${out}`]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe("");
        expect(JSON.parse(readFileSync(out, "utf8")).verdict).toBe("clear");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "never leaks the fixture path or filename into the result",
    () => {
      // Use the clean stable trend (no reasons fire), so no fixture stem can appear as a legitimate reason id.
      // (`trend-stable` is not a reason id; `trend-blocked` / `trend-watch` etc. are, so they must not be used here.)
      const r = runCli([`--trend=${STABLE}`, "--text"]);
      expect(r.stdout).not.toContain("docs/examples");
      expect(r.stdout).not.toContain(".json");
      expect(r.stdout).not.toContain("trend-stable");
    },
    SPAWN_TIMEOUT_MS,
  );
});
