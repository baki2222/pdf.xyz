import { describe, expect, it } from "vitest";
import { absentRecord, ingestRelated, ingestReceipt, type IngestedRelatedRecord } from "./ingest";
import {
  blockedReceipt,
  coherentIndex,
  coherentPlan,
  coherentTrend,
  completedReceipt,
  incompleteReceipt,
  invalidReceipt,
  notAPlan,
  notAReceipt,
  notATrend,
  notAWindow,
  openReceipt,
  tamperReceiptVerdict,
  tamperedPlan,
  tamperedTrend,
  tamperedWindow,
} from "./fixtures";

/** JSON round-trip a built result into the plain object the CLI would ingest. */
function doc(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

const COMPLETED = completedReceipt();

describe("ingestReceipt — re-validate the primary receipt against itself", () => {
  it("accepts a real, self-consistent receipt and reduces its bounded facts", () => {
    const ing = ingestReceipt(doc(COMPLETED));
    expect(ing.recognized).toBe(true);
    expect(ing.usable).toBe(true);
    expect(ing.claimedVerdict).toBe("completed");
    expect(ing.facts).toMatchObject({
      receiptVerdict: "completed",
      planClass: "clear",
      claimedPlanVerdict: "clear",
      sourceTrendVerdict: "stable",
      acksRequired: 1,
      acksSatisfied: 1,
      acksMissing: 0,
    });
  });

  it("marks a non-object / wrong-schema input unrecognized (⇒ unreadable)", () => {
    expect(ingestReceipt(notAReceipt())).toMatchObject({ recognized: false, usable: false });
    expect(ingestReceipt(null)).toMatchObject({ recognized: false, usable: false });
    expect(ingestReceipt(42)).toMatchObject({ recognized: false, usable: false });
    expect(ingestReceipt([1, 2])).toMatchObject({ recognized: false, usable: false });
  });

  it("catches a hand-flipped verdict as a tamper (recognized but not usable)", () => {
    const tampered = tamperReceiptVerdict(COMPLETED, "blocked", 4);
    const ing = ingestReceipt(tampered);
    expect(ing.recognized).toBe(true);
    expect(ing.usable).toBe(false);
    expect(ing.claimedVerdict).toBe("blocked"); // the untrusted CLAIM surfaced
    expect(ing.facts).toBeNull();
  });

  it("catches a top-level verdict that disagrees with the recorded rollup (headline flip)", () => {
    const clone = doc(COMPLETED) as Record<string, unknown> & { verdict: string };
    clone.verdict = "blocked"; // headline only; the nested actionReceipt still says completed
    expect(ingestReceipt(clone)).toMatchObject({ recognized: true, usable: false });
  });

  it("catches a flipped acknowledgement policy that no longer re-derives the rollup", () => {
    const clone = doc(COMPLETED) as Record<string, unknown> & { policy: { ack: { plan: boolean } } };
    clone.policy.ack.plan = false; // was reviewed; flipping it would change the re-derived verdict
    expect(ingestReceipt(clone)).toMatchObject({ recognized: true, usable: false });
  });

  it("catches a source block whose plan class disagrees with its plan verdict", () => {
    const clone = doc(COMPLETED) as Record<string, unknown> & { source: { planClass: string } };
    clone.source.planClass = "block"; // clear plan verdict but a block class → inconsistent source
    expect(ingestReceipt(clone)).toMatchObject({ recognized: true, usable: false });
  });

  it("catches a missing actionReceipt rollup", () => {
    const clone = doc(COMPLETED) as Record<string, unknown>;
    delete clone.actionReceipt;
    expect(ingestReceipt(clone)).toMatchObject({ recognized: true, usable: false });
  });

  it("preserves the receipt's own verdict for each usable receipt class", () => {
    expect(ingestReceipt(doc(incompleteReceipt())).facts?.receiptVerdict).toBe("incomplete");
    expect(ingestReceipt(doc(openReceipt())).facts?.receiptVerdict).toBe("followup-open");
    expect(ingestReceipt(doc(blockedReceipt())).facts?.receiptVerdict).toBe("blocked");
    // A receipt whose OWN verdict is `invalid` is still a self-consistent (usable) receipt document.
    expect(ingestReceipt(doc(invalidReceipt())).facts?.receiptVerdict).toBe("invalid");
  });
});

describe("ingestRelated — reuse each phase's own trust boundary", () => {
  const cases = [
    { kind: "plan" as const, usable: coherentPlan, tampered: tamperedPlan, decoy: notAPlan, expectVerdict: "clear" },
    { kind: "trend" as const, usable: coherentTrend, tampered: tamperedTrend, decoy: notATrend, expectVerdict: "stable" },
    { kind: "index" as const, usable: coherentIndex, tampered: tamperedWindow, decoy: notAWindow, expectVerdict: "indexed" },
  ];

  for (const c of cases) {
    it(`${c.kind}: usable record surfaces its bounded verdict, tampered→tampered, decoy→unreadable`, () => {
      const ok = ingestRelated(c.kind, doc(c.usable()));
      expect(ok.state).toBe("usable");
      expect(ok.facts?.verdict).toBe(c.expectVerdict);

      expect(ingestRelated(c.kind, c.tampered()).state).toBe("tampered");
      expect(ingestRelated(c.kind, c.decoy()).state).toBe("unreadable");
    });
  }

  it("a plan record carries the plan facets the cross-check needs", () => {
    const rec = ingestRelated("plan", doc(coherentPlan()));
    expect(rec.facts).toMatchObject({
      verdict: "clear",
      planClass: "clear",
      planUrgency: "routine",
      planActionClass: "none",
      sourceTrendVerdict: "stable",
    });
  });

  it("absentRecord is absent with no facts", () => {
    const rec: IngestedRelatedRecord = absentRecord("index");
    expect(rec).toEqual({ kind: "index", state: "absent", facts: null });
  });
});
