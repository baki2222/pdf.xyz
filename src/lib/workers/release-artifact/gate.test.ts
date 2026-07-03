/**
 * Trust-boundary tests for the release-gate ingest: it reduces a gate result to bounded enums,
 * re-authors all prose, drops every free-text/poisoned field, and fails closed to `unknown` on a
 * missing/unreadable result.
 */

import { describe, expect, it } from "vitest";
import { ingestGateResult, unreadableGate } from "./gate";
import { RELEASE_GATE_SCHEMA } from "../release-gate/types";

/** A realistic, valid gate result JSON (only the fields the ingest reads matter). */
function gateJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: RELEASE_GATE_SCHEMA,
    policyId: "pdfxyz-worker-release-readiness-gate",
    policyVersion: 1,
    generatedAt: "2026-07-03T00:00:00.000Z",
    rollup: {
      verdict: "pass",
      exitCode: 0,
      ready: true,
      worst: "pass",
      blockers: [],
      includedChecks: 11,
      passedChecks: 11,
      skippedChecks: 0,
      detail: "ready",
    },
    checks: [
      { id: "deploy-examples", status: "pass", severity: "fail", expectedExit: 0, observedExit: 0, summary: "s", remediation: "r" },
      { id: "worker-engines", status: "warn", severity: "warn", expectedExit: 0, observedExit: 1, summary: "s", remediation: "r" },
    ],
    receipt: { category: "worker-release-gate", verdict: "pass" },
    guidance: ["g"],
    caveats: ["c"],
    ...over,
  });
}

describe("ingestGateResult — valid results", () => {
  it("reduces a passing result to a bounded, present gate section", () => {
    const gate = ingestGateResult(gateJson(), "supplied");
    expect(gate.source).toBe("supplied");
    expect(gate.present).toBe(true);
    expect(gate.verdict).toBe("pass");
    expect(gate.includedChecks).toBe(11);
    expect(gate.passedChecks).toBe(11);
    expect(gate.checks).toEqual([
      { id: "deploy-examples", status: "pass" },
      { id: "worker-engines", status: "warn" },
    ]);
    expect(gate.detail).toContain("supplied by the operator");
  });

  it("labels an internally-run result as generated", () => {
    expect(ingestGateResult(gateJson(), "generated").source).toBe("generated");
    expect(ingestGateResult(gateJson(), "generated").detail).toContain("ran internally");
  });

  it("carries fail/warn/unknown verdicts and bounded blocker ids", () => {
    const fail = ingestGateResult(
      gateJson({ rollup: { verdict: "fail", includedChecks: 11, passedChecks: 9, skippedChecks: 0, blockers: ["worker-smoke", "ops-check-critical"] } }),
      "supplied",
    );
    expect(fail.verdict).toBe("fail");
    expect(fail.blockers).toEqual(["worker-smoke", "ops-check-critical"]);
  });

  it("clamps passedChecks to includedChecks and coerces bad counts to 0", () => {
    const gate = ingestGateResult(
      gateJson({ rollup: { verdict: "pass", includedChecks: 3, passedChecks: 999, skippedChecks: -5, blockers: [] } }),
      "supplied",
    );
    expect(gate.passedChecks).toBe(3);
    expect(gate.skippedChecks).toBe(0);
  });
});

describe("ingestGateResult — no-leak by reconstruction", () => {
  const POISON = "s3://leaky-bucket/customer-tax-return.pdf?sig=deadbeef AKIA token~h_x 192.168.0.1";

  it("drops poisoned check ids/statuses and free-text prose", () => {
    const gate = ingestGateResult(
      gateJson({
        rollup: { verdict: "pass", includedChecks: 1, passedChecks: 1, skippedChecks: 0, blockers: [POISON, "worker-smoke"], detail: POISON },
        checks: [
          { id: POISON, status: POISON, summary: POISON, remediation: POISON },
          { id: "worker-smoke", status: "pass", summary: POISON, remediation: POISON },
        ],
      }),
      "supplied",
    );
    const serialized = JSON.stringify(gate);
    expect(serialized).not.toContain("leaky-bucket");
    expect(serialized).not.toContain("AKIA");
    expect(serialized).not.toContain("token~");
    expect(serialized).not.toContain("192.168.0.1");
    // Only the valid bounded check + blocker survive.
    expect(gate.checks).toEqual([{ id: "worker-smoke", status: "pass" }]);
    expect(gate.blockers).toEqual(["worker-smoke"]);
  });
});

describe("ingestGateResult — fail-closed honesty", () => {
  it("treats a null result as not-configured and unknown", () => {
    const gate = ingestGateResult(null, "generated");
    expect(gate.source).toBe("not-configured");
    expect(gate.present).toBe(false);
    expect(gate.verdict).toBe("unknown");
  });

  it("treats malformed JSON, the wrong schema, and a missing verdict as unreadable+unknown", () => {
    for (const text of ["not json", JSON.stringify({ schema: "other" }), JSON.stringify({ schema: RELEASE_GATE_SCHEMA, rollup: { verdict: "bogus" } })]) {
      const gate = ingestGateResult(text, "supplied");
      expect(gate.source).toBe("unreadable");
      expect(gate.verdict).toBe("unknown");
      expect(gate.present).toBe(false);
    }
  });

  it("unreadableGate() is a bounded unknown section", () => {
    const gate = unreadableGate();
    expect(gate.source).toBe("unreadable");
    expect(gate.verdict).toBe("unknown");
  });
});
