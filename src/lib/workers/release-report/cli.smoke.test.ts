// @vitest-environment node
/**
 * End-to-end smoke test for the real `pnpm worker:release-report` CLI: it spawns the actual binary (via tsx),
 * which reads committed content-free fixtures and composes the report — the tier the in-process tests cannot
 * cover (real spawn, real filesystem, real stdin). The fixtures are self-consistent + content-free, so the
 * exit code is deterministic regardless of the wall clock.
 */

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { execPnpmSync } from "@/tests/exec-pnpm";

const SPAWN_TIMEOUT_MS = 60_000;
const D = "docs/examples/release-report";
const BUNDLE_PASS = `${D}/bundle-pass.json`;
const BUNDLE_WARN = `${D}/bundle-warn.json`;
const BUNDLE_FAIL = `${D}/bundle-fail.json`;
const AUDIT_PASS = `${D}/audit-pass.json`;
const AUDIT_WARN = `${D}/audit-warn.json`;
const AUDIT_FAIL = `${D}/audit-fail.json`;
const NOT_A_REPORT = `${D}/not-a-report.json`;

function runCli(
  args: string[],
  input?: string,
): { status: number; stdout: string } {
  try {
    const stdout = execPnpmSync(["-s", "worker:release-report", ...args], {
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

describe("worker:release-report CLI smoke", () => {
  it(
    "--help exits 0 and prints usage",
    () => {
      const r = runCli(["--help"]);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/release evidence operator report/i);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an unknown flag / no document supplied is a usage error (exit 1)",
    () => {
      expect(runCli(["--nope"]).status).toBe(1);
      expect(runCli([]).status).toBe(1);
      expect(runCli(["--strict"]).status).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a passing bundle (+ passing audit) → promote-ready (exit 0)",
    () => {
      const r = runCli([
        `--bundle=${BUNDLE_PASS}`,
        `--audit=${AUDIT_PASS}`,
        "--json",
      ]);
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout);
      expect(parsed.schema).toBe("pdfxyz.release-report/1");
      expect(parsed.recommendation.recommendation).toBe("promote-ready");
      expect(parsed.coverage.sourcesUsable).toBe(2);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a warn bundle → hold-warning (exit 3)",
    () => {
      const r = runCli([`--bundle=${BUNDLE_WARN}`, "--json"]);
      expect(r.status).toBe(3);
      expect(JSON.parse(r.stdout).recommendation.recommendation).toBe(
        "hold-warning",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "a failed bundle / a blocking audit regression → hold-fail (exit 4)",
    () => {
      expect(runCli([`--bundle=${BUNDLE_FAIL}`, "--json"]).status).toBe(4);
      const r = runCli([
        `--bundle=${BUNDLE_PASS}`,
        `--audit=${AUDIT_FAIL}`,
        "--json",
      ]);
      expect(r.status).toBe(4);
      expect(JSON.parse(r.stdout).recommendation.rationale).toContain(
        "audit-regressed",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an audit-only run → needs-evidence (exit 2), never a promote",
    () => {
      const r = runCli([`--audit=${AUDIT_PASS}`, "--json"]);
      expect(r.status).toBe(2);
      expect(JSON.parse(r.stdout).recommendation.rationale).toContain(
        "coherence-missing",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "an unreadable document → needs-evidence (exit 2), never a fabricated promote",
    () => {
      const r = runCli([`--bundle=${NOT_A_REPORT}`, "--json"]);
      expect(r.status).toBe(2);
      expect(JSON.parse(r.stdout).coverage.bundle).toBe("unreadable");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "--strict escalates an audit drift to hold-fail (exit 4 instead of 3)",
    () => {
      expect(
        runCli([`--bundle=${BUNDLE_PASS}`, `--audit=${AUDIT_WARN}`]).status,
      ).toBe(3);
      expect(
        runCli([`--bundle=${BUNDLE_PASS}`, `--audit=${AUDIT_WARN}`, "--strict"])
          .status,
      ).toBe(4);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "reads a bundle from stdin (the `-` sentinel)",
    () => {
      const input = execFileSync("cat", [BUNDLE_PASS], { encoding: "utf8" });
      const r = runCli(["--bundle=-", "--json"], input);
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout).recommendation.recommendation).toBe(
        "promote-ready",
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "never leaks the fixture path or filename into the result",
    () => {
      const r = runCli([
        `--bundle=${BUNDLE_PASS}`,
        `--audit=${AUDIT_PASS}`,
        "--text",
      ]);
      expect(r.stdout).not.toContain("docs/examples");
      expect(r.stdout).not.toContain("bundle-pass");
      expect(r.stdout).not.toContain(".json");
    },
    SPAWN_TIMEOUT_MS,
  );
});
