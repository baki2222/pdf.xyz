import { describe, expect, it } from "vitest";
import { ingestDecision } from "./ingest";
import {
  followupDecision,
  holdDecision,
  incompleteDecision,
  insufficientDecision,
  invalidDecision,
  notADecision,
  proceedDecision,
  rejectDecision,
  tamperDecision,
} from "./fixtures";

type Obj = Record<string, unknown>;
const clone = (o: unknown): Obj => JSON.parse(JSON.stringify(o)) as Obj;

describe("ingestDecision — recognizes + re-validates a coherent record", () => {
  it("a real proceed record is usable and re-derives its decision + facts", () => {
    const r = ingestDecision(proceedDecision());
    expect(r).toMatchObject({ recognized: true, usable: true, decision: "proceed" });
    expect(r.facts).toMatchObject({ decision: "proceed", proceed: true, crossCheck: "match" });
  });

  it("re-derives each decision class faithfully", () => {
    expect(ingestDecision(followupDecision()).decision).toBe("proceed-with-followup");
    expect(ingestDecision(holdDecision()).decision).toBe("hold");
    expect(ingestDecision(insufficientDecision()).decision).toBe("insufficient");
    expect(ingestDecision(incompleteDecision()).decision).toBe("insufficient");
    expect(ingestDecision(rejectDecision()).decision).toBe("reject");
  });

  it("a self-consistent record whose own decision is invalid (cross-check mismatch) is USABLE", () => {
    const r = ingestDecision(invalidDecision());
    expect(r).toMatchObject({ recognized: true, usable: true, decision: "invalid" });
    expect(r.facts?.crossCheck).toBe("mismatch");
  });
});

describe("ingestDecision — unrecognized inputs", () => {
  it("a non-object is unrecognized (⇒ unreadable)", () => {
    for (const bad of [null, 42, "x", [], true]) {
      expect(ingestDecision(bad)).toMatchObject({ recognized: false, usable: false, decision: null });
    }
  });

  it("a wrong-schema object is unrecognized", () => {
    expect(ingestDecision(notADecision())).toMatchObject({ recognized: false, usable: false });
  });
});

describe("ingestDecision — tamper detection (recognized but not usable)", () => {
  it("a hand-flipped recorded decision does not re-derive (surfaces the claim, marks unusable)", () => {
    const t = tamperDecision(proceedDecision(), "reject");
    const r = ingestDecision(t);
    expect(r).toMatchObject({ recognized: true, usable: false, decision: "reject", facts: null });
  });

  it("a lied blocking count is caught", () => {
    const t = clone(proceedDecision());
    (t.decision as Obj).blocking = 5;
    expect(ingestDecision(t)).toMatchObject({ recognized: true, usable: false });
  });

  it("a lied reason set is caught", () => {
    const t = clone(rejectDecision());
    (t.decision as Obj).reasons = []; // a reject record must carry a blocking reason
    expect(ingestDecision(t).usable).toBe(false);
  });

  it("an off-enum recorded decision is caught (corrupt rollup)", () => {
    const t = clone(proceedDecision());
    (t.decision as Obj).decision = "totally-made-up";
    const r = ingestDecision(t);
    expect(r).toMatchObject({ recognized: true, usable: false, decision: null });
  });

  it("a flipped cross-check status (mismatch → match) no longer re-derives", () => {
    const t = clone(invalidDecision());
    (t.crossCheck as Obj).status = "match"; // but the rollup still says invalid → inconsistent
    expect(ingestDecision(t).usable).toBe(false);
  });

  it("a flipped pack verdict that changes the true decision is caught", () => {
    const t = clone(rejectDecision());
    // rejectDecision blocks on ack-rejected; flip the pack verdict to blocked would ADD a reason → re-derive differs.
    (t.publishPack as Obj).verdict = "blocked";
    expect(ingestDecision(t).usable).toBe(false);
  });

  it("a policy.strict that disagrees with the recorded rollup.strict is a tamper", () => {
    const t = clone(proceedDecision());
    (t.policy as Obj).strict = true; // rollup.strict is false → inconsistent
    expect(ingestDecision(t).usable).toBe(false);
  });

  it("a missing publishPack / acknowledgement / crossCheck block is a tamper", () => {
    for (const key of ["publishPack", "acknowledgement", "crossCheck", "decision", "policy"]) {
      const t = clone(proceedDecision());
      delete t[key];
      expect(ingestDecision(t).usable, `missing ${key}`).toBe(false);
    }
  });
});
