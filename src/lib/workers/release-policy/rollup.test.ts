import { describe, expect, it } from "vitest";
import { computePolicyRollup, RELEASE_POLICY_EXIT_FOR_VERDICT } from "./rollup";
import { UNRECOGNIZED_INDEX, type IngestedIndex } from "./ingest";
import type { ReleasePolicyFacts, ReleasePolicyViolation } from "./types";

function facts(over: Partial<ReleasePolicyFacts> = {}): ReleasePolicyFacts {
  return {
    archiveVerdict: "ok",
    indexedArtifacts: 3,
    skippedInputs: 0,
    totalInputs: 3,
    integrityFailures: 0,
    verdictCounts: { pass: 3, warn: 0, fail: 0, unknown: 0 },
    overRetentionCount: 0,
    overCount: false,
    overAge: false,
    stale: false,
    newestAgeBucket: "1-7d",
    oldestAgeBucket: "7-30d",
    latestVerdict: "pass",
    ...over,
  };
}

function usable(over: Partial<ReleasePolicyFacts> = {}): IngestedIndex {
  const f = facts(over);
  return { recognized: true, usable: true, reportedVerdict: f.archiveVerdict, effectiveVerdict: f.archiveVerdict, facts: f };
}

const block: ReleasePolicyViolation = { id: "too-many-fail", severity: "block", observed: 2, limit: 0, detail: "x" };
const warn: ReleasePolicyViolation = { id: "too-many-warn", severity: "warn", observed: 2, limit: 0, detail: "x" };

describe("computePolicyRollup", () => {
  it("maps every verdict to its exit code", () => {
    expect(RELEASE_POLICY_EXIT_FOR_VERDICT).toEqual({ pass: 0, unknown: 2, warn: 3, fail: 4 });
  });

  it("an unrecognized index is unknown (no-index)", () => {
    const r = computePolicyRollup(UNRECOGNIZED_INDEX, []);
    expect(r.verdict).toBe("unknown");
    expect(r.exitCode).toBe(2);
    expect(r.drivers).toEqual(["no-index"]);
  });

  it("a recognized-but-unusable index is fail (invalid-index)", () => {
    const ingested: IngestedIndex = { recognized: true, usable: false, reportedVerdict: "ok", effectiveVerdict: null, facts: null };
    const r = computePolicyRollup(ingested, []);
    expect(r.verdict).toBe("fail");
    expect(r.exitCode).toBe(4);
    expect(r.drivers).toEqual(["invalid-index"]);
  });

  it("a clean usable index under no violations is pass", () => {
    const r = computePolicyRollup(usable(), []);
    expect(r.verdict).toBe("pass");
    expect(r.ready).toBe(true);
    expect(r.drivers).toEqual([]);
  });

  it("a blocking violation is fail", () => {
    const r = computePolicyRollup(usable(), [block]);
    expect(r.verdict).toBe("fail");
    expect(r.blockingViolations).toBe(1);
    expect(r.drivers).toEqual(["blocking-violation"]);
  });

  it("a tampered (effective invalid) archive adds the invalid-index driver before blocking-violation", () => {
    const ingested = usable({ archiveVerdict: "invalid", integrityFailures: 1 });
    const tampered: ReleasePolicyViolation = { id: "index-tampered", severity: "block", observed: "invalid", limit: null, detail: "x" };
    const r = computePolicyRollup(ingested, [tampered]);
    expect(r.verdict).toBe("fail");
    expect(r.drivers).toEqual(["invalid-index", "blocking-violation"]);
  });

  it("an empty archive with no blocking violation is unknown", () => {
    const r = computePolicyRollup(usable({ indexedArtifacts: 0, archiveVerdict: "unknown", verdictCounts: { pass: 0, warn: 0, fail: 0, unknown: 0 }, latestVerdict: null }), []);
    expect(r.verdict).toBe("unknown");
    expect(r.drivers).toEqual(["empty-archive"]);
  });

  it("an empty archive WITH a blocking violation is fail (block dominates unknown)", () => {
    const r = computePolicyRollup(usable({ indexedArtifacts: 0, archiveVerdict: "unknown", latestVerdict: null }), [
      { id: "too-few-artifacts", severity: "block", observed: 0, limit: 1, detail: "x" },
    ]);
    expect(r.verdict).toBe("fail");
  });

  it("only warning violations yield warn", () => {
    const r = computePolicyRollup(usable(), [warn]);
    expect(r.verdict).toBe("warn");
    expect(r.warningViolations).toBe(1);
    expect(r.drivers).toEqual(["warning-violation"]);
  });

  it("a block AND a warn together is fail (block dominates)", () => {
    const r = computePolicyRollup(usable(), [block, warn]);
    expect(r.verdict).toBe("fail");
    expect(r.blockingViolations).toBe(1);
    expect(r.warningViolations).toBe(1);
  });
});
