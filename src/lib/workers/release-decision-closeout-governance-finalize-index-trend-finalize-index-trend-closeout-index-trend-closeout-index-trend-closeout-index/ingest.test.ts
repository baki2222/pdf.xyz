import { describe, expect, it } from "vitest";
import { ingestCloseout } from "./ingest";
import {
  blockedCloseout,
  closeoutFor,
  closeoutWith,
  closeoutPolicyWith,
  closedCloseout,
  closedWithCoherent,
  closedWithSourceChain,
  contradictoryCloseout,
  completedReceipt,
  openReceipt,
  notACloseout,
  sourceAdvisoryCloseout,
  sourceBlockedCloseout,
  tamperCloseoutVerdict,
  tamperedCloseout,
} from "./fixtures";
import { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_VERDICTS } from "./types";

type Obj = Record<string, unknown>;
const clone = (o: unknown): Obj => JSON.parse(JSON.stringify(o)) as Obj;

const EXIT_FOR = { closed: 0, incomplete: 2, open: 3, blocked: 4, invalid: 4 } as const;

describe("ingestCloseout — recognition", () => {
  it("a non-object / wrong-schema input is unreadable (unrecognized)", () => {
    for (const bad of [
      null,
      42,
      "x",
      [],
      {},
      notACloseout(),
      { schema: "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/2" },
    ]) {
      const r = ingestCloseout(bad);
      expect(r.recognized).toBe(false);
      expect(r.usable).toBe(false);
      expect(r.verdict).toBeNull();
      expect(r.facts).toBeNull();
    }
  });

  it(
    "a real closeout record of every verdict re-derives → usable, with trusted facts",
    () => {
      for (const verdict of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_VERDICTS) {
        const r = ingestCloseout(closeoutFor(verdict));
        expect(r.recognized, verdict).toBe(true);
        expect(r.usable, verdict).toBe(true);
        expect(r.verdict, verdict).toBe(verdict);
        expect(r.facts?.verdict, verdict).toBe(verdict);
        expect(r.facts?.closed, verdict).toBe(verdict === "closed");
      }
    },
    20_000,
  );

  it("a record cross-checked against coherent / source-chain records re-derives usable", () => {
    for (const build of [
      closedWithCoherent,
      closedWithSourceChain,
      contradictoryCloseout,
      sourceBlockedCloseout,
      sourceAdvisoryCloseout,
    ]) {
      const r = ingestCloseout(build());
      expect(r.recognized).toBe(true);
      expect(r.usable, build.name).toBe(true);
    }
  }, 20_000);

  it("a required-record closeout (with a require flag) re-derives usable", () => {
    const c = closeoutWith(completedReceipt(), {}, closeoutPolicyWith({ plan: true }));
    const r = ingestCloseout(c);
    expect(r.usable).toBe(true);
    expect(r.verdict).toBe("incomplete"); // required plan absent → incomplete
    expect(r.facts?.requiredMissing).toBe(1);
  });

  it("a strict-open escalated closeout re-derives usable (its own verdict is blocked)", () => {
    // An open primary receipt under --strict-open escalates open → blocked.
    const c = closeoutWith(openReceipt(), {}, closeoutPolicyWith({}, true));
    const r = ingestCloseout(c);
    expect(r.usable).toBe(true);
    expect(r.verdict).toBe("blocked");
    expect(r.facts?.strictOpen).toBe(true);
    expect(r.facts?.strictOpenEscalated).toBe(true);
  });
});

