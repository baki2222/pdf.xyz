import { describe, expect, it } from "vitest";
import { applyWindow, computeCloseoutIndexRollup, deriveTrendClass, reduceIndex } from "./reduce";
import {
  blockedCloseout,
  closedCloseout,
  incompleteCloseout,
  ingestCloseoutFrom,
  notACloseout,
  openCloseout,
  tamperedCloseout,
} from "./fixtures";
import { UNRECOGNIZED_CLOSEOUT } from "./ingest";
import {
  DEFAULT_MAX_CLOSEOUTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutVerdict,
} from "./types";

const POLICY = (
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexPolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexPolicy => ({
  maxCloseouts: DEFAULT_MAX_CLOSEOUTS,
  maxOpen: 0,
  maxIncomplete: 0,
  requireLatestClosed: false,
  strictOpen: false,
  ...over,
});

/** Reduce + fold a list of closeout objects (oldest → newest) and return the composite verdict. */
function verdictOf(
  objs: readonly unknown[],
  policy: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexPolicy> = {},
): string {
  const { coverage, distribution } = reduceIndex(ingestCloseoutFrom(objs), POLICY(policy).maxCloseouts);
  return computeCloseoutIndexRollup(coverage, distribution, POLICY(policy)).rollup.verdict;
}

describe("applyWindow — bounded, never silent", () => {
  it("keeps the newest N and surfaces the dropped count", () => {
    const list = [UNRECOGNIZED_CLOSEOUT, UNRECOGNIZED_CLOSEOUT, UNRECOGNIZED_CLOSEOUT];
    const w = applyWindow(list, 2);
    expect(w.considered.length).toBe(2);
    expect(w.closeoutsSupplied).toBe(3);
    expect(w.truncated).toBe(true);
    expect(w.droppedOldest).toBe(1);
  });

  it("keeps everything when the cap is not exceeded", () => {
    const w = applyWindow([UNRECOGNIZED_CLOSEOUT], 26);
    expect(w.truncated).toBe(false);
    expect(w.droppedOldest).toBe(0);
  });
});

describe("deriveTrendClass — worst-present, strict-independent", () => {
  const counts = (over: Partial<Record<string, number>> = {}) =>
    ({
      closed: 0,
      incomplete: 0,
      open: 0,
      blocked: 0,
      invalid: 0,
      ...over,
    }) as Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutVerdict, number>;

  it("invalid (tampered OR unreadable input) outranks blocked / open / incomplete", () => {
    expect(deriveTrendClass(1, 0, 1, counts({ closed: 1, blocked: 1 }))).toBe("invalid-present");
    expect(deriveTrendClass(0, 1, 0, counts())).toBe("invalid-present");
  });
  it("blocked (own verdict blocked/invalid) > open > incomplete > all-closed; no-usable when empty", () => {
    expect(deriveTrendClass(2, 0, 0, counts({ closed: 1, blocked: 1 }))).toBe("blocked-present");
    expect(deriveTrendClass(2, 0, 0, counts({ closed: 1, invalid: 1 }))).toBe("blocked-present");
    expect(deriveTrendClass(2, 0, 0, counts({ closed: 1, open: 1 }))).toBe("open-present");
    expect(deriveTrendClass(2, 0, 0, counts({ closed: 1, incomplete: 1 }))).toBe("incomplete-present");
    expect(deriveTrendClass(2, 0, 0, counts({ closed: 2 }))).toBe("all-closed");
    expect(deriveTrendClass(0, 0, 0, counts())).toBe("no-usable");
  });
});

describe("reduceIndex — distribution, latest, coverage", () => {
  it("tallies the usable closeout-verdict distribution + newest/oldest, ignoring unreadable/tampered", () => {
    const objs = [closedCloseout(), notACloseout(), openCloseout()];
    const { coverage, distribution, latest } = reduceIndex(ingestCloseoutFrom(objs), 26);
    expect(coverage.closeoutsSupplied).toBe(3);
    expect(coverage.closeoutsUsable).toBe(2);
    expect(coverage.closeoutsUnreadable).toBe(1);
    expect(distribution.verdictCounts.closed).toBe(1);
    expect(distribution.verdictCounts.open).toBe(1);
    expect(distribution.newest).toBe("open");
    expect(distribution.oldest).toBe("closed");
    expect(latest?.verdict).toBe("open");
  });

  it("latest is null and class no-usable when nothing is usable", () => {
    const { distribution, latest } = reduceIndex(ingestCloseoutFrom([]), 26);
    expect(distribution.newest).toBeNull();
    expect(latest).toBeNull();
    expect(distribution.trendClass).toBe("no-usable");
  });
});

describe("computeCloseoutIndexRollup — fail-closed precedence invalid > blocked > open > incomplete > indexed", () => {
  it("a coherent all-closed history is indexed (exit 0) with history-coherent", () => {
    const { coverage, distribution } = reduceIndex(ingestCloseoutFrom([closedCloseout(), closedCloseout()]), 26);
    const { rollup } = computeCloseoutIndexRollup(coverage, distribution, POLICY());
    expect(rollup.verdict).toBe("indexed");
    expect(rollup.exitCode).toBe(0);
    expect(rollup.reasons).toContain("latest-closed");
    expect(rollup.reasons).toContain("history-coherent");
  });

  it("a latest-open history is index-open (exit 3)", () => {
    expect(verdictOf([closedCloseout(), openCloseout()])).toBe("index-open");
  });

  it("a latest-incomplete history is index-incomplete (exit 2)", () => {
    expect(verdictOf([closedCloseout(), incompleteCloseout()])).toBe("index-incomplete");
  });

  it("any blocked / invalid-posture record (latest or not) is index-blocked (exit 4)", () => {
    expect(verdictOf([closedCloseout(), blockedCloseout()])).toBe("index-blocked");
    // an OLDER blocked record still blocks (no bounded tolerance for a blocked closeout)
    expect(verdictOf([blockedCloseout(), closedCloseout()])).toBe("index-blocked");
  });

  it("a tampered or unreadable record is index-invalid (exit 4), the TOP precedence above blocked", () => {
    expect(verdictOf([closedCloseout(), tamperedCloseout()])).toBe("index-invalid");
    expect(verdictOf([closedCloseout(), notACloseout()])).toBe("index-invalid");
    // invalid outranks blocked: a window with BOTH a blocked and a tampered record is index-invalid
    expect(verdictOf([blockedCloseout(), tamperedCloseout()])).toBe("index-invalid");
  });

  it("zero usable records is index-incomplete with no-closeouts", () => {
    const { coverage, distribution } = reduceIndex(ingestCloseoutFrom([]), 26);
    const { rollup } = computeCloseoutIndexRollup(coverage, distribution, POLICY());
    expect(rollup.verdict).toBe("index-incomplete");
    expect(rollup.reasons).toContain("no-closeouts");
  });
});

describe("computeCloseoutIndexRollup — thresholds", () => {
  it("--max-open tolerates a bounded number of older opens (latest closed) → indexed", () => {
    expect(verdictOf([openCloseout(), closedCloseout()])).toBe("index-open"); // default max-open=0
    expect(verdictOf([openCloseout(), closedCloseout()], { maxOpen: 1 })).toBe("indexed");
  });

  it("--max-incomplete tolerates a bounded number of older incompletes (latest closed) → indexed", () => {
    expect(verdictOf([incompleteCloseout(), closedCloseout()])).toBe("index-incomplete"); // default 0
    expect(verdictOf([incompleteCloseout(), closedCloseout()], { maxIncomplete: 1 })).toBe("indexed");
  });
});

describe("computeCloseoutIndexRollup — --require-latest-closed", () => {
  it("an open latest still dominates the incomplete require-latest reason", () => {
    expect(verdictOf([closedCloseout(), openCloseout()], { maxOpen: 1, requireLatestClosed: true })).toBe("index-open");
  });

  it("does not fire when the latest usable record is closed", () => {
    const { coverage, distribution } = reduceIndex(ingestCloseoutFrom([closedCloseout()]), 26);
    const { rollup } = computeCloseoutIndexRollup(coverage, distribution, POLICY({ requireLatestClosed: true }));
    expect(rollup.verdict).toBe("indexed");
    expect(rollup.reasons).not.toContain("latest-not-closed");
  });

  it("fires latest-not-closed when required and the latest is not closed (surfaced in reasons)", () => {
    const { coverage, distribution } = reduceIndex(ingestCloseoutFrom([incompleteCloseout()]), 26);
    const { rollup } = computeCloseoutIndexRollup(coverage, distribution, POLICY({ requireLatestClosed: true }));
    expect(rollup.verdict).toBe("index-incomplete");
    expect(rollup.reasons).toContain("latest-not-closed");
  });
});

describe("computeCloseoutIndexRollup — --strict-open escalation", () => {
  it("escalates an open history to index-blocked and records strictOpenEscalatedFrom", () => {
    const { coverage, distribution } = reduceIndex(ingestCloseoutFrom([closedCloseout(), openCloseout()]), 26);
    const { rollup } = computeCloseoutIndexRollup(coverage, distribution, POLICY({ strictOpen: true }));
    expect(rollup.verdict).toBe("index-blocked");
    expect(rollup.strictOpenEscalated).toBe(true);
    expect(rollup.strictOpenEscalatedFrom).toBe("index-open");
    expect(rollup.reasons).toContain("strict-open-escalation");
  });

  it("leaves a coherent history untouched (indexed)", () => {
    expect(verdictOf([closedCloseout(), closedCloseout()], { strictOpen: true })).toBe("indexed");
  });

  it("does not weaken a tampered history (stays index-invalid)", () => {
    expect(verdictOf([tamperedCloseout(), openCloseout()], { strictOpen: true })).toBe("index-invalid");
  });
});
