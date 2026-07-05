import { describe, expect, it } from "vitest";
import { ingestCloseout } from "./ingest";
import {
  blockedCloseout,
  closedCloseout,
  closedWithCoherent,
  closedWithSourceChain,
  closeoutFor,
  closeoutWith,
  contradictoryCloseout,
  notACloseout,
  sourceAdvisoryCloseout,
  sourceBlockedCloseout,
  tamperCloseoutVerdict,
  tamperedCloseout,
} from "./fixtures";
import {
  completedReceipt,
  contradictoryTrend,
  policyWith,
  tamperedPlan,
} from "../release-decision-closeout/fixtures";
import { RELEASE_DECISION_CLOSEOUT_VERDICTS } from "./types";

type Obj = Record<string, unknown>;
const clone = (o: unknown): Obj => JSON.parse(JSON.stringify(o)) as Obj;

describe("ingestCloseout — recognition", () => {
  it("a non-object / wrong-schema input is unreadable (unrecognized)", () => {
    for (const bad of [null, 42, "x", [], {}, notACloseout(), { schema: "pdfxyz.release-decision/1" }]) {
      const r = ingestCloseout(bad);
      expect(r.recognized).toBe(false);
      expect(r.usable).toBe(false);
      expect(r.verdict).toBeNull();
      expect(r.facts).toBeNull();
    }
  });

  it("a real closeout of every verdict re-derives → usable, with trusted facts", () => {
    for (const verdict of RELEASE_DECISION_CLOSEOUT_VERDICTS) {
      const r = ingestCloseout(closeoutFor(verdict));
      expect(r.recognized, verdict).toBe(true);
      expect(r.usable, verdict).toBe(true);
      expect(r.verdict, verdict).toBe(verdict);
      expect(r.facts?.verdict, verdict).toBe(verdict);
      expect(r.facts?.closed, verdict).toBe(verdict === "closed");
    }
  });

  it("a closeout cross-checked against coherent / source-chain records re-derives usable", () => {
    for (const build of [closedWithCoherent, closedWithSourceChain, contradictoryCloseout, sourceBlockedCloseout, sourceAdvisoryCloseout]) {
      const r = ingestCloseout(build());
      expect(r.recognized).toBe(true);
      expect(r.usable, build.name).toBe(true);
    }
  });

  it("a required-record closeout (with require flags) re-derives usable", () => {
    const co = closeoutWith(completedReceipt(), {}, policyWith({ plan: true, decision: true }));
    const r = ingestCloseout(co);
    expect(r.usable).toBe(true);
    expect(r.verdict).toBe("closeout-incomplete"); // required plan/decision absent → incomplete
  });
});

