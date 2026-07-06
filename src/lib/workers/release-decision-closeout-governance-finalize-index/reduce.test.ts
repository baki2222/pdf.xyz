import { describe, expect, it } from "vitest";
import {
  applyWindow,
  computeFinalizeIndexRollup,
  deriveTrendClass,
  reduceIndex,
} from "./reduce";
import {
  blockedFinalize,
  finalizedFinalize,
  incompleteFinalize,
  ingestFinalizeFrom,
  notAFinalize,
  openFinalize,
  tamperedFinalize,
} from "./fixtures";
import { UNRECOGNIZED_FINALIZE } from "./ingest";
import {
  DEFAULT_MAX_FINALIZATIONS,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexPolicy,
} from "./types";

const POLICY = (over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexPolicy> = {}): ReleaseDecisionCloseoutGovernanceFinalizeIndexPolicy => ({
  maxFinalizations: DEFAULT_MAX_FINALIZATIONS,
  maxOpen: 0,
  maxIncomplete: 0,
  requireLatestFinalized: false,
  strictOpen: false,
  ...over,
});

/** Reduce + fold a list of finalization objects (oldest → newest) and return the composite verdict. */
function verdictOf(
  objs: readonly unknown[],
  policy: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexPolicy> = {},
): string {
  const { coverage, distribution } = reduceIndex(ingestFinalizeFrom(objs), POLICY(policy).maxFinalizations);
  return computeFinalizeIndexRollup(coverage, distribution, POLICY(policy)).rollup.verdict;
}

describe("applyWindow — bounded, never silent", () => {
  it("keeps the newest N and surfaces the dropped count", () => {
    const list = [UNRECOGNIZED_FINALIZE, UNRECOGNIZED_FINALIZE, UNRECOGNIZED_FINALIZE];
    const w = applyWindow(list, 2);
    expect(w.considered.length).toBe(2);
    expect(w.finalizationsSupplied).toBe(3);
    expect(w.truncated).toBe(true);
    expect(w.droppedOldest).toBe(1);
  });

  it("keeps everything when the cap is not exceeded", () => {
    const w = applyWindow([UNRECOGNIZED_FINALIZE], 26);
    expect(w.truncated).toBe(false);
    expect(w.droppedOldest).toBe(0);
  });
});

describe("deriveTrendClass — worst-present, strict-independent", () => {
  const counts = (over: Partial<Record<string, number>> = {}) => ({
    finalized: 0,
    "finalize-incomplete": 0,
    "finalize-open": 0,
    "finalize-blocked": 0,
    ...over,
  }) as Record<import("./types").ReleaseDecisionCloseoutGovernanceFinalizeVerdict, number>;

  it("invalid (tampered OR unreadable) outranks blocked / open / incomplete", () => {
    expect(deriveTrendClass(1, 0, 1, counts({ finalized: 1, "finalize-blocked": 1 }))).toBe("invalid-present");
    expect(deriveTrendClass(0, 1, 0, counts())).toBe("invalid-present");
  });
  it("blocked > open > incomplete > all-finalized; no-usable when empty", () => {
    expect(deriveTrendClass(2, 0, 0, counts({ finalized: 1, "finalize-blocked": 1 }))).toBe("blocked-present");
    expect(deriveTrendClass(2, 0, 0, counts({ finalized: 1, "finalize-open": 1 }))).toBe("open-present");
    expect(deriveTrendClass(2, 0, 0, counts({ finalized: 1, "finalize-incomplete": 1 }))).toBe("incomplete-present");
    expect(deriveTrendClass(2, 0, 0, counts({ finalized: 2 }))).toBe("all-finalized");
    expect(deriveTrendClass(0, 0, 0, counts())).toBe("no-usable");
  });
});

describe("reduceIndex — distribution, latest, coverage", () => {
  it("tallies the usable finalization-verdict distribution + newest/oldest, ignoring unreadable/tampered", () => {
    const objs = [finalizedFinalize(), notAFinalize(), openFinalize()];
    const { coverage, distribution, latest } = reduceIndex(ingestFinalizeFrom(objs), 26);
    expect(coverage.finalizationsSupplied).toBe(3);
    expect(coverage.finalizationsUsable).toBe(2);
    expect(coverage.finalizationsUnreadable).toBe(1);
    expect(distribution.verdictCounts.finalized).toBe(1);
    expect(distribution.verdictCounts["finalize-open"]).toBe(1);
    expect(distribution.newest).toBe("finalize-open");
    expect(distribution.oldest).toBe("finalized");
    expect(latest?.verdict).toBe("finalize-open");
  });

  it("latest is null and class no-usable when nothing is usable", () => {
    const { distribution, latest } = reduceIndex(ingestFinalizeFrom([]), 26);
    expect(distribution.newest).toBeNull();
    expect(latest).toBeNull();
    expect(distribution.trendClass).toBe("no-usable");
  });
});

