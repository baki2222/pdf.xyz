import { describe, expect, it } from "vitest";
import { buildBundleResult } from "./build";
import { ingestStagesFrom, makeChain, makeIndex, makePolicyResult, NOW } from "./fixtures";

describe("release-ci-bundle receipt", () => {
  it("flattens the composite decision into a content-free record", () => {
    const { receipt, rollup } = buildBundleResult(NOW, ingestStagesFrom(makeChain()));
    expect(receipt).toEqual({
      category: "worker-release-ci-bundle",
      policyId: "pdfxyz-worker-release-ci-bundle",
      policyVersion: 1,
      at: NOW,
      verdict: "pass",
      exitCode: 0,
      stagesPresent: 4,
      chainComplete: true,
      decisionStage: "policy",
      inconsistencies: 0,
    });
    expect(receipt.verdict).toBe(rollup.verdict);
    expect(receipt.exitCode).toBe(rollup.exitCode);
  });

  it("records inconsistencies + the decision stage on a mismatched chain", () => {
    const index1 = makeIndex([{ generatedAt: NOW, verdict: "pass" }]);
    const policyOverTwo = makePolicyResult(
      makeIndex([{ generatedAt: NOW, verdict: "pass" }, { generatedAt: NOW, verdict: "pass" }]),
    );
    const { receipt } = buildBundleResult(NOW, ingestStagesFrom({ index: index1, policy: policyOverTwo }));
    expect(receipt.verdict).toBe("fail");
    expect(receipt.inconsistencies).toBeGreaterThan(0);
    expect(receipt.chainComplete).toBe(false);
    expect(receipt.decisionStage).toBe("policy");
  });

  it("carries only bounded scalar fields (safe to forward verbatim)", () => {
    const { receipt } = buildBundleResult(NOW, ingestStagesFrom(makeChain()));
    for (const value of Object.values(receipt)) {
      expect(["string", "number", "boolean"].includes(typeof value) || value === null).toBe(true);
    }
  });
});
