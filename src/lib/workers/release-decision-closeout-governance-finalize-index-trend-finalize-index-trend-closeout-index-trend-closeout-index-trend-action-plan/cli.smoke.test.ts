// @vitest-environment node
/**
 * End-to-end smoke test for the real `pnpm worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-plan`
 * CLI: it spawns the actual binary (via tsx), which reads committed content-free closeout-index-trend fixtures and
 * composes the action plan — the tier the in-process tests cannot cover (real spawn, real filesystem, real stdin, real
 * output file). The fixtures are self-consistent + content-free, so the exit code is deterministic regardless of the wall
 * clock.
 */

import { describe, expect, it } from "vitest";
import { execPnpmSync } from "@/tests/exec-pnpm";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SPAWN_TIMEOUT_MS = 60_000;
const D =
  "docs/examples/release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-plan";
const STABLE = `${D}/trend-stable.json`;
const INSUFFICIENT = `${D}/trend-insufficient.json`;
const WATCH = `${D}/trend-watch.json`;
const DEGRADING = `${D}/trend-degrading.json`;
const BLOCKED = `${D}/trend-blocked.json`;
const NOT = `${D}/not-a-trend.json`;

function runCli(
  args: string[],
  input?: string,
): { status: number; stdout: string } {
  try {
    const stdout = execPnpmSync(
      [
        "-s",
        "worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-plan",
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

describe("worker:release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-plan CLI smoke", () => {
  it(
    "--help exits 0 and prints usage",
    () => {
      const r = runCli(["--help"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(
        /release decision closeout governance finalize index trend finalize index trend closeout index trend action plan/i,
      );
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
    "a coherent stable trend → clear (exit 0)",
    () => {
      const r = runCli([`--trend=${STABLE}`, "--json"]);
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.schema).toBe(
        "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-action-plan/1",
      );
      expect(parsed.verdict).toBe("clear");
      expect(parsed.sourceTrendVerdict).toBe("stable");
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
    "a watch trend → monitor (exit 3, soon); a degrading trend → monitor (exit 3, high)",
    () => {
      const w = runCli([`--file=${WATCH}`, "--json"]);
      expect(w.status).toBe(3);
      expect(JSON.parse(w.stdout).urgency).toBe("soon");
      const d = runCli([`--file=${DEGRADING}`, "--json"]);
      expect(d.status).toBe(3);
      expect(JSON.parse(d.stdout).urgency).toBe("high");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a blocked trend → block-release (exit 4)",
    () => {
      const b = runCli([`--trend=${BLOCKED}`, "--json"]);
      expect(b.status).toBe(4);
      expect(JSON.parse(b.stdout).actionPlan.reasons).toContain(
        "trend-blocked",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a tampered trend → invalid (exit 4); an unreadable decoy → invalid (exit 4), never a fabricated pass",
    () => {
      // Flip the recorded top-level trend verdict at the CLI boundary so it no longer re-derives → CHECK-B tamper.
      const tampered = JSON.parse(readFileSync(STABLE, "utf8"));
      tampered.verdict = "blocked";
      const t = runCli(["--stdin", "--json"], JSON.stringify(tampered));
      expect(t.status).toBe(4);
      expect(JSON.parse(t.stdout).verdict).toBe("invalid");
      expect(JSON.parse(t.stdout).source.state).toBe("tampered");

      const n = runCli([`--trend=${NOT}`, "--json"]);
      expect(n.status).toBe(4);
      expect(JSON.parse(n.stdout).source.state).toBe("unreadable");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "--strict escalates a watch / insufficient trend to block-release (exit 4); a stable one is untouched (exit 0)",
    () => {
      expect(runCli([`--trend=${WATCH}`, "--strict"]).status).toBe(4);
      expect(runCli([`--trend=${INSUFFICIENT}`, "--strict"]).status).toBe(4);
      expect(runCli([`--trend=${STABLE}`, "--strict"]).status).toBe(0);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "--max-actions caps the emitted checklist and surfaces the dropped count (never silent)",
    () => {
      const r = runCli([`--trend=${BLOCKED}`, "--json", "--max-actions=1"]);
      expect(r.status).toBe(4);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.plan).toHaveLength(1);
      expect(parsed.maxActions).toBe(1);
      expect(parsed.actionsDropped).toBeGreaterThan(0);
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
    "writes to --output without printing to stdout",
    () => {
      const dir = mkdtempSync(
        join(tmpdir(), "closeout-index-trend-action-plan-"),
      );
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
      // Use the clean stable trend (no blocking reasons fire), so no fixture stem can appear as a legitimate reason id.
      const r = runCli([`--trend=${STABLE}`, "--text"]);
      expect(r.stdout).not.toContain("docs/examples");
      expect(r.stdout).not.toContain(".json");
      expect(r.stdout).not.toContain("trend-stable.json");
    },
    SPAWN_TIMEOUT_MS,
  );
});
