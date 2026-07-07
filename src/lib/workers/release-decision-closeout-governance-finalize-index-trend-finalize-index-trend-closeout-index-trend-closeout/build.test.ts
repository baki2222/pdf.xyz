import { describe, expect, it } from "vitest";
import { buildCloseoutMetadata } from "./build";
import {
  NOW,
  blockedReceipt,
  coherentIndex,
  coherentPlan,
  completedReceipt,
  makeCloseout,
  notAReceipt,
} from "./fixtures";
import { releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutExitCode } from "./types";

const completed = completedReceipt();

describe("release-decision-closeout-…-finalize-index-trend-closeout build — result assembly", () => {
  it("assembles a stable, content-free closed result over a completed receipt + coherent related", () => {
    const result = makeCloseout(completed, { plan: coherentPlan(), index: coherentIndex() });
    expect(result.schema).toBe(
      "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout/1",
    );
    expect(result.generatedAt).toBe(NOW);
    expect(result.metadata.receiptSchema).toBe(
      "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-receipt/1",
    );
    expect(result.metadata.planSchema).toBe(
      "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-action-plan/1",
    );
    expect(result.verdict).toBe("closed");
    expect(result.exitCode).toBe(0);
    expect(result.coverage.verdict).toBe("closed");
    expect(result.coverage.closed).toBe(true);
    expect(result.primaryReceipt.state).toBe("usable");
    expect(result.primaryReceipt.receiptVerdict).toBe("completed");
    expect(result.primaryReceipt.planClass).toBe("clear");
    // The canonical trailing next-actions are always present (archive + record-out-of-band).
    expect(result.nextActions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["archive-closeout", "record-governance-out-of-band"]),
    );
    expect(releaseDecisionCloseoutGovernanceFinalizeIndexTrendFinalizeIndexTrendCloseoutIndexTrendCloseoutExitCode(result)).toBe(0);
    expect(result.caveats.length).toBeGreaterThan(0);
  });

  it("flattens a content-free receipt with the closeout coverage counts", () => {
    const { receipt } = makeCloseout(completed, { plan: coherentPlan() });
    expect(receipt.category).toBe(
      "worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout",
    );
    expect(receipt.policyId).toBe(
      "pdfxyz-worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout",
    );
    expect(receipt.at).toBe(NOW);
    expect(receipt.verdict).toBe("closed");
    expect(receipt.exitCode).toBe(0);
    expect(receipt.receiptState).toBe("usable");
    expect(receipt.receiptVerdict).toBe("completed");
    expect(receipt.planClass).toBe("clear");
    expect(receipt.relatedSupplied).toBe(1);
    expect(receipt.relatedCoherent).toBe(1);
    expect(receipt.strictOpenEscalated).toBe(false);
    expect(receipt.disclosure).toMatch(/content-free operational closeout/i);
  });

  it("records the primary-receipt summary for a not-usable receipt without inventing facts", () => {
    const result = makeCloseout(notAReceipt());
    expect(result.verdict).toBe("invalid");
    expect(result.primaryReceipt).toMatchObject({
      state: "unreadable",
      receiptVerdict: null,
      planClass: null,
      claimedPlanVerdict: null,
      sourceTrendVerdict: null,
      sourceLatestIndex: null,
      planUrgency: null,
      planActionClass: null,
      blockingActions: 0,
      advisoryActions: 0,
      planStrictWatch: false,
      planRequireClean: false,
      acksRequired: 0,
      acksSatisfied: 0,
      acksMissing: 0,
      receiptStrictOpen: false,
    });
  });

  it("folds the source-chain posture from the supplied finalization-index window", () => {
    const result = makeCloseout(completed, { index: coherentIndex() });
    expect(result.sourceChain).toMatchObject({
      receiptTrendVerdict: "stable",
      indexState: "usable",
      indexVerdict: "indexed",
      posture: "coherent",
    });
  });

  it("a blocked receipt composes a blocked closeout that surfaces the receipt's own verdict", () => {
    const result = makeCloseout(blockedReceipt());
    expect(result.verdict).toBe("blocked");
    expect(result.exitCode).toBe(4);
    expect(result.primaryReceipt.receiptVerdict).toBe("blocked");
    expect(result.coverage.reasons).toContain("receipt-blocked");
  });

  it("buildCloseoutMetadata pins the policy id and the trend / index upstream schemas", () => {
    const m = buildCloseoutMetadata();
    expect(m.policyId).toBe(
      "pdfxyz-worker-release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout",
    );
    expect(m.trendSchema).toBe(
      "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend/1",
    );
    expect(m.indexSchema).toBe("pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index/1");
  });
});
