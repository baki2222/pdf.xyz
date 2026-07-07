import { describe, expect, it } from "vitest";
import { applyWindow, computeCloseoutIndexRollup, deriveTrendClass, reduceIndex } from "./reduce";
import {
  blockedCloseout,
  closedCloseout,
  incompleteCloseout,
  ingestCloseoutFrom,
  invalidCloseout,
  notACloseout,
  openCloseout,
  tamperedCloseout,
} from "./fixtures";
import { UNRECOGNIZED_CLOSEOUT } from "./ingest";
import {
  DEFAULT_MAX_CLOSEOUTS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexPolicy,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutVerdict,
} from "./types";

const POLICY = (
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexPolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexPolicy => ({
  maxCloseouts: DEFAULT_MAX_CLOSEOUTS,
  maxOpen: 0,
  maxIncomplete: 0,
  strictOpen: false,
  ...over,
});

/** Reduce + fold a list of closeout objects (oldest → newest) and return the composite verdict. */
function verdictOf(
  objs: readonly unknown[],
  policy: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexPolicy> = {},
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
    }) as Record<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutVerdict, number>;

  it("invalid (tampered / unreadable input OR own-verdict invalid) outranks blocked / open / incomplete", () => {
    expect(deriveTrendClass(1, 0, 1, counts({ closed: 1, blocked: 1 }))).toBe("invalid-present");
    expect(deriveTrendClass(0, 1, 0, counts())).toBe("invalid-present");
    // a usable record whose OWN verdict is `invalid` is an untrustworthy loop → invalid-present
    expect(deriveTrendClass(2, 0, 0, counts({ closed: 1, invalid: 1 }))).toBe("invalid-present");
  });
  it("blocked (own verdict blocked) > open > incomplete > all-closed; no-usable when empty", () => {
    expect(deriveTrendClass(2, 0, 0, counts({ closed: 1, blocked: 1 }))).toBe("blocked-present");
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

describe("computeCloseoutIndexRollup — fail-closed precedence invalid > blocked > open > incomplete > all-closed", () => {
  it("a coherent all-closed history is all-closed (exit 0) with history-coherent", () => {
    const { coverage, distribution } = reduceIndex(ingestCloseoutFrom([closedCloseout(), closedCloseout()]), 26);
    const { rollup } = computeCloseoutIndexRollup(coverage, distribution, POLICY());
    expect(rollup.verdict).toBe("all-closed");
    expect(rollup.exitCode).toBe(0);
    expect(rollup.allClosed).toBe(true);
    expect(rollup.reasons).toContain("latest-closed");
    expect(rollup.reasons).toContain("history-coherent");
  });

  it("a latest-open history is open (exit 3)", () => {
    expect(verdictOf([closedCloseout(), openCloseout()])).toBe("open");
  });

  it("a latest-incomplete history is incomplete (exit 2)", () => {
    expect(verdictOf([closedCloseout(), incompleteCloseout()])).toBe("incomplete");
  });

  it("any blocked record (latest or older) is blocked (exit 4); no bounded tolerance for a blocked closeout", () => {
    expect(verdictOf([closedCloseout(), blockedCloseout()])).toBe("blocked");
    expect(verdictOf([blockedCloseout(), closedCloseout()])).toBe("blocked");
  });

  it("a usable record whose OWN verdict is `invalid` is invalid (exit 4), above blocked", () => {
    expect(verdictOf([closedCloseout(), invalidCloseout()])).toBe("invalid");
    expect(verdictOf([invalidCloseout(), closedCloseout()])).toBe("invalid");
    // invalid outranks blocked
    expect(verdictOf([blockedCloseout(), invalidCloseout()])).toBe("invalid");
  });

  it("a tampered or unreadable record is invalid (exit 4), the TOP precedence above blocked", () => {
    expect(verdictOf([closedCloseout(), tamperedCloseout()])).toBe("invalid");
    expect(verdictOf([closedCloseout(), notACloseout()])).toBe("invalid");
    expect(verdictOf([blockedCloseout(), tamperedCloseout()])).toBe("invalid");
  });

  it("zero usable records is invalid with no-closeouts (never a vacuous all-closed)", () => {
    const { coverage, distribution } = reduceIndex(ingestCloseoutFrom([]), 26);
    const { rollup } = computeCloseoutIndexRollup(coverage, distribution, POLICY());
    expect(rollup.verdict).toBe("invalid");
    expect(rollup.reasons).toContain("no-closeouts");
  });
});

describe("computeCloseoutIndexRollup — thresholds (older records only; latest never tolerated)", () => {
  it("--max-open tolerates a bounded number of OLDER opens (latest closed) → all-closed", () => {
    expect(verdictOf([openCloseout(), closedCloseout()])).toBe("open"); // default max-open=0
    expect(verdictOf([openCloseout(), closedCloseout()], { maxOpen: 1 })).toBe("all-closed");
  });

  it("--max-incomplete tolerates a bounded number of OLDER incompletes (latest closed) → all-closed", () => {
    expect(verdictOf([incompleteCloseout(), closedCloseout()])).toBe("incomplete"); // default 0
    expect(verdictOf([incompleteCloseout(), closedCloseout()], { maxIncomplete: 1 })).toBe("all-closed");
  });

  it("the latest record is never tolerated by a threshold", () => {
    // even with a generous older budget, an OPEN / INCOMPLETE latest still fires its own reason
    expect(verdictOf([closedCloseout(), openCloseout()], { maxOpen: 5 })).toBe("open");
    expect(verdictOf([closedCloseout(), incompleteCloseout()], { maxIncomplete: 5 })).toBe("incomplete");
  });
});

describe("computeCloseoutIndexRollup — --strict-open escalation (open OR incomplete → blocked)", () => {
  it("escalates an open history to blocked and records strictOpenEscalatedFrom", () => {
    const { coverage, distribution } = reduceIndex(ingestCloseoutFrom([closedCloseout(), openCloseout()]), 26);
    const { rollup } = computeCloseoutIndexRollup(coverage, distribution, POLICY({ strictOpen: true }));
    expect(rollup.verdict).toBe("blocked");
    expect(rollup.strictOpenEscalated).toBe(true);
    expect(rollup.strictOpenEscalatedFrom).toBe("open");
    expect(rollup.reasons).toContain("strict-open-escalation");
  });

  it("escalates an incomplete history to blocked and records strictOpenEscalatedFrom", () => {
    const { coverage, distribution } = reduceIndex(ingestCloseoutFrom([closedCloseout(), incompleteCloseout()]), 26);
    const { rollup } = computeCloseoutIndexRollup(coverage, distribution, POLICY({ strictOpen: true }));
    expect(rollup.verdict).toBe("blocked");
    expect(rollup.strictOpenEscalated).toBe(true);
    expect(rollup.strictOpenEscalatedFrom).toBe("incomplete");
    expect(rollup.reasons).toContain("strict-open-escalation");
  });

  it("leaves a coherent history untouched (all-closed)", () => {
    expect(verdictOf([closedCloseout(), closedCloseout()], { strictOpen: true })).toBe("all-closed");
  });

  it("does not weaken a tampered history (stays invalid)", () => {
    expect(verdictOf([tamperedCloseout(), openCloseout()], { strictOpen: true })).toBe("invalid");
  });
});
