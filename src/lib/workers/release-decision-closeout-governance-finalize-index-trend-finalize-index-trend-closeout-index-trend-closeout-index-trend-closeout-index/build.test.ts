import { describe, expect, it } from "vitest";
import { buildCloseoutIndexResult, buildNextActions } from "./build";
import {
  blockedCloseout,
  closedCloseout,
  ingestCloseoutFrom,
  notACloseout,
  openCloseout,
  tamperedCloseout,
  NOW,
} from "./fixtures";
import {
  DEFAULT_MAX_CLOSEOUTS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_SCHEMA,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexPolicy,
} from "./types";

const POLICY = (
  over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexPolicy> = {},
): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexPolicy => ({
  maxCloseouts: DEFAULT_MAX_CLOSEOUTS,
  maxOpen: 0,
  maxIncomplete: 0,
  strictOpen: false,
  ...over,
});

function build(
  objs: readonly unknown[],
  policy: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutIndexTrendCloseoutIndexPolicy> = {},
) {
  return buildCloseoutIndexResult(NOW, ingestCloseoutFrom(objs), POLICY(policy));
}

describe("buildCloseoutIndexResult — stable shape", () => {
  it("pins the schema, metadata, its own stamp, and mirrors verdict/exit at the top level", () => {
    const r = build([closedCloseout(), closedCloseout()]);
    expect(r.schema).toBe(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_SCHEMA);
    expect(r.generatedAt).toBe(NOW);
    expect(r.metadata.closeoutSchema).toBe(
      "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/1",
    );
    expect(r.verdict).toBe(r.closeoutIndex.verdict);
    expect(r.exitCode).toBe(r.closeoutIndex.exitCode);
    expect(r.verdict).toBe("all-closed");
    expect(r.receipt.category).toBe(
      "worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout-index",
    );
    expect(r.receipt.disclosure).toMatch(/content-free/i);
  });

  it("emits one point per considered record, oldest → newest, with the supplied-order positions", () => {
    const r = build([closedCloseout(), openCloseout(), blockedCloseout()]);
    expect(r.points.map((p) => p.position)).toEqual([0, 1, 2]);
    expect(r.points.map((p) => p.verdict)).toEqual(["closed", "open", "blocked"]);
    expect(r.points.map((p) => p.state)).toEqual(["usable", "usable", "usable"]);
  });

  it("surfaces a tampered point's claimed verdict but marks it tampered (no trusted facts)", () => {
    const r = build([tamperedCloseout()]);
    expect(r.points[0]!.state).toBe("tampered");
    expect(r.points[0]!.verdict).toBe("blocked"); // the untrusted claim
    expect(r.points[0]!.receiptVerdict).toBeNull();
    expect(r.verdict).toBe("invalid");
  });

  it("carries the latest usable summary (null when none usable)", () => {
    expect(build([closedCloseout(), openCloseout()]).latest?.verdict).toBe("open");
    expect(build([notACloseout()]).latest).toBeNull();
  });

  it("surfaces the window-cap drop count (never silent)", () => {
    const r = build([closedCloseout(), closedCloseout(), closedCloseout()], { maxCloseouts: 2 });
    expect(r.coverage.closeoutsSupplied).toBe(3);
    expect(r.coverage.closeoutsConsidered).toBe(2);
    expect(r.coverage.truncated).toBe(true);
    expect(r.coverage.droppedOldest).toBe(1);
  });
});

describe("buildNextActions — ordered, deduped, always keeps the index", () => {
  it("a coherent history recommends continue + keep only", () => {
    const r = build([closedCloseout()]);
    expect(r.nextActions.map((a) => a.id)).toEqual(["continue-recording-closeout", "keep-closeout-index"]);
  });

  it("an invalid history recommends recovering the untrustworthy record + keep", () => {
    const r = build([tamperedCloseout(), notACloseout()]);
    const ids = r.nextActions.map((a) => a.id);
    expect(ids).toContain("recover-tampered-closeout");
    expect(ids).toContain("recover-unreadable-closeout");
    expect(ids[ids.length - 1]).toBe("keep-closeout-index");
  });

  it("keep-closeout-index is always the last action", () => {
    for (const objs of [[closedCloseout()], [openCloseout()], [blockedCloseout()], [tamperedCloseout()]]) {
      const r = build(objs);
      expect(r.nextActions[r.nextActions.length - 1]!.id).toBe("keep-closeout-index");
    }
  });

  it("buildNextActions dedupes shared checklist ids across reasons", () => {
    // latest-blocked + blocked-in-history both map to review-blocked-closeout → appears once.
    const items = buildNextActions(["latest-blocked", "blocked-in-history"]);
    expect(items.filter((i) => i.id === "review-blocked-closeout")).toHaveLength(1);
  });
});
