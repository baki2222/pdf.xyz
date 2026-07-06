import { describe, expect, it } from "vitest";
import {
  advisoryPlan,
  advisoryTrend,
  blockedReceipt,
  coherentFinalization,
  coherentIndex,
  coherentPlan,
  coherentTrend,
  completedReceipt,
  incompleteReceipt,
  invalidReceipt,
  notAFinalize,
  notAPlan,
  notATrend,
  notAWindow,
  notAReceipt,
  tamperPlanVerdict,
  tamperReceiptVerdict,
  tamperTrendVerdict,
} from "./fixtures";
import { ingestFinalizeIndexTrendFinalizeReceipt, ingestRelated } from "./ingest";
import { clearPlan } from "../release-decision-closeout-governance-finalize-index-trend-action-receipt/fixtures";

describe("finalize-index-trend-finalize ingest — primary receipt re-validation", () => {
  it("marks a self-consistent receipt usable and reduces its bounded facts", () => {
    const r = ingestFinalizeIndexTrendFinalizeReceipt(completedReceipt());
    expect(r.recognized).toBe(true);
    expect(r.usable).toBe(true);
    expect(r.claimedVerdict).toBe("completed");
    expect(r.facts?.receiptVerdict).toBe("completed");
    expect(r.facts?.planClass).toBe("clear");
    expect(r.facts?.claimedPlanVerdict).toBe("clear");
    expect(r.facts?.sourceTrendVerdict).toBe("stable");
    expect(r.facts?.sourceLatestIndex).toBe("indexed");
  });

  it("surfaces each receipt verdict when usable", () => {
    expect(ingestFinalizeIndexTrendFinalizeReceipt(incompleteReceipt()).facts?.receiptVerdict).toBe("incomplete");
    expect(ingestFinalizeIndexTrendFinalizeReceipt(blockedReceipt()).facts?.receiptVerdict).toBe("blocked");
    expect(ingestFinalizeIndexTrendFinalizeReceipt(invalidReceipt()).facts?.receiptVerdict).toBe("invalid");
  });

  it("an invalid-verdict receipt (null plan class) still re-derives and is usable", () => {
    const r = ingestFinalizeIndexTrendFinalizeReceipt(invalidReceipt());
    expect(r.usable).toBe(true);
    expect(r.facts?.planClass).toBeNull();
    expect(r.facts?.claimedPlanVerdict).toBe("invalid");
  });

  it("an unrecognized / wrong-schema input is unreadable", () => {
    const r = ingestFinalizeIndexTrendFinalizeReceipt(notAReceipt());
    expect(r.recognized).toBe(false);
    expect(r.usable).toBe(false);
    expect(r.claimedVerdict).toBeNull();
    expect(ingestFinalizeIndexTrendFinalizeReceipt(42).recognized).toBe(false);
    expect(ingestFinalizeIndexTrendFinalizeReceipt(null).recognized).toBe(false);
    expect(ingestFinalizeIndexTrendFinalizeReceipt([completedReceipt()]).recognized).toBe(false);
  });

  it("a hand-flipped receipt verdict is a tamper (recognized, not usable) surfacing the untrusted claim", () => {
    const t = tamperReceiptVerdict(completedReceipt(), "blocked");
    const r = ingestFinalizeIndexTrendFinalizeReceipt(t);
    expect(r.recognized).toBe(true);
    expect(r.usable).toBe(false);
    expect(r.claimedVerdict).toBe("blocked");
    expect(r.facts).toBeNull();
  });

  it("a receipt whose top-level headline disagrees with its recorded rollup is a tamper", () => {
    const c = JSON.parse(JSON.stringify(completedReceipt())) as Record<string, unknown> & { verdict: string };
    c.verdict = "incomplete"; // flip ONLY the headline; the nested rollup still says completed
    const r = ingestFinalizeIndexTrendFinalizeReceipt(c);
    expect(r.usable).toBe(false);
  });

  it("a receipt with a smuggled inconsistent policy is a tamper", () => {
    const c = JSON.parse(JSON.stringify(completedReceipt())) as Record<string, unknown> & {
      policy: { strictOpen: boolean };
    };
    c.policy.strictOpen = true; // the recorded rollup was computed with strictOpen=false
    expect(ingestFinalizeIndexTrendFinalizeReceipt(c).usable).toBe(false);
  });
});

describe("finalize-index-trend-finalize ingest — source-chain records", () => {
  it("ingests a coherent plan and captures its cross-check facets", () => {
    const r = ingestRelated("plan", coherentPlan());
    expect(r.usable).toBe(true);
    expect(r.verdict).toBe("clear");
    expect(r.facets?.kind).toBe("plan");
    if (r.facets?.kind === "plan") {
      expect(r.facets.verdict).toBe("clear");
      expect(r.facets.sourceTrendVerdict).toBe("stable");
      expect(r.facets.sourceTrendClass).not.toBeNull();
      expect(r.facets.sourceArcDirection).not.toBeNull();
    }
  });

  it("ingests a coherent trend and captures verdict / class / direction / latest", () => {
    const r = ingestRelated("trend", coherentTrend());
    expect(r.usable).toBe(true);
    expect(r.verdict).toBe("stable");
    if (r.facets?.kind === "trend") {
      expect(r.facets.trendClass).not.toBeNull();
      expect(r.facets.direction).not.toBeNull();
      expect(r.facets.latestIndex).toBe("indexed");
    }
  });

  it("ingests a coherent index + finalization and captures their anchors", () => {
    const idx = ingestRelated("index", coherentIndex());
    expect(idx.usable).toBe(true);
    expect(idx.verdict).toBe("indexed");
    if (idx.facets?.kind === "index") expect(idx.facets.latestFinalization).toBe("finalized");

    const fin = ingestRelated("finalization", coherentFinalization());
    expect(fin.usable).toBe(true);
    expect(fin.verdict).toBe("finalized");
    if (fin.facets?.kind === "finalization") expect(fin.facets.verdict).toBe("finalized");
  });

  it("an advisory plan / trend is usable with its own advisory verdict", () => {
    expect(ingestRelated("plan", advisoryPlan()).verdict).toBe("monitor");
    expect(ingestRelated("trend", advisoryTrend()).verdict).toBe("degrading");
  });

  it("a wrong-schema record is unreadable; a hand-flipped record is tampered", () => {
    expect(ingestRelated("plan", notAPlan())).toMatchObject({ recognized: false, usable: false });
    expect(ingestRelated("trend", notATrend())).toMatchObject({ recognized: false, usable: false });
    expect(ingestRelated("index", notAWindow())).toMatchObject({ recognized: false, usable: false });
    expect(ingestRelated("finalization", notAFinalize())).toMatchObject({ recognized: false, usable: false });

    const tamperedP = tamperPlanVerdict(clearPlan(), "monitor");
    expect(ingestRelated("plan", tamperedP)).toMatchObject({ recognized: true, usable: false, facets: null });
    const tamperedT = tamperTrendVerdict(coherentTrend() as never, "watch");
    expect(ingestRelated("trend", tamperedT)).toMatchObject({ recognized: true, usable: false });
  });
});
