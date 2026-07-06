import { describe, expect, it } from "vitest";
import { buildFinalizeIndexResult, buildNextActions } from "./build";
import {
  blockedFinalize,
  finalizedFinalize,
  ingestFinalizeFrom,
  notAFinalize,
  openFinalize,
  tamperedFinalize,
  NOW,
} from "./fixtures";
import {
  DEFAULT_MAX_FINALIZATIONS,
  RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_SCHEMA,
  type ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexPolicy,
} from "./types";

const POLICY = (over: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexPolicy> = {}): ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexPolicy => ({
  maxFinalizations: DEFAULT_MAX_FINALIZATIONS,
  maxOpen: 0,
  maxIncomplete: 0,
  requireLatestFinalized: false,
  strictOpen: false,
  ...over,
});

function build(objs: readonly unknown[], policy: Partial<ReleaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexPolicy> = {}) {
  return buildFinalizeIndexResult(NOW, ingestFinalizeFrom(objs), POLICY(policy));
}

describe("buildFinalizeIndexResult — stable shape", () => {
  it("pins the schema, metadata, its own stamp, and mirrors verdict/exit at the top level", () => {
    const r = build([finalizedFinalize(), finalizedFinalize()]);
    expect(r.schema).toBe(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_SCHEMA);
    expect(r.generatedAt).toBe(NOW);
    expect(r.metadata.finalizeSchema).toBe("pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize/1");
    expect(r.verdict).toBe(r.finalizeIndex.verdict);
    expect(r.exitCode).toBe(r.finalizeIndex.exitCode);
    expect(r.verdict).toBe("indexed");
    expect(r.receipt.category).toBe("worker-release-decision-closeout-governance-finalize-index-trend-finalize-index");
    expect(r.receipt.disclosure).toMatch(/content-free/i);
  });

  it("emits one point per considered bundle, oldest → newest, with the supplied-order positions", () => {
    const r = build([finalizedFinalize(), openFinalize(), blockedFinalize()]);
    expect(r.points.map((p) => p.position)).toEqual([0, 1, 2]);
    expect(r.points.map((p) => p.verdict)).toEqual(["finalized", "finalize-open", "finalize-blocked"]);
    expect(r.points.map((p) => p.state)).toEqual(["usable", "usable", "usable"]);
  });

  it("surfaces a tampered point's claimed verdict but marks it tampered (no trusted facts)", () => {
    const r = build([tamperedFinalize()]);
    expect(r.points[0]!.state).toBe("tampered");
    expect(r.points[0]!.verdict).toBe("finalize-blocked"); // the untrusted claim
    expect(r.points[0]!.receiptVerdict).toBeNull();
    expect(r.verdict).toBe("index-invalid");
  });

  it("carries the latest usable summary (null when none usable)", () => {
    expect(build([finalizedFinalize(), openFinalize()]).latest?.verdict).toBe("finalize-open");
    expect(build([notAFinalize()]).latest).toBeNull();
  });

  it("surfaces the window-cap drop count (never silent)", () => {
    const r = build([finalizedFinalize(), finalizedFinalize(), finalizedFinalize()], { maxFinalizations: 2 });
    expect(r.coverage.finalizationsSupplied).toBe(3);
    expect(r.coverage.finalizationsConsidered).toBe(2);
    expect(r.coverage.truncated).toBe(true);
    expect(r.coverage.droppedOldest).toBe(1);
  });
});

describe("buildNextActions — ordered, deduped, always keeps the index", () => {
  it("a coherent history recommends continue + keep only", () => {
    const r = build([finalizedFinalize()]);
    expect(r.nextActions.map((a) => a.id)).toEqual(["continue-recording-finalization", "keep-finalize-index"]);
  });

  it("an invalid history recommends recovering the untrustworthy record + keep", () => {
    const r = build([tamperedFinalize(), notAFinalize()]);
    const ids = r.nextActions.map((a) => a.id);
    expect(ids).toContain("recover-tampered-finalization");
    expect(ids).toContain("recover-unreadable-finalization");
    expect(ids[ids.length - 1]).toBe("keep-finalize-index");
  });

  it("keep-finalize-index is always the last action", () => {
    for (const objs of [[finalizedFinalize()], [openFinalize()], [blockedFinalize()], [tamperedFinalize()]]) {
      const r = build(objs);
      expect(r.nextActions[r.nextActions.length - 1]!.id).toBe("keep-finalize-index");
    }
  });

  it("buildNextActions dedupes shared checklist ids across reasons", () => {
    // latest-blocked + blocked-in-history both map to review-blocked-finalization → appears once.
    const items = buildNextActions(["latest-blocked", "blocked-in-history"]);
    expect(items.filter((i) => i.id === "review-blocked-finalization")).toHaveLength(1);
  });
});
