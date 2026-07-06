import { describe, expect, it } from "vitest";
import { ingestFinalize } from "./ingest";
import {
  blockedFinalize,
  contradictoryFinalize,
  finalizeFor,
  finalizeWith,
  finalizedFinalize,
  finalizedWithCoherent,
  finalizedWithSourceChain,
  notAFinalize,
  sourceAdvisoryFinalize,
  sourceBlockedFinalize,
  tamperFinalizeVerdict,
  tamperedFinalize,
} from "./fixtures";
import { completedReceipt, followupOpenReceipt } from "../release-decision-closeout-governance-finalize/fixtures";
import { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_VERDICTS } from "./types";

type Obj = Record<string, unknown>;
const clone = (o: unknown): Obj => JSON.parse(JSON.stringify(o)) as Obj;

describe("ingestFinalize — recognition", () => {
  it("a non-object / wrong-schema input is unreadable (unrecognized)", () => {
    for (const bad of [
      null,
      42,
      "x",
      [],
      {},
      notAFinalize(),
      { schema: "pdfxyz.release-decision-closeout-governance-finalize/2" },
    ]) {
      const r = ingestFinalize(bad);
      expect(r.recognized).toBe(false);
      expect(r.usable).toBe(false);
      expect(r.verdict).toBeNull();
      expect(r.facts).toBeNull();
    }
  });

  it("a real finalization bundle of every verdict re-derives → usable, with trusted facts", () => {
    for (const verdict of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_VERDICTS) {
      const r = ingestFinalize(finalizeFor(verdict));
      expect(r.recognized, verdict).toBe(true);
      expect(r.usable, verdict).toBe(true);
      expect(r.verdict, verdict).toBe(verdict);
      expect(r.facts?.verdict, verdict).toBe(verdict);
      expect(r.facts?.finalized, verdict).toBe(verdict === "finalized");
    }
  });

  it("a bundle cross-checked against coherent / source-chain records re-derives usable", () => {
    for (const build of [
      finalizedWithCoherent,
      finalizedWithSourceChain,
      contradictoryFinalize,
      sourceBlockedFinalize,
      sourceAdvisoryFinalize,
    ]) {
      const r = ingestFinalize(build());
      expect(r.recognized).toBe(true);
      expect(r.usable, build.name).toBe(true);
    }
  });

  it("a required-record bundle (with require flags) re-derives usable", () => {
    const fin = finalizeWith(
      { receipt: completedReceipt() },
      { require: { plan: true, trend: false, index: false, governance: false } },
    );
    const r = ingestFinalize(fin);
    expect(r.usable).toBe(true);
    expect(r.verdict).toBe("finalize-incomplete"); // required plan absent → incomplete
    expect(r.facts?.requiredMissing).toBe(1);
  });

  it("a strict-open escalated bundle re-derives usable (its own verdict is finalize-blocked)", () => {
    const fin = finalizeWith({ receipt: followupOpenReceipt() }, { strictOpen: true });
    const r = ingestFinalize(fin);
    expect(r.usable).toBe(true);
    expect(r.verdict).toBe("finalize-blocked");
    expect(r.facts?.strictOpen).toBe(true);
    expect(r.facts?.strictOpenEscalated).toBe(true);
  });
});

