import { describe, expect, it } from "vitest";
import { computeBundleRollup, pickDecisionStage } from "./rollup";
import { RELEASE_CI_BUNDLE_EXIT } from "./types";
import type {
  ReleaseCiBundleConsistencyCheck,
  ReleaseCiBundleSeverity,
  ReleaseCiBundleStage,
  ReleaseCiBundleStageId,
} from "./types";

/** A minimal present stage of `id` at `severity` (facts are irrelevant to the rollup). */
function stage(id: ReleaseCiBundleStageId, severity: ReleaseCiBundleSeverity, present = true): ReleaseCiBundleStage {
  const base = {
    source: present ? ("supplied" as const) : ("not-supplied" as const),
    present,
    recognized: present,
    verdict: null,
    severity,
    detail: "",
  };
  // The `facts: null` discriminant satisfies each union member.
  return { ...base, stage: id, facts: null } as ReleaseCiBundleStage;
}

/** A consistency check with the given status. */
function check(status: ReleaseCiBundleConsistencyCheck["status"]): ReleaseCiBundleConsistencyCheck {
  return { id: "artifact-digest", severity: "block", status, detail: "" };
}

const NO_CHECKS: ReleaseCiBundleConsistencyCheck[] = [];

describe("release-ci-bundle rollup", () => {
  it("all stages pass with a decision stage → pass (0)", () => {
    const r = computeBundleRollup([stage("index", "pass"), stage("policy", "pass")], [check("ok")]);
    expect(r.verdict).toBe("pass");
    expect(r.exitCode).toBe(RELEASE_CI_BUNDLE_EXIT.PASS);
    expect(r.drivers).toEqual([]);
  });

  it("a stage fail dominates → fail (4)", () => {
    const r = computeBundleRollup([stage("index", "pass"), stage("policy", "fail")], NO_CHECKS);
    expect(r.verdict).toBe("fail");
    expect(r.exitCode).toBe(RELEASE_CI_BUNDLE_EXIT.FAIL);
    expect(r.drivers).toContain("stage-failed");
  });

  it("a consistency mismatch forces fail even with all stages passing", () => {
    const r = computeBundleRollup([stage("index", "pass"), stage("policy", "pass")], [check("mismatch")]);
    expect(r.verdict).toBe("fail");
    expect(r.drivers).toContain("chain-inconsistent");
    expect(r.inconsistencies).toBe(1);
  });

  it("fail beats a warn AND an unknown present at the same time", () => {
    const r = computeBundleRollup(
      [stage("index", "warn"), stage("policy", "fail"), stage("gate", "unknown")],
      NO_CHECKS,
    );
    expect(r.verdict).toBe("fail");
    // superset drivers: every applicable condition is listed.
    expect(r.drivers).toEqual(expect.arrayContaining(["stage-failed", "stage-unknown", "stage-warned"]));
  });

  it("no decision stage → unknown (incomplete-chain), even if a build stage passed", () => {
    const r = computeBundleRollup([stage("gate", "pass"), stage("artifact", "pass")], [check("ok")]);
    expect(r.verdict).toBe("unknown");
    expect(r.exitCode).toBe(RELEASE_CI_BUNDLE_EXIT.UNKNOWN);
    expect(r.drivers).toContain("incomplete-chain");
    expect(r.drivers).not.toContain("stage-warned");
  });

  it("an unreadable source → unknown (stage-unreadable), even with a decision stage present", () => {
    const gate = stage("gate", "unknown", false);
    const unreadable: ReleaseCiBundleStage = { ...gate, source: "unreadable" };
    const r = computeBundleRollup([unreadable, stage("index", "pass")], [check("ok")]);
    expect(r.verdict).toBe("unknown");
    expect(r.drivers).toContain("stage-unreadable");
  });

  it("unknown beats warn (an uncertifiable chain never masquerades as advisory)", () => {
    const r = computeBundleRollup([stage("index", "warn"), stage("policy", "unknown")], NO_CHECKS);
    expect(r.verdict).toBe("unknown");
  });

  it("warn only when nothing worse and a decision stage is present", () => {
    const r = computeBundleRollup([stage("policy", "warn")], [check("ok"), check("skipped")]);
    expect(r.verdict).toBe("warn");
    expect(r.exitCode).toBe(RELEASE_CI_BUNDLE_EXIT.WARN);
    expect(r.drivers).toEqual(["stage-warned"]);
  });

  it("pickDecisionStage honors policy > index > artifact > gate", () => {
    expect(pickDecisionStage([stage("gate", "pass"), stage("index", "pass"), stage("policy", "pass")])).toBe("policy");
    expect(pickDecisionStage([stage("gate", "pass"), stage("index", "pass")])).toBe("index");
    expect(pickDecisionStage([stage("gate", "pass"), stage("artifact", "pass")])).toBe("artifact");
    expect(pickDecisionStage([stage("gate", "pass")])).toBe("gate");
    expect(pickDecisionStage([stage("gate", "unknown", false)])).toBeNull();
  });

  it("chainComplete only when all four stages are present", () => {
    const four = ["gate", "artifact", "index", "policy"].map((id) => stage(id as ReleaseCiBundleStageId, "pass"));
    expect(computeBundleRollup(four, NO_CHECKS).chainComplete).toBe(true);
    expect(computeBundleRollup(four.slice(0, 3), NO_CHECKS).chainComplete).toBe(false);
  });
});
