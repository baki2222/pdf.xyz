import { describe, expect, it } from "vitest";
import { computeRollup, RELEASE_INDEX_EXIT_FOR_VERDICT } from "./rollup";
import { RELEASE_INDEX_EXIT, type ReleaseIndexDigestCounts, type ReleaseIndexRetention } from "./types";

const counts = (o: Partial<ReleaseIndexDigestCounts> = {}): ReleaseIndexDigestCounts => ({
  verified: 0,
  mismatch: 0,
  malformed: 0,
  unreadable: 0,
  ...o,
});

const retention = (o: Partial<ReleaseIndexRetention> = {}): ReleaseIndexRetention => ({
  maxArtifacts: null,
  maxAgeDays: null,
  totalInputs: 0,
  indexedArtifacts: 0,
  skippedInputs: 0,
  overRetentionCount: 0,
  overCount: false,
  overAge: false,
  stale: false,
  newestAgeBucket: "unknown",
  oldestAgeBucket: "unknown",
  ...o,
});

describe("computeRollup", () => {
  it("is `ok` when ≥1 artifact, all verified, within retention", () => {
    const r = computeRollup(counts({ verified: 3 }), retention({ indexedArtifacts: 3 }), 3, 0);
    expect(r.verdict).toBe("ok");
    expect(r.exitCode).toBe(RELEASE_INDEX_EXIT.OK);
    expect(r.ready).toBe(true);
    expect(r.drivers).toEqual([]);
  });

  it("is `unknown` (empty) when no artifact was indexed, even with unreadable inputs", () => {
    const r = computeRollup(counts({ unreadable: 2 }), retention({ skippedInputs: 2 }), 0, 2);
    expect(r.verdict).toBe("unknown");
    expect(r.exitCode).toBe(RELEASE_INDEX_EXIT.INSUFFICIENT);
    expect(r.drivers).toEqual(["empty"]);
  });

  it("is `invalid` when any digest mismatched (tampered)", () => {
    const r = computeRollup(counts({ verified: 2, mismatch: 1 }), retention({ indexedArtifacts: 3 }), 3, 0);
    expect(r.verdict).toBe("invalid");
    expect(r.exitCode).toBe(RELEASE_INDEX_EXIT.INVALID);
    expect(r.drivers).toContain("tampered-artifact");
  });

  it("is `invalid` when any digest is malformed", () => {
    const r = computeRollup(counts({ verified: 1, malformed: 1 }), retention({ indexedArtifacts: 2 }), 2, 0);
    expect(r.verdict).toBe("invalid");
    expect(r.drivers).toContain("malformed-digest");
  });

  it("invalid DOMINATES a simultaneous retention concern", () => {
    const r = computeRollup(
      counts({ verified: 5, mismatch: 1 }),
      retention({ indexedArtifacts: 6, overCount: true, stale: true }),
      6,
      0,
    );
    expect(r.verdict).toBe("invalid");
    // all concerns are still surfaced as drivers, in stable order
    expect(r.drivers).toEqual(["tampered-artifact", "retention-count", "stale"]);
  });

  it("is `warn` for retention over-count with all digests verified", () => {
    const r = computeRollup(counts({ verified: 5 }), retention({ indexedArtifacts: 5, overCount: true }), 5, 0);
    expect(r.verdict).toBe("warn");
    expect(r.exitCode).toBe(RELEASE_INDEX_EXIT.WARN);
    expect(r.drivers).toEqual(["retention-count"]);
  });

  it("is `warn` for over-age, stale, or a skipped non-artifact input", () => {
    expect(computeRollup(counts({ verified: 2 }), retention({ indexedArtifacts: 2, overAge: true }), 2, 0).drivers).toEqual(["retention-age"]);
    expect(computeRollup(counts({ verified: 2 }), retention({ indexedArtifacts: 2, stale: true }), 2, 0).drivers).toEqual(["stale"]);
    const skip = computeRollup(counts({ verified: 2, unreadable: 1 }), retention({ indexedArtifacts: 2, skippedInputs: 1 }), 2, 1);
    expect(skip.verdict).toBe("warn");
    expect(skip.drivers).toEqual(["unreadable-input"]);
  });

  it("emits drivers in the stable declared order regardless of accumulation", () => {
    const r = computeRollup(
      counts({ verified: 1, mismatch: 1, malformed: 1, unreadable: 1 }),
      retention({ indexedArtifacts: 3, overCount: true, overAge: true, stale: true, skippedInputs: 1 }),
      3,
      1,
    );
    expect(r.drivers).toEqual([
      "tampered-artifact",
      "malformed-digest",
      "retention-count",
      "retention-age",
      "stale",
      "unreadable-input",
    ]);
  });

  it("the verdict→exit map is monotonic (ok<insufficient<warn<invalid)", () => {
    expect(RELEASE_INDEX_EXIT_FOR_VERDICT.ok).toBeLessThan(RELEASE_INDEX_EXIT_FOR_VERDICT.unknown);
    expect(RELEASE_INDEX_EXIT_FOR_VERDICT.unknown).toBeLessThan(RELEASE_INDEX_EXIT_FOR_VERDICT.warn);
    expect(RELEASE_INDEX_EXIT_FOR_VERDICT.warn).toBeLessThan(RELEASE_INDEX_EXIT_FOR_VERDICT.invalid);
  });
});
