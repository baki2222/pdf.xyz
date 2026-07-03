/**
 * The no-leak proof for the release readiness gate (Phase 46) — deliverable 4.
 *
 * The gate's honesty contract is "no-leak by construction": the runner reads ONLY each check's
 * process exit code and discards every byte of its stdout/stderr at the trust boundary, and it
 * authors all prose from app-owned maps. So even a subprocess that floods stdout/stderr with
 * filenames, object keys, buckets, URLs, tokens, IPs, or document bytes — or a thrown seam whose
 * error message carries them — can never reach the rendered report. These tests poison every probe
 * field (and the seam itself) and prove the report (JSON + text) and the structured outcome never
 * echo them, while still resolving the correct verdict. They also prove the INTERNAL fixture paths
 * from the check catalog never surface in a report.
 */

import { describe, expect, it } from "vitest";
import { runReleaseGate, type ProbeResult, type ReleaseGateProvider } from "./run";
import { reduceCheck } from "./run";
import { RELEASE_CHECKS } from "./checks";
import type { ReleaseGateArgs } from "./args";

const NOW = "2026-07-03T00:00:00.000Z";

/** A dense payload of every locator/content shape the gate must never echo. */
const SECRET =
  "s3://leaky-bucket/customer-tax-return.pdf?sig=deadbeef AKIAIOSFODNN7EXAMPLE " +
  "https://acct.r2.cloudflarestorage.com/obj token=h_abc123 192.168.0.1 Bearer sk-DEADBEEFCAFE";

/** Substrings that must never appear in any gate output (secrets/locators from subprocess output). */
const FORBIDDEN_OUTPUT = [
  "leaky-bucket",
  "customer-tax-return",
  "AKIA",
  "cloudflarestorage",
  "deadbeef",
  "192.168.0.1",
  "s3://",
  "https://",
  "token=",
  "Bearer sk-",
  "POISON-",
];

/**
 * Substrings that must never appear because they are INTERNAL catalog fixture paths — the gate must
 * not leak the paths it runs its checks over (deliverable 4: "or fixture paths").
 */
const FORBIDDEN_PATHS = ["docs/examples", ".json", ".aws-s3", "raw-unsafe-tombstoned", "observed-verified"];

/** A poisoned probe: raw output full of secrets, and a WRONG exit so the fail path is exercised. */
function poisonedProbe(): ProbeResult {
  return {
    exitCode: 99, // never any check's expected code → forces a fail-severity mismatch
    stdout: `POISON-${SECRET}`,
    stderr: `POISON-${SECRET}`,
    timedOut: false,
    spawnError: false,
  };
}

/** A provider whose every check returns a poisoned probe. */
function poisonedProvider(over: Partial<ReleaseGateProvider> = {}): ReleaseGateProvider {
  return {
    runCheck: async () => poisonedProbe(),
    now: () => NOW,
    ...over,
  };
}

const ARGS: ReleaseGateArgs = { format: "json", pretty: true, skip: [] };

describe("release-gate no-leak by construction", () => {
  it("never echoes poisoned subprocess output in JSON while still resolving fail", async () => {
    const run = await runReleaseGate(ARGS, poisonedProvider());
    expect(run.outcome.rollup.verdict).toBe("fail");
    for (const bad of FORBIDDEN_OUTPUT) expect(run.output).not.toContain(bad);
    expect(JSON.stringify(run.outcome)).not.toContain("POISON-");
  });

  it("never echoes poisoned subprocess output in text output", async () => {
    const run = await runReleaseGate({ ...ARGS, format: "text" }, poisonedProvider());
    for (const bad of FORBIDDEN_OUTPUT) expect(run.output).not.toContain(bad);
    expect(run.output).not.toContain("POISON-");
  });

  it("never leaks the internal catalog fixture paths into a report", async () => {
    // Even a fully-passing run must not surface the paths the checks ran over.
    const passing = poisonedProvider({
      runCheck: async (spec) => ({ exitCode: spec.expectedExit, stdout: "", stderr: "", timedOut: false, spawnError: false }),
    });
    for (const format of ["json", "text"] as const) {
      const run = await runReleaseGate({ ...ARGS, format }, passing);
      expect(run.outcome.rollup.verdict).toBe("pass");
      for (const p of FORBIDDEN_PATHS) expect(run.output).not.toContain(p);
    }
  });

  it("treats a thrown seam as unknown and never echoes the thrown secret", async () => {
    const run = await runReleaseGate(ARGS, poisonedProvider({
      runCheck: async () => {
        throw new Error(`POISON-${SECRET}`);
      },
    }));
    expect(run.outcome.rollup.verdict).toBe("unknown");
    expect(run.outcome.checks.every((c) => c.status === "unknown")).toBe(true);
    for (const bad of FORBIDDEN_OUTPUT) expect(run.output).not.toContain(bad);
    expect(JSON.stringify(run.outcome)).not.toContain("POISON-");
  });

  it("reduceCheck reads only the exit code — a poisoned probe yields no output field", () => {
    const spec = RELEASE_CHECKS[0]!;
    const outcome = reduceCheck(spec, poisonedProbe());
    // The outcome must carry no property whose value is the poisoned output.
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain("POISON-");
    expect(serialized).not.toContain("leaky-bucket");
    // A wrong exit on a fail-severity check is a fail; the observed code (99) is a bounded int only.
    expect(outcome.status).toBe(spec.severity);
    expect(outcome.observedExit).toBe(99);
  });

  it("re-stamps generatedAt from the clock seam only", async () => {
    const run = await runReleaseGate(ARGS, poisonedProvider());
    expect(run.outcome.generatedAt).toBe(NOW);
    expect(run.outcome.receipt.at).toBe(NOW);
  });
});
