import { describe, expect, it } from "vitest";
import { verifyConsistency } from "./verify";
import { RELEASE_CI_BUNDLE_CHECK_IDS, type ReleaseCiBundleCheckId, type ReleaseCiBundleCheckStatus } from "./types";
import {
  ingestStagesFrom,
  makeArtifact,
  makeChain,
  makeIndex,
  makePolicyResult,
  NOW,
} from "./fixtures";

/** Map the consistency checks to `{id: status}` for concise assertions. */
function statuses(objs: Parameters<typeof ingestStagesFrom>[0]): Record<string, ReleaseCiBundleCheckStatus> {
  const checks = verifyConsistency(ingestStagesFrom(objs));
  return Object.fromEntries(checks.map((c) => [c.id, c.status]));
}

describe("release-ci-bundle verify — consistency links", () => {
  it("emits every check in canonical order", () => {
    const checks = verifyConsistency(ingestStagesFrom({ index: makeChain().index }));
    expect(checks.map((c) => c.id)).toEqual([...RELEASE_CI_BUNDLE_CHECK_IDS]);
    for (const c of checks) expect(c.severity).toBe("block");
  });

  it("a fully coherent chain passes every applicable link", () => {
    const chain = makeChain();
    const s = statuses(chain);
    expect(s).toMatchObject({
      "artifact-digest": "ok",
      "index-self-consistent": "ok",
      "policy-self-consistent": "ok",
      "gate-artifact-agreement": "ok",
      "artifact-index-inclusion": "ok",
      "index-policy-agreement": "ok",
    });
  });

  it("skips every link when nothing relevant is supplied", () => {
    const s = statuses({ gate: makeChain().gate });
    for (const id of RELEASE_CI_BUNDLE_CHECK_IDS) {
      expect(s[id as ReleaseCiBundleCheckId]).toBe("skipped");
    }
  });

  it("artifact-digest: a tampered artifact body is a mismatch", () => {
    const artifact = makeArtifact({ verdict: "pass" }) as Record<string, unknown>;
    // Corrupt the body AFTER the digest was computed → the recomputed digest no longer matches.
    (artifact.body as Record<string, unknown>).generatedAt = "2099-01-01T00:00:00.000Z";
    expect(statuses({ artifact })["artifact-digest"]).toBe("mismatch");
  });

  it("index-self-consistent: a self-contradicting index is a mismatch", () => {
    const index = JSON.parse(JSON.stringify(makeChain().index));
    index.retention.indexedArtifacts += 5; // counts no longer add up
    expect(statuses({ index })["index-self-consistent"]).toBe("mismatch");
  });

  it("policy-self-consistent: a flipped rollup verdict is a mismatch", () => {
    const policy = JSON.parse(JSON.stringify(makeChain().policy));
    expect(policy.rollup.verdict).toBe("pass");
    policy.rollup.verdict = "fail"; // lie: claim fail over a clean, satisfied policy
    expect(statuses({ policy })["policy-self-consistent"]).toBe("mismatch");
  });

  it("gate-artifact-agreement: a gate that disagrees with the artifact's archived gate is a mismatch", () => {
    const chain = makeChain({ generatedAt: NOW, verdict: "pass", gateVerdict: "pass" });
    const s = statuses({ gate: chain.gate, artifact: chain.artifact });
    expect(s["gate-artifact-agreement"]).toBe("ok");
    // Now a standalone gate that FAILED, while the artifact archived a passing gate.
    const disagree = statuses({ gate: makeChain().gate, artifact: makeArtifact({ gateVerdict: "fail" }) });
    // gate=pass vs artifact archived gate=fail
    expect(disagree["gate-artifact-agreement"]).toBe("mismatch");
  });

  it("artifact-index-inclusion: an artifact absent from the index is a mismatch", () => {
    const index = makeIndex([{ generatedAt: NOW, verdict: "pass" }]);
    const otherArtifact = makeArtifact({ generatedAt: "2026-01-01T00:00:00.000Z", verdict: "warn" });
    expect(statuses({ artifact: otherArtifact, index })["artifact-index-inclusion"]).toBe("mismatch");
  });

  it("index-policy-agreement: a policy over a DIFFERENT index is a mismatch", () => {
    const index = makeIndex([{ generatedAt: NOW, verdict: "pass" }]); // 1 artifact
    const policyOverTwo = makePolicyResult(
      makeIndex([{ generatedAt: NOW, verdict: "pass" }, { generatedAt: NOW, verdict: "pass" }]),
    ); // 2 artifacts
    expect(statuses({ index, policy: policyOverTwo })["index-policy-agreement"]).toBe("mismatch");
  });

  it("a link needing an unusable stage is skipped, never a silent pass", () => {
    // A recognized-but-inconsistent index: inclusion + agreement can't be evaluated → skipped.
    const badIndex = JSON.parse(JSON.stringify(makeChain().index));
    badIndex.digestCounts.verified += 3; // inconsistent
    const s = statuses({ artifact: makeChain().artifact, index: badIndex, policy: makeChain().policy });
    expect(s["index-self-consistent"]).toBe("mismatch");
    expect(s["artifact-index-inclusion"]).toBe("skipped");
    expect(s["index-policy-agreement"]).toBe("skipped");
  });
});