describe("computeFinalizeIndexRollup — fail-closed precedence invalid > blocked > open > incomplete > indexed", () => {
  it("a coherent all-finalized history is indexed (exit 0) with history-coherent", () => {
    const { coverage, distribution } = reduceIndex(ingestFinalizeFrom([finalizedFinalize(), finalizedFinalize()]), 26);
    const { rollup } = computeFinalizeIndexRollup(coverage, distribution, POLICY());
    expect(rollup.verdict).toBe("indexed");
    expect(rollup.exitCode).toBe(0);
    expect(rollup.reasons).toContain("latest-finalized");
    expect(rollup.reasons).toContain("history-coherent");
  });

  it("a latest-open history is index-open (exit 3)", () => {
    expect(verdictOf([finalizedFinalize(), openFinalize()])).toBe("index-open");
  });

  it("a latest-incomplete history is index-incomplete (exit 2)", () => {
    expect(verdictOf([finalizedFinalize(), incompleteFinalize()])).toBe("index-incomplete");
  });

  it("any blocked bundle (latest or not) is index-blocked (exit 4)", () => {
    expect(verdictOf([finalizedFinalize(), blockedFinalize()])).toBe("index-blocked");
    // an OLDER blocked bundle still blocks (no bounded tolerance for a blocked finalization)
    expect(verdictOf([blockedFinalize(), finalizedFinalize()])).toBe("index-blocked");
  });

  it("a tampered or unreadable bundle is index-invalid (exit 4), the TOP precedence above blocked", () => {
    expect(verdictOf([finalizedFinalize(), tamperedFinalize()])).toBe("index-invalid");
    expect(verdictOf([finalizedFinalize(), notAFinalize()])).toBe("index-invalid");
    // invalid outranks blocked: a window with BOTH a blocked and a tampered bundle is index-invalid
    expect(verdictOf([blockedFinalize(), tamperedFinalize()])).toBe("index-invalid");
  });

  it("zero usable bundles is index-incomplete with no-finalizations", () => {
    const { coverage, distribution } = reduceIndex(ingestFinalizeFrom([]), 26);
    const { rollup } = computeFinalizeIndexRollup(coverage, distribution, POLICY());
    expect(rollup.verdict).toBe("index-incomplete");
    expect(rollup.reasons).toContain("no-finalizations");
  });
});

describe("computeFinalizeIndexRollup — thresholds", () => {
  it("--max-open tolerates a bounded number of older opens (latest finalized) → indexed", () => {
    expect(verdictOf([openFinalize(), finalizedFinalize()])).toBe("index-open"); // default max-open=0
    expect(verdictOf([openFinalize(), finalizedFinalize()], { maxOpen: 1 })).toBe("indexed");
  });

  it("--max-incomplete tolerates a bounded number of older incompletes (latest finalized) → indexed", () => {
    expect(verdictOf([incompleteFinalize(), finalizedFinalize()])).toBe("index-incomplete"); // default 0
    expect(verdictOf([incompleteFinalize(), finalizedFinalize()], { maxIncomplete: 1 })).toBe("indexed");
  });
});

describe("computeFinalizeIndexRollup — --require-latest-finalized", () => {
  it("bites when a tolerated older-open latest is finalize-open (indexed → index-incomplete)", () => {
    // With --max-open=1 an older open would be tolerated, but a finalize-open LATEST is never finalized.
    expect(verdictOf([finalizedFinalize(), openFinalize()], { maxOpen: 1, requireLatestFinalized: true })).toBe(
      "index-open", // latest-open (open) still dominates the incomplete require-latest reason
    );
  });

  it("does not fire when the latest usable bundle is finalized", () => {
    const { coverage, distribution } = reduceIndex(ingestFinalizeFrom([finalizedFinalize()]), 26);
    const { rollup } = computeFinalizeIndexRollup(coverage, distribution, POLICY({ requireLatestFinalized: true }));
    expect(rollup.verdict).toBe("indexed");
    expect(rollup.reasons).not.toContain("latest-not-finalized");
  });

  it("fires latest-not-finalized when required and the latest is not finalized (surfaced in reasons)", () => {
    const { coverage, distribution } = reduceIndex(ingestFinalizeFrom([incompleteFinalize()]), 26);
    const { rollup } = computeFinalizeIndexRollup(coverage, distribution, POLICY({ requireLatestFinalized: true }));
    expect(rollup.verdict).toBe("index-incomplete");
    expect(rollup.reasons).toContain("latest-not-finalized");
  });
});

describe("computeFinalizeIndexRollup — --strict-open escalation", () => {
  it("escalates an open history to index-blocked and records strictOpenEscalatedFrom", () => {
    const { coverage, distribution } = reduceIndex(ingestFinalizeFrom([finalizedFinalize(), openFinalize()]), 26);
    const { rollup } = computeFinalizeIndexRollup(coverage, distribution, POLICY({ strictOpen: true }));
    expect(rollup.verdict).toBe("index-blocked");
    expect(rollup.strictOpenEscalated).toBe(true);
    expect(rollup.strictOpenEscalatedFrom).toBe("index-open");
    expect(rollup.reasons).toContain("strict-open-escalation");
  });

  it("leaves a coherent history untouched (indexed)", () => {
    expect(verdictOf([finalizedFinalize(), finalizedFinalize()], { strictOpen: true })).toBe("indexed");
  });

  it("does not weaken a tampered history (stays index-invalid)", () => {
    expect(verdictOf([tamperedFinalize(), openFinalize()], { strictOpen: true })).toBe("index-invalid");
  });
});
