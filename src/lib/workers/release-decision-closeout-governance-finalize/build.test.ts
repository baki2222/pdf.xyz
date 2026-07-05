import { describe, expect, it } from "vitest";
import {
  buildArchive,
  buildFollowUps,
  buildGovernanceFinalizeMetadata,
  buildGovernanceFinalizeResult,
} from "./build";
import { buildGovernanceFinalizeSource } from "./reduce";
import {
  blockedIndex,
  coherentGovernance,
  coherentPlan,
  coherentTrend,
  completedReceipt,
  followupOpenReceipt,
  ingestGovernanceFinalizeFrom,
  NOW,
} from "./fixtures";
import { ingestGovernanceFinalizeReceipt, UNRECOGNIZED_RECEIPT } from "./ingest";
import type { ReleaseDecisionCloseoutGovernanceFinalizePolicy } from "./types";

const POLICY: ReleaseDecisionCloseoutGovernanceFinalizePolicy = {
  require: { plan: false, trend: false, index: false, governance: false },
  strictOpen: false,
};

describe("release-decision-closeout-governance-finalize build — result composition", () => {
  it("emits the schema, its own stamp, pinned upstream schemas, and mirrored verdict/exit", () => {
    const result = buildGovernanceFinalizeResult(
      NOW,
      ingestGovernanceFinalizeFrom({ receipt: completedReceipt() }),
      POLICY,
    );
    expect(result.schema).toBe("pdfxyz.release-decision-closeout-governance-finalize/1");
    expect(result.generatedAt).toBe(NOW);
    expect(result.verdict).toBe(result.governanceFinalize.verdict);
    expect(result.exitCode).toBe(result.governanceFinalize.exitCode);
    expect(result.metadata).toEqual(buildGovernanceFinalizeMetadata());
    expect(result.metadata.receiptSchema).toBe("pdfxyz.release-decision-closeout-governance-action-receipt/1");
    expect(result.metadata.governanceSchema).toBe("pdfxyz.release-decision-closeout-governance/1");
  });

  it("emits the related checklist in canonical order regardless of supply", () => {
    const result = buildGovernanceFinalizeResult(
      NOW,
      ingestGovernanceFinalizeFrom({
        receipt: completedReceipt(),
        governance: coherentGovernance(),
        plan: coherentPlan(),
        trend: coherentTrend(),
      }),
      POLICY,
    );
    expect(result.related.map((r) => r.kind)).toEqual(["plan", "trend", "index", "governance"]);
    // index was not supplied → absent; the rest are usable + coherent.
    expect(result.related.find((r) => r.kind === "index")?.state).toBe("absent");
    expect(result.related.find((r) => r.kind === "plan")?.signal).toBe("coherent");
  });

  it("is byte-identical for the same inputs (deterministic)", () => {
    const objs = { receipt: completedReceipt(), plan: coherentPlan() };
    const a = JSON.stringify(buildGovernanceFinalizeResult(NOW, ingestGovernanceFinalizeFrom(objs), POLICY));
    const b = JSON.stringify(buildGovernanceFinalizeResult(NOW, ingestGovernanceFinalizeFrom(objs), POLICY));
    expect(a).toBe(b);
  });
});

describe("release-decision-closeout-governance-finalize build — archive + follow-ups", () => {
  it("archives every recognized record plus always this bundle", () => {
    const ingested = ingestGovernanceFinalizeFrom({
      receipt: completedReceipt(),
      plan: coherentPlan(),
      governance: coherentGovernance(),
    });
    const source = buildGovernanceFinalizeSource(ingested.receipt.ingested);
    const archive = buildArchive(source, [
      { kind: "plan", required: false, state: "usable", signal: "coherent", verdict: "clear" },
      { kind: "trend", required: false, state: "absent", signal: "none", verdict: null },
      { kind: "index", required: false, state: "absent", signal: "none", verdict: null },
      { kind: "governance", required: false, state: "usable", signal: "coherent", verdict: "closed" },
    ]);
    expect(archive.items).toEqual([
      "primary-receipt",
      "governance-plan",
      "governance-bundle",
      "finalize-bundle",
    ]);
  });

  it("archives only the bundle when nothing was recognized", () => {
    const source = buildGovernanceFinalizeSource(UNRECOGNIZED_RECEIPT);
    const archive = buildArchive(source, [
      { kind: "plan", required: false, state: "absent", signal: "none", verdict: null },
      { kind: "trend", required: false, state: "absent", signal: "none", verdict: null },
      { kind: "index", required: false, state: "absent", signal: "none", verdict: null },
      { kind: "governance", required: false, state: "absent", signal: "none", verdict: null },
    ]);
    expect(archive.items).toEqual(["finalize-bundle"]);
  });

  it("a clean finalized chain recommends continue-cadence then archive; an open chain recommends resolve then archive", () => {
    const finalized = buildFollowUps(["receipt-completed"]).map((f) => f.id);
    expect(finalized).toEqual(["continue-governance-cadence", "archive-finalize-bundle"]);

    const open = buildFollowUps(["receipt-followup-open"]).map((f) => f.id);
    expect(open).toEqual(["resolve-open-followup", "archive-finalize-bundle"]);
  });

  it("a followup-open receipt yields the resolve-open follow-up in the full result", () => {
    const result = buildGovernanceFinalizeResult(
      NOW,
      {
        receipt: { supplied: true, ingested: ingestGovernanceFinalizeReceipt(followupOpenReceipt()) },
        related: ingestGovernanceFinalizeFrom({ receipt: completedReceipt() }).related,
      },
      POLICY,
    );
    expect(result.followUps.map((f) => f.id)).toContain("resolve-open-followup");
  });

  it("a blocked source chain yields the investigate-blocked-finalization follow-up", () => {
    const result = buildGovernanceFinalizeResult(
      NOW,
      ingestGovernanceFinalizeFrom({ receipt: completedReceipt(), index: blockedIndex() }),
      POLICY,
    );
    expect(result.followUps.map((f) => f.id)).toContain("investigate-blocked-finalization");
  });
});
