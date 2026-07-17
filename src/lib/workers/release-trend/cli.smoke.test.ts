// @vitest-environment node
/**
 * End-to-end smoke test for the real `pnpm worker:release-trend` CLI: it spawns the actual binary (via tsx),
 * which reads committed content-free report fixtures and composes the trend summary — the tier the in-process
 * tests cannot cover (real spawn, real filesystem, real stdin). The fixtures are self-consistent + content-free,
 * so the exit code is deterministic regardless of the wall clock.
 */

import { describe, expect, it } from "vitest";
import { execPnpmSync } from "@/tests/exec-pnpm";
import { readFileSync } from "node:fs";

const SPAWN_TIMEOUT_MS = 60_000;
const D = "docs/examples/release-trend";
const PR = `${D}/report-promote-ready.json`;
const HW = `${D}/report-hold-warning.json`;
const NE = `${D}/report-needs-evidence.json`;
const HF = `${D}/report-hold-fail.json`;
const TAMPERED = `${D}/report-tampered.json`;
const NOT = `${D}/not-a-report.json`;

function runCli(
  args: string[],
  input?: string,
): { status: number; stdout: string } {
  try {
    const stdout = execPnpmSync(["-s", "worker:release-trend", ...args], {
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

describe("worker:release-trend CLI smoke", () => {
  it(
    "--help exits 0 and prints usage",
    () => {
      const r = runCli(["--help"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/release evidence trend summary/i);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an unknown flag / no report supplied is a usage error (exit 1)",
    () => {
      expect(runCli(["--nope"]).status).toBe(1);
      expect(runCli([]).status).toBe(1);
      expect(runCli(["--stdin", "--report=x"]).status).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a stable window of promote-ready reports → stable (exit 0)",
    () => {
      const r = runCli([
        `--report=${PR}`,
        `--report=${PR}`,
        `--report=${PR}`,
        "--json",
      ]);
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.schema).toBe("pdfxyz.release-trend/1");
      expect(parsed.trend.verdict).toBe("stable");
      expect(parsed.history.reportsUsable).toBe(3);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a hold-warning tip (with tolerated history) → warning (exit 3)",
    () => {
      const r = runCli([
        `--report=${PR}`,
        `--report=${HW}`,
        "--max-hold-warning=5",
        "--json",
      ]);
      expect(r.status).toBe(3);
      expect(JSON.parse(r.stdout).trend.verdict).toBe("warning");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a needs-evidence tip → unknown (exit 2)",
    () => {
      const r = runCli([`--report=${PR}`, `--report=${NE}`, "--json"]);
      expect(r.status).toBe(2);
      expect(JSON.parse(r.stdout).trend.verdict).toBe("unknown");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a hold-fail tip → failing (exit 4)",
    () => {
      const r = runCli([
        `--report=${PR}`,
        `--report=${HF}`,
        "--max-hold-fail=5",
        "--json",
      ]);
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).trend.reasons).toContain("latest-hold-fail");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a tampered report anywhere fails closed (exit 4)",
    () => {
      const r = runCli([`--report=${PR}`, `--report=${TAMPERED}`, "--json"]);
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).trend.reasons).toContain("report-tampered");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an unreadable report → unknown (exit 2), never a fabricated stable",
    () => {
      const r = runCli([`--report=${PR}`, `--report=${NOT}`, "--json"]);
      expect(r.status).toBe(2);
      expect(JSON.parse(r.stdout).history.reportsUnreadable).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "--require-latest-ready escalates a non-ready tip to failing (exit 4)",
    () => {
      expect(
        runCli([`--report=${PR}`, `--report=${HW}`, "--max-hold-warning=5"])
          .status,
      ).toBe(3);
      expect(
        runCli([
          `--report=${PR}`,
          `--report=${HW}`,
          "--max-hold-warning=5",
          "--require-latest-ready",
        ]).status,
      ).toBe(4);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reads a JSON array of reports from stdin (--stdin)",
    () => {
      const arr = JSON.stringify([
        JSON.parse(readFileSync(PR, "utf8")),
        JSON.parse(readFileSync(HF, "utf8")),
      ]);
      const r = runCli(["--stdin", "--max-hold-fail=5", "--json"], arr);
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).trend.verdict).toBe("failing");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "never leaks the fixture path or filename into the result",
    () => {
      const r = runCli([
        `--report=${PR}`,
        `--report=${HF}`,
        "--max-hold-fail=5",
        "--text",
      ]);
      expect(r.stdout).not.toContain("docs/examples");
      expect(r.stdout).not.toContain("report-promote-ready");
      expect(r.stdout).not.toContain(".json");
    },
    SPAWN_TIMEOUT_MS,
  );
});
