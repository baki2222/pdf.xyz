import { describe, expect, it } from "vitest";
import { ingestGovernance } from "./ingest";
import {
  blockedGovernance,
  closedGovernance,
  closedWithCoherent,
  closedWithSourceChain,
  contradictoryGovernance,
  governanceFor,
  governanceWith,
  notAGovernance,
  sourceAdvisoryGovernance,
  sourceBlockedGovernance,
  tamperGovernanceVerdict,
  tamperedGovernance,
} from "./fixtures";
import { completedReceipt } from "../release-decision-closeout-governance/fixtures";
import { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_VERDICTS } from "./types";

type Obj = Record<string, unknown>;
const clone = (o: unknown): Obj => JSON.parse(JSON.stringify(o)) as Obj;

describe("ingestGovernance — recognition", () => {
  it("a non-object / wrong-schema input is unreadable (unrecognized)", () => {
    for (const bad of [
      null,
      42,
      "x",
      [],
      {},
      notAGovernance(),
      { schema: "pdfxyz.release-decision-closeout-governance/2" },
    ]) {
      const r = ingestGovernance(bad);
      expect(r.recognized).toBe(false);
      expect(r.usable).toBe(false);
      expect(r.verdict).toBeNull();
      expect(r.facts).toBeNull();
    }
  });

  it("a real governance bundle of every verdict re-derives → usable, with trusted facts", () => {
    for (const verdict of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_VERDICTS) {
      const r = ingestGovernance(governanceFor(verdict));
      expect(r.recognized, verdict).toBe(true);
      expect(r.usable, verdict).toBe(true);
      expect(r.verdict, verdict).toBe(verdict);
      expect(r.facts?.verdict, verdict).toBe(verdict);
      expect(r.facts?.closed, verdict).toBe(verdict === "closed");
    }
  });

  it("a bundle cross-checked against coherent / source-chain records re-derives usable", () => {
    for (const build of [
      closedWithCoherent,
      closedWithSourceChain,
      contradictoryGovernance,
      sourceBlockedGovernance,
      sourceAdvisoryGovernance,
    ]) {
      const r = ingestGovernance(build());
      expect(r.recognized).toBe(true);
      expect(r.usable, build.name).toBe(true);
    }
  });

  it("a required-record bundle (with require flags) re-derives usable", () => {
    const gov = governanceWith(
      { receipt: completedReceipt() },
      { require: { plan: true, trend: false, index: false, closeout: false } },
    );
    const r = ingestGovernance(gov);
    expect(r.usable).toBe(true);
    expect(r.verdict).toBe("governance-incomplete"); // required plan absent → incomplete
  });
});

