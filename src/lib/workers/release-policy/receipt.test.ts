import { describe, expect, it } from "vitest";
import { buildPolicyResult } from "./build";
import { ingestBuiltIndex, UNRECOGNIZED_INDEX } from "./ingest";
import { emptyPolicy, makeIndex, NOW } from "./fixtures";

describe("release-policy receipt", () => {
  it("flattens the bounded audit facts for a pass", () => {
    const result = buildPolicyResult(
      NOW,
      "artifacts",
      ingestBuiltIndex(makeIndex([{ generatedAt: NOW, verdict: "pass" }])),
      { ...emptyPolicy(), requireClean: true, minArtifacts: 1 },
    );
    expect(result.receipt).toEqual({
      category: "worker-release-policy",
      policyId: "pdfxyz-worker-release-policy",
      policyVersion: 1,
      at: NOW,
      verdict: "pass",
      exitCode: 0,
      source: "artifacts",
      indexUsable: true,
      effectiveVerdict: "ok",
      assertionsEvaluated: 2,
      blockingViolations: 0,
      warningViolations: 0,
    });
  });

  it("records violation counts + effective verdict for a fail", () => {
    const result = buildPolicyResult(
      NOW,
      "index",
      ingestBuiltIndex(makeIndex([{ generatedAt: NOW, verdict: "fail" }, { generatedAt: NOW, verdict: "warn" }])),
      { ...emptyPolicy(), maxFail: 0, maxWarn: 0 },
    );
    expect(result.receipt.verdict).toBe("fail");
    expect(result.receipt.exitCode).toBe(4);
    expect(result.receipt.blockingViolations).toBe(1);
    expect(result.receipt.warningViolations).toBe(1);
    expect(result.receipt.assertionsEvaluated).toBe(2);
  });

  it("carries a null effective verdict + unusable flag for an unreadable index", () => {
    const result = buildPolicyResult(NOW, "index", UNRECOGNIZED_INDEX, emptyPolicy());
    expect(result.receipt.indexUsable).toBe(false);
    expect(result.receipt.effectiveVerdict).toBeNull();
    expect(result.receipt.verdict).toBe("unknown");
  });
});
