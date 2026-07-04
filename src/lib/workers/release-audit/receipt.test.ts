import { describe, expect, it } from "vitest";
import { buildAuditReceipt } from "./receipt";
import { NOW } from "./fixtures";
import { RELEASE_AUDIT_POLICY_ID, RELEASE_AUDIT_POLICY_VERSION, type AuditRollup } from "./types";

const ROLLUP: AuditRollup = {
  verdict: "fail",
  exitCode: 4,
  regressed: true,
  drivers: ["verdict-worsened"],
  blockingRegressions: 1,
  warningRegressions: 2,
  comparable: true,
  detail: "authored",
};

describe("release-audit receipt", () => {
  it("flattens the rollup + mode into a content-free, forwardable record", () => {
    expect(buildAuditReceipt(NOW, "pair", ROLLUP)).toEqual({
      category: "worker-release-audit",
      policyId: RELEASE_AUDIT_POLICY_ID,
      policyVersion: RELEASE_AUDIT_POLICY_VERSION,
      at: NOW,
      mode: "pair",
      verdict: "fail",
      exitCode: 4,
      comparable: true,
      blockingRegressions: 1,
      warningRegressions: 2,
    });
  });

  it("carries only bounded enums, small integers, a policy id, and the stamp (no locators)", () => {
    const receipt = buildAuditReceipt(NOW, "history", ROLLUP);
    for (const value of Object.values(receipt)) {
      expect(["string", "number", "boolean"]).toContain(typeof value);
    }
  });
});