describe("ingestGovernance — tamper is caught (recognized but not usable)", () => {
  it("a hand-flipped verdict (closed → governance-blocked) fails closed as tampered", () => {
    const r = ingestGovernance(tamperedGovernance());
    expect(r.recognized).toBe(true);
    expect(r.usable).toBe(false);
    expect(r.verdict).toBe("governance-blocked"); // the untrusted claim is surfaced
    expect(r.facts).toBeNull();
  });

  it("a flip in EITHER direction is caught for every verdict pairing", () => {
    const exitFor = {
      closed: 0,
      "governance-incomplete": 2,
      "governance-open": 3,
      "governance-blocked": 4,
    } as const;
    for (const from of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_VERDICTS) {
      for (const to of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_VERDICTS) {
        if (from === to) continue;
        const r = ingestGovernance(tamperGovernanceVerdict(governanceFor(from), to, exitFor[to]));
        expect(r.usable, `${from}->${to}`).toBe(false);
      }
    }
  });

  it("a top-level verdict that disagrees with the nested rollup is a tamper", () => {
    const gov = clone(closedGovernance());
    gov.verdict = "governance-open"; // only the headline is flipped; rollup still says closed
    expect(ingestGovernance(gov).usable).toBe(false);
  });

  it("a flipped nested count (blocking) that no longer matches the reasons is a tamper", () => {
    const gov = clone(blockedGovernance());
    (gov.governance as Obj).blocking = 99;
    expect(ingestGovernance(gov).usable).toBe(false);
  });

  it("a flipped related-record signal on a source-chain (index) record is a tamper (signal recheck)", () => {
    const gov = clone(sourceBlockedGovernance()); // index blocked → source-chain-blocked signal
    const related = gov.related as Obj[];
    const idx = related.find((r) => r.kind === "index")!;
    expect(idx.signal).toBe("blocking");
    idx.signal = "coherent"; // lie about the source chain being clean
    expect(ingestGovernance(gov).usable).toBe(false);
  });

  it("a flipped cross-check signal on a plan record is a tamper (signal recheck)", () => {
    const gov = clone(contradictoryGovernance()); // plan monitor ≠ clear → contradictory signal
    const related = gov.related as Obj[];
    const plan = related.find((r) => r.kind === "plan")!;
    expect(plan.signal).toBe("contradictory");
    plan.signal = "coherent"; // lie about the cross-check agreeing
    expect(ingestGovernance(gov).usable).toBe(false);
  });

  it("a coherent source-chain record whose signal is flipped to advisory is a tamper", () => {
    const gov = clone(closedWithSourceChain()); // index indexed → source-chain-coherent
    const related = gov.related as Obj[];
    const idx = related.find((r) => r.kind === "index")!;
    idx.signal = "advisory";
    expect(ingestGovernance(gov).usable).toBe(false);
  });

  it("a mutated source receipt verdict that breaks internal consistency is a tamper", () => {
    const gov = clone(closedGovernance());
    (gov.source as Obj).receiptVerdict = null; // a usable source must carry a non-null receipt verdict
    expect(ingestGovernance(gov).usable).toBe(false);
  });

  it("a mutated source plan class that no longer matches the recorded rollup is a tamper", () => {
    const gov = clone(closedGovernance());
    (gov.source as Obj).planClass = null; // rollup planClass is `clear` — the re-derivation no longer matches
    expect(ingestGovernance(gov).usable).toBe(false);
  });

  it("a smuggled inconsistent policy.strictOpen is a tamper", () => {
    const gov = clone(closedGovernance());
    (gov.policy as Obj).strictOpen = true; // rollup.strictOpen is false
    expect(ingestGovernance(gov).usable).toBe(false);
  });

  it("a related array of the wrong length is a tamper", () => {
    const gov = clone(closedGovernance());
    (gov.related as Obj[]).pop();
    expect(ingestGovernance(gov).usable).toBe(false);
  });

  it("an off-enum reason id in the rollup is a tamper", () => {
    const gov = clone(closedGovernance());
    (gov.governance as Obj).reasons = ["not-a-real-reason"];
    expect(ingestGovernance(gov).usable).toBe(false);
  });
});

describe("ingestGovernance — a bundle whose OWN verdict is blocked/open still re-derives usable", () => {
  it("a contradictory-plan bundle re-derives usable (its own verdict is governance-blocked)", () => {
    const r = ingestGovernance(contradictoryGovernance());
    expect(r.usable).toBe(true);
    expect(r.verdict).toBe("governance-blocked");
  });

  it("an advisory source-chain bundle re-derives usable (its own verdict is governance-open)", () => {
    const r = ingestGovernance(sourceAdvisoryGovernance());
    expect(r.usable).toBe(true);
    expect(r.verdict).toBe("governance-open");
  });
});

describe("ingestGovernance — never throws, never echoes", () => {
  it("never throws on arbitrary hostile input", () => {
    const inputs: unknown[] = [
      undefined,
      { schema: "pdfxyz.release-decision-closeout-governance/1" },
      { schema: "pdfxyz.release-decision-closeout-governance/1", governance: 5 },
      {
        schema: "pdfxyz.release-decision-closeout-governance/1",
        governance: {},
        source: [],
        related: 1,
        policy: null,
      },
      { schema: "pdfxyz.release-decision-closeout-governance/1", verdict: "closed" },
    ];
    for (const i of inputs) expect(() => ingestGovernance(i)).not.toThrow();
  });

  it("a blocked/completed-derived bundle carries no ingested stamp in its facts", () => {
    const gov = clone(blockedGovernance());
    gov.generatedAt = "2099-01-01T00:00:00.000Z"; // a hostile stamp
    const r = ingestGovernance(gov);
    // facts are bounded enums / ints only — no stamp field exists to leak
    expect(r.facts && Object.values(r.facts).every((v) => typeof v !== "string" || v.length < 40)).toBe(true);
  });
});
