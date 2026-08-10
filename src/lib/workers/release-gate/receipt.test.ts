/**
 * Receipt tests for the release readiness gate (Phase 46): the content-free audit stamp.
 */

import { describe, expect, it } from "vitest";
import { buildReceipt } from "./receipt";
import {
  RELEASE_GATE_POLICY_ID,
  RELEASE_GATE_POLICY_VERSION,
  type ReleaseGateRollup,
} from "./types";

const ROLLUP: ReleaseGateRollup = {
  verdict: "warn",
  exitCode: 3,
  ready: false,
  worst: "warn",
  blockers: ["worker-engines"],
  includedChecks: 11,
  passedChecks: 10,
  skippedChecks: 0,
  detail: "READY with a caveat.",
};

describe("buildReceipt", () => {
  it("mirrors the rollup verdict/exit/counts under a stable policy id", () => {
    const r = buildReceipt("2026-07-03T00:00:00.000Z", ROLLUP);
    expect(r).toEqual({
      category: "worker-release-gate",
      policyId: RELEASE_GATE_POLICY_ID,
      policyVersion: RELEASE_GATE_POLICY_VERSION,
      at: "2026-07-03T00:00:00.000Z",
      verdict: "warn",
      exitCode: 3,
      includedChecks: 11,
      passedChecks: 10,
    });
  });

  it("carries only bounded, content-free values (no locator/path/byte)", () => {
    const serialized = JSON.stringify(
      buildReceipt("2026-07-03T00:00:00.000Z", ROLLUP),
    );
    expect(serialized).not.toMatch(/\//); // no path separators
    expect(serialized).not.toMatch(/\.json/);
  });
});
