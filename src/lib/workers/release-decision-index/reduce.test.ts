import { describe, expect, it } from "vitest";
import { applyWindow, deriveTrendClass, reduceIndex } from "./reduce";
import {
  followupDecision,
  holdDecision,
  ingestRecordsFrom,
  insufficientDecision,
  invalidDecision,
  notADecision,
  proceedDecision,
  rejectDecision,
  tamperedDecision,
} from "./fixtures";
import { RELEASE_DECISION_DECISIONS } from "./types";

const reduced = (objs: readonly unknown[], maxRecords = 100) =>
  reduceIndex(ingestRecordsFrom(objs), maxRecords);

describe("applyWindow — the --max-records cap", () => {
  it("keeps the newest N and surfaces how many older were dropped", () => {
    const list = ingestRecordsFrom([proceedDecision(), proceedDecision(), proceedDecision()]);
    const w = applyWindow(list, 2);
    expect(w.considered).toHaveLength(2);
    expect(w.recordsSupplied).toBe(3);
    expect(w.truncated).toBe(true);
    expect(w.droppedOldest).toBe(1);
  });

  it("keeps everything when the cap is not exceeded", () => {
    const list = ingestRecordsFrom([proceedDecision(), proceedDecision()]);
    const w = applyWindow(list, 100);
    expect(w.considered).toHaveLength(2);
    expect(w.truncated).toBe(false);
    expect(w.droppedOldest).toBe(0);
  });
});

describe("reduceIndex — ledger summary + points", () => {
  it("counts usable decisions, unreadable, and tampered records", () => {
    const r = reduced([proceedDecision(), followupDecision(), notADecision(), tamperedDecision()]);
    expect(r.ledger.recordsSupplied).toBe(4);
    expect(r.ledger.recordsConsidered).toBe(4);
    expect(r.ledger.recordsUsable).toBe(2);
    expect(r.ledger.recordsUnreadable).toBe(1);
    expect(r.ledger.recordsTampered).toBe(1);
    expect(r.ledger.decisionCounts.proceed).toBe(1);
    expect(r.ledger.decisionCounts["proceed-with-followup"]).toBe(1);
  });

  it("all six decision keys are always present (zeroed)", () => {
    const r = reduced([proceedDecision()]);
    for (const d of RELEASE_DECISION_DECISIONS) expect(r.ledger.decisionCounts).toHaveProperty(d);
  });

  it("tallies the cross-check source posture over usable records", () => {
    const r = reduced([proceedDecision(), invalidDecision()]); // match + mismatch
    expect(r.ledger.crossCheckCounts.match).toBe(1);
    expect(r.ledger.crossCheckCounts.mismatch).toBe(1);
    expect(r.ledger.crossCheckCounts.unknown).toBe(0);
  });

  it("records the newest + oldest usable decision (coarse ordinal, not a timestamp)", () => {
    const r = reduced([proceedDecision(), rejectDecision()]);
    expect(r.ledger.oldest).toBe("proceed");
    expect(r.ledger.newest).toBe("reject");
  });

  it("newest/oldest are null when no record is usable", () => {
    const r = reduced([notADecision(), tamperedDecision()]);
    expect(r.ledger.newest).toBeNull();
    expect(r.ledger.oldest).toBeNull();
  });

  it("a tampered point surfaces its claimed decision but no trusted severity/cross-check", () => {
    const r = reduced([tamperedDecision()]);
    const p = r.points[0]!;
    expect(p.state).toBe("tampered");
    expect(p.decision).toBe("reject"); // the untrusted claim (tamperedDecision flips proceed→reject)
    expect(p.severity).toBeNull();
    expect(p.crossCheck).toBeNull();
  });
});

describe("deriveTrendClass — worst-present classification", () => {
  const zero = () => {
    const c = {} as Record<(typeof RELEASE_DECISION_DECISIONS)[number], number>;
    for (const d of RELEASE_DECISION_DECISIONS) c[d] = 0;
    return c;
  };

  it("invalid-input dominates everything", () => {
    const c = zero();
    c.reject = 1;
    expect(deriveTrendClass(1, 1, c)).toBe("invalid-input");
  });

  it("rejection-present covers reject and invalid decisions", () => {
    const c = zero();
    c.reject = 1;
    expect(deriveTrendClass(1, 0, c)).toBe("rejection-present");
    const d = zero();
    d.invalid = 1;
    expect(deriveTrendClass(1, 0, d)).toBe("rejection-present");
  });

  it("insufficient-evidence covers zero usable and an insufficient decision, and outranks hold", () => {
    expect(deriveTrendClass(0, 0, zero())).toBe("insufficient-evidence");
    const c = zero();
    c.insufficient = 1;
    c.hold = 1;
    expect(deriveTrendClass(2, 0, c)).toBe("insufficient-evidence");
  });

  it("hold outranks followup; followup outranks all-clear", () => {
    const c = zero();
    c.hold = 1;
    c["proceed-with-followup"] = 1;
    expect(deriveTrendClass(2, 0, c)).toBe("hold-present");
    const d = zero();
    d["proceed-with-followup"] = 1;
    expect(deriveTrendClass(1, 0, d)).toBe("followup-present");
  });

  it("all-clear when every usable record is a clean proceed", () => {
    const c = zero();
    c.proceed = 3;
    expect(deriveTrendClass(3, 0, c)).toBe("all-clear");
  });

  it("wires the reduced ledger's trend class to a real batch", () => {
    expect(reduced([proceedDecision(), holdDecision()]).ledger.trendClass).toBe("hold-present");
    expect(reduced([proceedDecision(), insufficientDecision()]).ledger.trendClass).toBe(
      "insufficient-evidence",
    );
  });
});