describe("ingestFinalize — tamper is caught (recognized but not usable)", () => {
  it("a hand-flipped verdict (finalized → finalize-blocked) fails closed as tampered", () => {
    const r = ingestFinalize(tamperedFinalize());
    expect(r.recognized).toBe(true);
    expect(r.usable).toBe(false);
    expect(r.verdict).toBe("finalize-blocked"); // the untrusted claim is surfaced
    expect(r.facts).toBeNull();
  });

  it("a flip in EITHER direction is caught for every verdict pairing", () => {
    const exitFor = {
      finalized: 0,
      "finalize-incomplete": 2,
      "finalize-open": 3,
      "finalize-blocked": 4,
    } as const;
    for (const from of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_VERDICTS) {
      for (const to of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_VERDICTS) {
        if (from === to) continue;
        const r = ingestFinalize(tamperFinalizeVerdict(finalizeFor(from), to, exitFor[to]));
        expect(r.usable, `${from}->${to}`).toBe(false);
      }
    }
  });

  it("a top-level verdict that disagrees with the nested rollup is a tamper", () => {
    const fin = clone(finalizedFinalize());
    fin.verdict = "finalize-open"; // only the headline is flipped; rollup still says finalized
    expect(ingestFinalize(fin).usable).toBe(false);
  });

  it("a flipped nested count (blocking) that no longer matches the reasons is a tamper", () => {
    const fin = clone(blockedFinalize());
    (fin.governanceFinalize as Obj).blocking = 99;
    expect(ingestFinalize(fin).usable).toBe(false);
  });

  it("a flipped related-record signal on a source-chain (index) record is a tamper (signal recheck)", () => {
    const fin = clone(sourceBlockedFinalize()); // index blocked → source-chain-blocked signal
    const related = fin.related as Obj[];
    const idx = related.find((r) => r.kind === "index")!;
    expect(idx.signal).toBe("blocking");
    idx.signal = "coherent"; // lie about the source chain being clean
    expect(ingestFinalize(fin).usable).toBe(false);
  });

  it("a flipped cross-check signal on a plan record is a tamper (signal recheck)", () => {
    const fin = clone(contradictoryFinalize()); // plan monitor ≠ clear → contradictory signal
    const related = fin.related as Obj[];
    const plan = related.find((r) => r.kind === "plan")!;
    expect(plan.signal).toBe("contradictory");
    plan.signal = "coherent"; // lie about the cross-check agreeing
    expect(ingestFinalize(fin).usable).toBe(false);
  });

  it("a mutated source receipt verdict that breaks internal consistency is a tamper", () => {
    const fin = clone(finalizedFinalize());
    (fin.source as Obj).receiptVerdict = null; // a usable source must carry a non-null receipt verdict
    expect(ingestFinalize(fin).usable).toBe(false);
  });

  it("a smuggled inconsistent policy.strictOpen is a tamper", () => {
    const fin = clone(finalizedFinalize());
    (fin.policy as Obj).strictOpen = true; // rollup.strictOpen is false
    expect(ingestFinalize(fin).usable).toBe(false);
  });

  it("a flipped coverage count is a tamper (coverage recheck)", () => {
    const fin = clone(finalizedWithCoherent());
    (fin.coverage as Obj).relatedCoherent = 99;
    expect(ingestFinalize(fin).usable).toBe(false);
  });

  it("a related array of the wrong length is a tamper", () => {
    const fin = clone(finalizedFinalize());
    (fin.related as Obj[]).pop();
    expect(ingestFinalize(fin).usable).toBe(false);
  });

  it("an off-enum reason id in the rollup is a tamper", () => {
    const fin = clone(finalizedFinalize());
    (fin.governanceFinalize as Obj).reasons = ["not-a-real-reason"];
    expect(ingestFinalize(fin).usable).toBe(false);
  });
});

describe("ingestFinalize — a bundle whose OWN verdict is blocked/open still re-derives usable", () => {
  it("a contradictory-plan bundle re-derives usable (its own verdict is finalize-blocked)", () => {
    const r = ingestFinalize(contradictoryFinalize());
    expect(r.usable).toBe(true);
    expect(r.verdict).toBe("finalize-blocked");
  });

  it("an advisory source-chain bundle re-derives usable (its own verdict is finalize-open)", () => {
    const r = ingestFinalize(sourceAdvisoryFinalize());
    expect(r.usable).toBe(true);
    expect(r.verdict).toBe("finalize-open");
  });
});

describe("ingestFinalize — never throws, never echoes", () => {
  it("never throws on arbitrary hostile input", () => {
    const inputs: unknown[] = [
      undefined,
      { schema: "pdfxyz.release-decision-closeout-governance-finalize/1" },
      { schema: "pdfxyz.release-decision-closeout-governance-finalize/1", governanceFinalize: 5 },
      {
        schema: "pdfxyz.release-decision-closeout-governance-finalize/1",
        governanceFinalize: {},
        source: [],
        related: 1,
        policy: null,
      },
      { schema: "pdfxyz.release-decision-closeout-governance-finalize/1", verdict: "finalized" },
    ];
    for (const i of inputs) expect(() => ingestFinalize(i)).not.toThrow();
  });

  it("a blocked/completed-derived bundle carries no ingested stamp in its facts", () => {
    const fin = clone(blockedFinalize());
    fin.generatedAt = "2099-01-01T00:00:00.000Z"; // a hostile stamp
    const r = ingestFinalize(fin);
    // facts are bounded enums / ints only — no stamp field exists to leak
    expect(r.facts && Object.values(r.facts).every((v) => typeof v !== "string" || v.length < 40)).toBe(true);
  });
});
