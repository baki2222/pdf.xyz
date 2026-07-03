/**
 * Rollup fold tests for the release readiness gate (Phase 46): per-check statuses → composite
 * verdict + exit code + blockers, on the shared worker exit ladder.
 */

import { describe, expect, it } from "vitest";
import { computeRollup, verdictForExit } from "./rollup";
import { RELEASE_GATE_EXIT, type ReleaseCheckId, type ReleaseCheckOutcome, type ReleaseCheckStatus } from "./types";

let seq = 0;
const CHECK_IDS: ReleaseCheckId[] = [
  "deploy-examples",
  "worker-smoke",
  "worker-engines",
  "ops-check-healthy",
  "ops-check-critical",
];

/** A minimal outcome with the given status (a fresh bounded id per call). */
function outcome(status: ReleaseCheckStatus, id: ReleaseCheckId = CHECK_IDS[seq++ % CHECK_IDS.length]!): ReleaseCheckOutcome {
  return {
    id,
    status,
    severity: status === "warn" ? "warn" : "fail",
    expectedExit: 0,
    observedExit: status === "pass" ? 0 : 1,
    summary: "x",
    remediation: "y",
  };
}

describe("verdictForExit", () => {
  it("maps the ladder to the four bounded verdicts", () => {
    expect(verdictForExit(RELEASE_GATE_EXIT.PASS)).toBe("pass");
    expect(verdictForExit(RELEASE_GATE_EXIT.UNKNOWN)).toBe("unknown");
    expect(verdictForExit(RELEASE_GATE_EXIT.WARN)).toBe("warn");
    expect(verdictForExit(RELEASE_GATE_EXIT.FAIL)).toBe("fail");
    expect(verdictForExit(9)).toBe("fail"); // clamps above the ladder
  });
});

describe("computeRollup", () => {
  it("passes when every included check passed", () => {
    const r = computeRollup([outcome("pass"), outcome("pass"), outcome("skip")]);
    expect(r.verdict).toBe("pass");
    expect(r.exitCode).toBe(0);
    expect(r.ready).toBe(true);
    expect(r.includedChecks).toBe(2);
    expect(r.passedChecks).toBe(2);
    expect(r.skippedChecks).toBe(1);
    expect(r.blockers).toEqual([]);
  });

  it("a single fail dominates the rollup", () => {
    const r = computeRollup([outcome("pass"), outcome("warn"), outcome("unknown"), outcome("fail")]);
    expect(r.verdict).toBe("fail");
    expect(r.exitCode).toBe(4);
    expect(r.worst).toBe("fail");
    expect(r.blockers).toHaveLength(3); // warn + unknown + fail — every non-pass included check
  });

  it("warn outranks unknown on the shared ladder (unknown < warn)", () => {
    const r = computeRollup([outcome("pass"), outcome("unknown"), outcome("warn")]);
    expect(r.verdict).toBe("warn");
    expect(r.exitCode).toBe(3);
  });

  it("is unknown when only indeterminate checks are present (no warn/fail)", () => {
    const r = computeRollup([outcome("pass"), outcome("unknown")]);
    expect(r.verdict).toBe("unknown");
    expect(r.exitCode).toBe(2);
  });

  it("is unknown — never a vacuous pass — when nothing is included", () => {
    const r = computeRollup([outcome("skip"), outcome("skip")]);
    expect(r.verdict).toBe("unknown");
    expect(r.exitCode).toBe(2);
    expect(r.includedChecks).toBe(0);
    expect(r.worst).toBe("unknown");
  });

  it("preserves catalog order in the blockers list", () => {
    seq = 0;
    const checks = [outcome("fail", "deploy-examples"), outcome("pass", "worker-smoke"), outcome("warn", "worker-engines")];
    const r = computeRollup(checks);
    expect(r.blockers).toEqual(["deploy-examples", "worker-engines"]);
  });
});
