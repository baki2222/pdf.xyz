import { describe, expect, it } from "vitest";
import { buildArchive, buildFollowUps, buildGovernanceMetadata, buildGovernanceResult } from "./build";
import { buildGovernanceSource } from "./reduce";
import {
  blockedIndex,
  coherentCloseout,
  coherentPlan,
  coherentTrend,
  completedReceipt,
  followupOpenReceipt,
  ingestGovernanceFrom,
  NOW,
} from "./fixtures";
import {
  ingestCloseoutGovernanceReceipt,
  UNRECOGNIZED_RECEIPT,
} from "./ingest";
import type { ReleaseDecisionCloseoutGovernancePolicy } from "./types";

const POLICY: ReleaseDecisionCloseoutGovernancePolicy = {
  require: { plan: false, trend: false, index: false, closeout: false },
  strictOpen: false,
};

describe("release-decision-closeout-governance build — result composition", () => {
  it("emits the schema, its own stamp, pinned upstream schemas, and mirrored verdict/exit", () => {
    const result = buildGovernanceResult(NOW, ingestGovernanceFrom({ receipt: completedReceipt() }), POLICY);
    expect(result.schema).toBe("pdfxyz.release-decision-closeout-governance/1");
    expect(result.generatedAt).toBe(NOW);
    expect(result.verdict).toBe(result.governance.verdict);
    expect(result.exitCode).toBe(result.governance.exitCode);
    expect(result.metadata).toEqual(buildGovernanceMetadata());
    expect(result.metadata.receiptSchema).toBe("pdfxyz.release-decision-closeout-action-receipt/1");
    expect(result.metadata.closeoutSchema).toBe("pdfxyz.release-decision-closeout/1");
  });

  it("emits the related checklist in canonical order regardless of supply", () => {
    const result = buildGovernanceResult(
      NOW,
      ingestGovernanceFrom({
        receipt: completedReceipt(),
        closeout: coherentCloseout(),
        plan: coherentPlan(),
        trend: coherentTrend(),
      }),
      POLICY,
    );
    expect(result.related.map((r) => r.kind)).toEqual(["plan", "trend", "index", "closeout"]);
    // index was not supplied → absent; the rest are usable + coherent.
    expect(result.related.find((r) => r.kind === "index")?.state).toBe("absent");
    expect(result.related.find((r) => r.kind === "plan")?.signal).toBe("coherent");
  });

  it("is byte-identical for the same inputs (deterministic)", () => {
    const objs = { receipt: completedReceipt(), plan: coherentPlan() };
    const a = JSON.stringify(buildGovernanceResult(NOW, ingestGovernanceFrom(objs), POLICY));
    const b = JSON.stringify(buildGovernanceResult(NOW, ingestGovernanceFrom(objs), POLICY));
    expect(a).toBe(b);
  });
});

describe("release-decision-closeout-governance build — archive + follow-ups", () => {
  it("archives every recognized record plus always this bundle", () => {
    const ingested = ingestGovernanceFrom({
      receipt: completedReceipt(),
      plan: coherentPlan(),
      closeout: coherentCloseout(),
    });
    const source = buildGovernanceSource(ingested.receipt.ingested);
    const archive = buildArchive(source, [
      { kind: "plan", required: false, state: "usable", signal: "coherent", verdict: "clear" },
      { kind: "trend", required: false, state: "absent", signal: "none", verdict: null },
      { kind: "index", required: false, state: "absent", signal: "none", verdict: null },
      { kind: "closeout", required: false, state: "usable", signal: "coherent", verdict: "closed" },
    ]);
    expect(archive.items).toEqual(["primary-receipt", "closeout-plan", "closeout-bundle", "governance-bundle"]);
  });

  it("archives only the bundle when nothing was recognized", () => {
    const source = buildGovernanceSource(UNRECOGNIZED_RECEIPT);
    const archive = buildArchive(source, [
      { kind: "plan", required: false, state: "absent", signal: "none", verdict: null },
      { kind: "trend", required: false, state: "absent", signal: "none", verdict: null },
      { kind: "index", required: false, state: "absent", signal: "none", verdict: null },
      { kind: "closeout", required: false, state: "absent", signal: "none", verdict: null },
    ]);
    expect(archive.items).toEqual(["governance-bundle"]);
  });

  it("a clean closed chain recommends continue-cadence then archive; an open chain recommends resolve then archive", () => {
    const closed = buildFollowUps(["receipt-completed"]).map((f) => f.id);
    expect(closed).toEqual(["continue-governance-cadence", "archive-governance-bundle"]);

    const open = buildFollowUps(["receipt-followup-open"]).map((f) => f.id);
    expect(open).toEqual(["resolve-open-followup", "archive-governance-bundle"]);
  });

  it("a followup-open receipt yields the resolve-open follow-up in the full result", () => {
    const result = buildGovernanceResult(
      NOW,
      { receipt: { supplied: true, ingested: ingestCloseoutGovernanceReceipt(followupOpenReceipt()) }, related: ingestGovernanceFrom({ receipt: completedReceipt() }).related },
      POLICY,
    );
    expect(result.followUps.map((f) => f.id)).toContain("resolve-open-followup");
  });

  it("a blocked source chain yields the investigate-blocked follow-up", () => {
    const result = buildGovernanceResult(
      NOW,
      ingestGovernanceFrom({ receipt: completedReceipt(), index: blockedIndex() }),
      POLICY,
    );
    expect(result.followUps.map((f) => f.id)).toContain("investigate-blocked-governance");
  });
});
