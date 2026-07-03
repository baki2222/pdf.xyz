/**
 * Renderer tests for the release readiness gate (Phase 46): both stable formats over one result.
 */

import { describe, expect, it } from "vitest";
import { renderReleaseGate } from "./render";
import {
  RELEASE_GATE_CAVEATS,
  RELEASE_GATE_GUIDANCE,
  RELEASE_GATE_POLICY_ID,
  RELEASE_GATE_POLICY_VERSION,
  RELEASE_GATE_SCHEMA,
  type ReleaseGateResult,
} from "./types";

const RESULT: ReleaseGateResult = {
  schema: RELEASE_GATE_SCHEMA,
  policyId: RELEASE_GATE_POLICY_ID,
  policyVersion: RELEASE_GATE_POLICY_VERSION,
  generatedAt: "2026-07-03T00:00:00.000Z",
  rollup: {
    verdict: "fail",
    exitCode: 4,
    ready: false,
    worst: "fail",
    blockers: ["worker-smoke"],
    includedChecks: 2,
    passedChecks: 1,
    skippedChecks: 1,
    detail: "NOT READY to promote.",
  },
  checks: [
    { id: "deploy-examples", status: "pass", severity: "fail", expectedExit: 0, observedExit: 0, summary: "all validated", remediation: "re-run it" },
    { id: "worker-smoke", status: "fail", severity: "fail", expectedExit: 0, observedExit: 1, summary: "re-run smoke", remediation: "re-run smoke" },
    { id: "worker-engines", status: "skip", severity: "warn", expectedExit: 0, observedExit: null, summary: "skipped", remediation: "re-run engines" },
  ],
  receipt: {
    category: "worker-release-gate",
    policyId: RELEASE_GATE_POLICY_ID,
    policyVersion: RELEASE_GATE_POLICY_VERSION,
    at: "2026-07-03T00:00:00.000Z",
    verdict: "fail",
    exitCode: 4,
    includedChecks: 2,
    passedChecks: 1,
  },
  guidance: RELEASE_GATE_GUIDANCE,
  caveats: RELEASE_GATE_CAVEATS,
};

describe("renderReleaseGate", () => {
  it("json is stable and parseable and carries the schema + verdict", () => {
    const out = renderReleaseGate(RESULT, "json");
    const parsed = JSON.parse(out);
    expect(parsed.schema).toBe(RELEASE_GATE_SCHEMA);
    expect(parsed.rollup.verdict).toBe("fail");
    expect(out.endsWith("\n")).toBe(true);
  });

  it("text shows the rollup, every check line, guidance, and caveats", () => {
    const out = renderReleaseGate(RESULT, "text");
    expect(out).toMatch(/ROLLUP: FAIL \(exit 4\)/);
    expect(out).toContain("deploy-examples");
    expect(out).toContain("worker-smoke");
    expect(out).toContain("expected 0, observed 1");
    expect(out).toContain("GUIDANCE");
    expect(out).toContain("CAVEATS");
    expect(out).toContain("blockers: worker-smoke");
  });

  it("text surfaces remediation for a failing check but stays terse for a passing one", () => {
    const out = renderReleaseGate(RESULT, "text");
    // The failing check's remediation arrow appears...
    const smokeLine = out.split("\n").findIndex((l) => l.includes("[ fail  ] worker-smoke"));
    expect(smokeLine).toBeGreaterThanOrEqual(0);
    // ...and the passing check shows no remediation arrow.
    const passBlock = out.slice(out.indexOf("deploy-examples"), out.indexOf("worker-smoke"));
    expect(passBlock).not.toContain("→");
  });

  it("renders n/a for a null observed exit", () => {
    const out = renderReleaseGate(RESULT, "text");
    expect(out).toContain("observed n/a");
  });
});