describe("ingestCloseout — tamper is caught (recognized but not usable)", () => {
  it("a hand-flipped verdict (closed → blocked) fails closed as tampered", () => {
    const r = ingestCloseout(tamperedCloseout());
    expect(r.recognized).toBe(true);
    expect(r.usable).toBe(false);
    expect(r.verdict).toBe("blocked"); // the untrusted claim is surfaced
    expect(r.facts).toBeNull();
  });

  it("a flip in EITHER direction is caught for every verdict pairing", () => {
    for (const from of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_VERDICTS) {
      for (const to of RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_TREND_FINALIZE_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_INDEX_TREND_CLOSEOUT_VERDICTS) {
        if (from === to) continue;
        const r = ingestCloseout(tamperCloseoutVerdict(closeoutFor(from), to, EXIT_FOR[to]));
        expect(r.usable, `${from}->${to}`).toBe(false);
      }
    }
  }, 20_000);

  it("a top-level verdict that disagrees with the nested coverage rollup is a tamper", () => {
    const c = clone(closedCloseout());
    c.verdict = "open"; // only the headline is flipped; coverage still says closed
    expect(ingestCloseout(c).usable).toBe(false);
  });

  it("a flipped nested count (blocking) that no longer matches the reasons is a tamper", () => {
    const c = clone(blockedCloseout());
    (c.coverage as Obj).blocking = 99;
    expect(ingestCloseout(c).usable).toBe(false);
  });

  it("a flipped related-record cross-check signal on a trend record is a tamper (signal recheck)", () => {
    const c = clone(sourceBlockedCloseout()); // contradictory trend → contradictory cross-check signal
    const related = c.related as Obj[];
    const t = related.find((r) => r.kind === "trend")!;
    expect(t.signal).toBe("contradictory");
    t.signal = "coherent"; // lie about the cross-check agreeing
    expect(ingestCloseout(c).usable).toBe(false);
  });

  it("a flipped cross-check signal on a plan record is a tamper (signal recheck)", () => {
    const c = clone(contradictoryCloseout()); // block-release plan ≠ clear → contradictory signal
    const related = c.related as Obj[];
    const plan = related.find((r) => r.kind === "plan")!;
    expect(plan.signal).toBe("contradictory");
    plan.signal = "coherent"; // lie about the cross-check agreeing
    expect(ingestCloseout(c).usable).toBe(false);
  });

  it("a mutated primary-receipt verdict that breaks internal consistency is a tamper", () => {
    const c = clone(closedCloseout());
    (c.primaryReceipt as Obj).receiptVerdict = null; // a usable receipt must carry a non-null verdict
    expect(ingestCloseout(c).usable).toBe(false);
  });

  it("a smuggled inconsistent policy.strictOpen is a tamper", () => {
    const c = clone(closedCloseout());
    (c.policy as Obj).strictOpen = true; // coverage.strictOpen is false
    expect(ingestCloseout(c).usable).toBe(false);
  });

  it("a flipped sourceChain anchor is a tamper (source-chain recheck)", () => {
    const c = clone(sourceBlockedCloseout());
    (c.sourceChain as Obj).receiptTrendVerdict = null; // lie: the recorded source anchor no longer matches the receipt
    expect(ingestCloseout(c).usable).toBe(false);
  });

  it("a related array of the wrong length is a tamper", () => {
    const c = clone(closedCloseout());
    (c.related as Obj[]).pop();
    expect(ingestCloseout(c).usable).toBe(false);
  });

  it("an off-enum reason id in the coverage rollup is a tamper", () => {
    const c = clone(closedCloseout());
    (c.coverage as Obj).reasons = ["not-a-real-reason"];
    expect(ingestCloseout(c).usable).toBe(false);
  });
});

describe("ingestCloseout — a record whose OWN verdict is blocked/open/invalid still re-derives usable", () => {
  it("a contradictory-plan record re-derives usable (its own verdict is invalid)", () => {
    const r = ingestCloseout(contradictoryCloseout());
    expect(r.usable).toBe(true);
    expect(r.verdict).toBe("invalid");
  });

  it("an advisory source-chain record re-derives usable (its own verdict is open)", () => {
    const r = ingestCloseout(sourceAdvisoryCloseout());
    expect(r.usable).toBe(true);
    expect(r.verdict).toBe("open");
  });

  it("an invalid-posture record (usable, own verdict invalid) re-derives usable", () => {
    const r = ingestCloseout(closeoutFor("invalid"));
    expect(r.usable).toBe(true);
    expect(r.verdict).toBe("invalid");
  });
});

describe("ingestCloseout — never throws, never echoes", () => {
  it("never throws on arbitrary hostile input", () => {
    const inputs: unknown[] = [
      undefined,
      { schema: "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/1" },
      {
        schema: "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/1",
        coverage: 5,
      },
      {
        schema: "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/1",
        coverage: {},
        primaryReceipt: [],
        related: 1,
        policy: null,
        sourceChain: 3,
      },
      {
        schema: "pdfxyz.release-decision-closeout-governance-finalize-index-trend-finalize-index-trend-closeout-index-trend-closeout-index-trend-closeout/1",
        verdict: "closed",
      },
    ];
    for (const i of inputs) expect(() => ingestCloseout(i)).not.toThrow();
  });

  it("a blocked/closed-derived record carries no ingested stamp in its facts", () => {
    const c = clone(blockedCloseout());
    c.generatedAt = "2099-01-01T00:00:00.000Z"; // a hostile stamp
    const r = ingestCloseout(c);
    // facts are bounded enums / ints only — no stamp field exists to leak
    expect(r.facts && Object.values(r.facts).every((v) => typeof v !== "string" || v.length < 40)).toBe(true);
  });
});