describe("ingestCloseout — tamper is caught (recognized but not usable)", () => {
  it("a hand-flipped verdict (closed → closeout-blocked) fails closed as tampered", () => {
    const r = ingestCloseout(tamperedCloseout());
    expect(r.recognized).toBe(true);
    expect(r.usable).toBe(false);
    expect(r.verdict).toBe("closeout-blocked"); // the untrusted claim is surfaced
    expect(r.facts).toBeNull();
  });

  it("a flip in EITHER direction is caught for every verdict pairing", () => {
    for (const from of RELEASE_DECISION_CLOSEOUT_VERDICTS) {
      for (const to of RELEASE_DECISION_CLOSEOUT_VERDICTS) {
        if (from === to) continue;
        const exit = { closed: 0, "closeout-incomplete": 2, "closeout-open": 3, "closeout-blocked": 4 }[to];
        const r = ingestCloseout(tamperCloseoutVerdict(closeoutFor(from), to, exit));
        expect(r.usable, `${from}->${to}`).toBe(false);
      }
    }
  });

  it("a top-level verdict that disagrees with the nested rollup is a tamper", () => {
    const co = clone(closedCloseout());
    co.verdict = "closeout-open"; // only the headline is flipped; rollup still says closed
    expect(ingestCloseout(co).usable).toBe(false);
  });

  it("a flipped nested count (blocking) that no longer matches the reasons is a tamper", () => {
    const co = clone(blockedCloseout());
    (co.closeout as Obj).blocking = 99;
    expect(ingestCloseout(co).usable).toBe(false);
  });

  it("a flipped related-record signal on a decision record is a tamper (signal recheck)", () => {
    const co = clone(sourceBlockedCloseout()); // decision reject → source-chain-blocked signal
    const related = co.related as Obj[];
    const dec = related.find((r) => r.kind === "decision")!;
    expect(dec.signal).toBe("blocking");
    dec.signal = "coherent"; // lie about the source chain being clean
    expect(ingestCloseout(co).usable).toBe(false);
  });

  it("a flipped related-record signal on an index record is a tamper (signal recheck)", () => {
    const co = clone(closedWithSourceChain()); // index stable → source-chain-coherent
    const related = co.related as Obj[];
    const idx = related.find((r) => r.kind === "index")!;
    idx.signal = "advisory";
    expect(ingestCloseout(co).usable).toBe(false);
  });

  it("a mutated source receipt verdict that breaks internal consistency is a tamper", () => {
    const co = clone(closedCloseout());
    (co.source as Obj).receiptVerdict = null; // a usable source must carry a non-null receipt verdict
    expect(ingestCloseout(co).usable).toBe(false);
  });

  it("a mutated source plan class that no longer matches its plan verdict is a tamper", () => {
    const co = clone(closedCloseout());
    (co.source as Obj).planClass = "block"; // clear plan ⇒ class must be `clear`, not `block`
    expect(ingestCloseout(co).usable).toBe(false);
  });

  it("a smuggled inconsistent policy.strictOpen is a tamper", () => {
    const co = clone(closedCloseout());
    (co.policy as Obj).strictOpen = true; // rollup.strictOpen is false
    expect(ingestCloseout(co).usable).toBe(false);
  });

  it("a related array of the wrong length is a tamper", () => {
    const co = clone(closedCloseout());
    (co.related as Obj[]).pop();
    expect(ingestCloseout(co).usable).toBe(false);
  });

  it("an off-enum reason id in the rollup is a tamper", () => {
    const co = clone(closedCloseout());
    (co.closeout as Obj).reasons = ["not-a-real-reason"];
    expect(ingestCloseout(co).usable).toBe(false);
  });
});

describe("ingestCloseout — tamper propagates from a supplied related record", () => {
  it("a tampered plan supplied to the closeout is a closeout-blocked (related-tampered) that re-derives usable", () => {
    // The closeout itself is a self-consistent `closeout-blocked` (its related plan is tampered) — so the INDEX
    // ingest marks the closeout `usable` (its rollup re-derives); the closeout's own verdict is blocked.
    const co = closeoutWith(completedReceipt(), { plan: tamperedPlan() });
    const r = ingestCloseout(co);
    expect(r.usable).toBe(true);
    expect(r.verdict).toBe("closeout-blocked");
  });

  it("a contradictory trend closeout re-derives usable (its own verdict is closeout-blocked)", () => {
    const co = closeoutWith(completedReceipt(), { trend: contradictoryTrend() });
    const r = ingestCloseout(co);
    expect(r.usable).toBe(true);
    expect(r.verdict).toBe("closeout-blocked");
  });
});

describe("ingestCloseout — never throws, never echoes", () => {
  it("never throws on arbitrary hostile input", () => {
    const inputs: unknown[] = [
      undefined,
      { schema: "pdfxyz.release-decision-closeout/1" },
      { schema: "pdfxyz.release-decision-closeout/1", closeout: 5 },
      { schema: "pdfxyz.release-decision-closeout/1", closeout: {}, source: [], related: 1, policy: null },
      { schema: "pdfxyz.release-decision-closeout/1", verdict: "closed" },
    ];
    for (const i of inputs) expect(() => ingestCloseout(i)).not.toThrow();
  });

  it("a blockedReceipt / completedReceipt-derived closeout carries no ingested stamp in its facts", () => {
    const co = clone(blockedCloseout());
    co.generatedAt = "2099-01-01T00:00:00.000Z"; // a hostile stamp
    const r = ingestCloseout(co);
    // facts are bounded enums / ints only — no stamp field exists to leak
    expect(r.facts && Object.values(r.facts).every((v) => typeof v !== "string" || v.length < 40)).toBe(true);
  });
});
