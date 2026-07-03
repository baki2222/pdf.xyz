// @vitest-environment node
/**
 * End-to-end smoke test for the real `pnpm worker:release-gate` CLI: it spawns the actual binary
 * (via tsx), which in turn spawns a real composed check as a subprocess, and pins the documented
 * exit ladder, the "expected-non-zero is a PASS" contract, and the no-leak guarantee on live process
 * output — the tier the in-process tests cannot cover.
 *
 * It is deliberately SCOPED (`--only=<one fast check>`) so the suite stays fast and does not run the
 * whole ~1-minute gate; the full-gate run is exercised by the committed CI example workflow.
 */

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { RELEASE_GATE_EXIT } from "./types";

const SPAWN_TIMEOUT_MS = 240_000;

function runCli(args: string[]): { status: number; stdout: string } {
  try {
    const stdout = execFileSync("pnpm", ["-s", "worker:release-gate", ...args], {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      timeout: SPAWN_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { status: 0, stdout };
  } catch (err) {
    const e = err as { status?: number | null; signal?: string | null; stdout?: string };
    if (typeof e.status === "number") return { status: e.status, stdout: String(e.stdout ?? "") };
    throw err; // killed by a signal / spawn failure — surface it
  }
}

describe("worker:release-gate CLI smoke", () => {
  it("--help exits 0 and prints usage", () => {
    const r = runCli(["--help"]);
    expect(r.status).toBe(RELEASE_GATE_EXIT.PASS);
    expect(r.stdout).toMatch(/release readiness gate/i);
  }, SPAWN_TIMEOUT_MS);

  it("an unknown flag is a usage error (exit 1)", () => {
    expect(runCli(["--nope"]).status).toBe(RELEASE_GATE_EXIT.USAGE);
  }, SPAWN_TIMEOUT_MS);

  it("an unknown scope id is a usage error (exit 1)", () => {
    expect(runCli(["--only=not-a-check"]).status).toBe(RELEASE_GATE_EXIT.USAGE);
  }, SPAWN_TIMEOUT_MS);

  it("a check whose EXPECTED exit is non-zero PASSES when the subprocess exits with it", () => {
    // cleanup-pipeline over a present-but-tombstoned fixture exits 4; the gate expects 4 → PASS → 0.
    const r = runCli(["--only=cleanup-pipeline-breach", "--json"]);
    expect(r.status).toBe(RELEASE_GATE_EXIT.PASS);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.schema).toBe("pdfxyz.worker-release-gate/1");
    expect(parsed.rollup.verdict).toBe("pass");
    expect(parsed.rollup.includedChecks).toBe(1);
    const check = parsed.checks.find((c: { id: string }) => c.id === "cleanup-pipeline-breach");
    expect(check.status).toBe("pass");
    expect(check.observedExit).toBe(4);
  }, SPAWN_TIMEOUT_MS);

  it("never leaks a real subprocess's output or the fixture path into the text report", () => {
    const r = runCli(["--only=cleanup-pipeline-breach", "--text"]);
    expect(r.status).toBe(RELEASE_GATE_EXIT.PASS);
    // Real cleanup-pipeline output / the fixture path must not surface in the gate report.
    expect(r.stdout).not.toContain("docs/examples");
    expect(r.stdout).not.toContain(".json");
    expect(r.stdout).not.toContain("cleanup-project");
  }, SPAWN_TIMEOUT_MS);
});
