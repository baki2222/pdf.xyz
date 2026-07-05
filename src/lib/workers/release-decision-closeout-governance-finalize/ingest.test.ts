import { describe, expect, it } from "vitest";
import { tamperedPlan } from "../release-decision-closeout-governance-action-receipt/fixtures";
import { tamperedTrend } from "../release-decision-closeout-governance-action-plan/fixtures";
import {
  blockedReceipt,
  coherentGovernance,
  coherentIndex,
  coherentPlan,
  coherentTrend,
  completedReceipt,
  contradictoryPlan,
  followupOpenReceipt,
  incompleteReceipt,
  notAReceipt,
  tamperReceiptVerdict,
  tamperedReceipt,
} from "./fixtures";
import { absentRecord, ingestGovernanceFinalizeReceipt, ingestRelated } from "./ingest";

describe("release-decision-closeout-governance-finalize ingest — primary receipt re-validation", () => {
  it("marks a self-consistent completed receipt usable and reduces its bounded facts", () => {
    const r = ingestGovernanceFinalizeReceipt(completedReceipt());
    expect(r.recognized).toBe(true);
    expect(r.usable).toBe(true);
    expect(r.claimedVerdict).toBe("completed");
    expect(r.facts).not.toBeNull();
    expect(r.facts?.receiptVerdict).toBe("completed");
    // The clear-anchored chain the completed receipt records.
    expect(r.facts?.planClass).toBe("clear");
    expect(r.facts?.claimedPlanVerdict).toBe("clear");
    expect(r.facts?.sourceTrendVerdict).toBe("trend-stable");
    expect(r.facts?.receiptSourceState).toBe("usable");
  });

  it("surfaces each usable receipt's own verdict (incomplete / followup-open / blocked)", () => {
    expect(ingestGovernanceFinalizeReceipt(incompleteReceipt()).facts?.receiptVerdict).toBe("incomplete");
    expect(ingestGovernanceFinalizeReceipt(followupOpenReceipt()).facts?.receiptVerdict).toBe("followup-open");
    expect(ingestGovernanceFinalizeReceipt(blockedReceipt()).facts?.receiptVerdict).toBe("blocked");
  });

  it("marks a hand-flipped receipt tampered (recognized, not usable), surfacing the untrusted claim", () => {
    const r = ingestGovernanceFinalizeReceipt(tamperedReceipt());
    expect(r.recognized).toBe(true);
    expect(r.usable).toBe(false);
    expect(r.facts).toBeNull();
    // The claim surfaced is the recorded (flipped) verdict, untrusted.
    expect(r.claimedVerdict).toBe("blocked");
  });

  it("catches a receipt whose top-level headline disagrees with its recorded rollup (a mirror tamper)", () => {
    // Flip only the top-level verdict + exit, leaving the rollup intact → the mirror check fails.
    const clone = JSON.parse(JSON.stringify(completedReceipt())) as Record<string, unknown> & {
      verdict: string;
      exitCode: number;
    };
    clone.verdict = "blocked";
    clone.exitCode = 4;
    const r = ingestGovernanceFinalizeReceipt(clone);
    expect(r.usable).toBe(false);
  });

  it("does not recognize a non-object / wrong-schema / non-receipt input", () => {
    for (const bad of [null, undefined, 42, "x", [], notAReceipt()]) {
      const r = ingestGovernanceFinalizeReceipt(bad);
      expect(r.recognized).toBe(false);
      expect(r.usable).toBe(false);
      expect(r.claimedVerdict).toBeNull();
    }
  });

  it("re-validates every receipt verdict flip as a tamper", () => {
    // Any hand-flip to another valid verdict must break the re-derivation.
    for (const to of ["incomplete", "followup-open", "blocked"] as const) {
      const flipped = tamperReceiptVerdict(completedReceipt(), to, 4);
      expect(ingestGovernanceFinalizeReceipt(flipped).usable, `flip → ${to}`).toBe(false);
    }
  });
});

describe("release-decision-closeout-governance-finalize ingest — related record re-validation (reused boundaries)", () => {
  it("marks a self-consistent related record usable and surfaces its own verdict", () => {
    expect(ingestRelated("plan", coherentPlan())).toMatchObject({ usable: true, verdict: "clear" });
    expect(ingestRelated("trend", coherentTrend())).toMatchObject({ usable: true, verdict: "trend-stable" });
    expect(ingestRelated("index", coherentIndex())).toMatchObject({ usable: true, verdict: "indexed" });
    expect(ingestRelated("governance", coherentGovernance())).toMatchObject({ usable: true, verdict: "closed" });
  });

  it("surfaces a differing usable verdict (a monitor plan is usable but disagrees with the chain)", () => {
    expect(ingestRelated("plan", contradictoryPlan())).toMatchObject({ usable: true, verdict: "monitor" });
  });

  it("marks a hand-flipped related record tampered (recognized, not usable)", () => {
    expect(ingestRelated("plan", tamperedPlan())).toMatchObject({ recognized: true, usable: false });
    expect(ingestRelated("trend", tamperedTrend())).toMatchObject({ recognized: true, usable: false });
  });

  it("does not recognize a wrong-schema related record, and marks it supplied", () => {
    const r = ingestRelated("index", notAReceipt());
    expect(r).toMatchObject({ kind: "index", supplied: true, recognized: false, usable: false, verdict: null });
  });

  it("an absent record is supplied=false and carries no verdict", () => {
    expect(absentRecord("governance")).toEqual({
      kind: "governance",
      supplied: false,
      recognized: false,
      usable: false,
      verdict: null,
    });
  });
});
