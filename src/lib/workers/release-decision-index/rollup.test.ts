/**
 * Unit proofs for the release-decision-index rollup (Phase 60): the fail-closed fold of a bounded batch + policy
 * into ONE index verdict, with an untrustworthy input dominating and `--strict` escalating a non-clean batch.
 *
 * Scenario tests drive the whole build (`makeIndex`) so the fold is exercised end-to-end; a few tests hit
 * `computeIndexRollup` directly for precedence precision.
 */

import { describe, expect, it } from "vitest";
import { computeIndexRollup, deriveIndexReasons } from "./rollup";
import { reduceIndex } from "./reduce";
import {
  defaultPolicy,
  followupDecision,
  holdDecision,
  ingestRecordsFrom,
  insufficientDecision,
  invalidDecision,
  makeIndex,
  notADecision,
  proceedDecision,
  rejectDecision,
  tamperedDecision,
} from "./fixtures";

const ledgerOf = (objs: readonly unknown[], maxRecords = 100) =>
  reduceIndex(ingestRecordsFrom(objs), maxRecords).ledger;

describe("computeIndexRollup — verdict precedence (fail-closed)", () => {
  it("a clean batch of proceed records is stable (exit 0)", () => {
    const i = makeIndex([proceedDecision(), proceedDecision(), proceedDecision()]);
    expect(i.index).toMatchObject({ verdict: "stable", exitCode: 0, stable: true });
    expect(i.index.reasons).toEqual([]);
  });

  it("an unreadable record makes the index invalid (exit 4) — never a vacuous stable", () => {
    const i = makeIndex([proceedDecision(), notADecision(), proceedDecision()]);
    expect(i.index).toMatchObject({ verdict: "invalid", exitCode: 4 });
    expect(i.index.reasons).toContain("record-unreadable");
  });

  it("a tampered record anywhere makes the index invalid (exit 4), even with a clean tip", () => {
    const i = makeIndex([proceedDecision(), tamperedDecision(), proceedDecision()]);
    expect(i.index).toMatchObject({ verdict: "invalid", exitCode: 4 });
    expect(i.index.reasons).toContain("record-tampered");
  });

  it("a reject decision is blocked (exit 4)", () => {
    const i = makeIndex([proceedDecision(), rejectDecision()]);
    expect(i.index).toMatchObject({ verdict: "blocked", exitCode: 4 });
    expect(i.index.reasons).toContain("decision-rejected");
  });

  it("a usable record whose own decision is invalid is blocked (not the index's own invalid)", () => {
    const i = makeIndex([proceedDecision(), invalidDecision()]);
    expect(i.index.verdict).toBe("blocked");
    expect(i.index.reasons).toContain("decision-invalid");
    expect(i.ledger.recordsUsable).toBe(2); // the invalid-decision record is itself usable
  });

  it("an insufficient decision is insufficient (exit 2)", () => {
    const i = makeIndex([proceedDecision(), insufficientDecision()]);
    expect(i.index).toMatchObject({ verdict: "insufficient", exitCode: 2 });
    expect(i.index.reasons).toContain("decision-insufficient");
  });

  it("zero usable records is insufficient (no-usable-records) — an empty considered window", () => {
    const i = makeIndex([], { maxRecords: 100 });
    expect(i.index).toMatchObject({ verdict: "insufficient", reasons: ["no-usable-records"] });
  });

  it("a followup / hold decision is a watch (exit 3)", () => {
    expect(makeIndex([proceedDecision(), followupDecision()]).index.verdict).toBe("watch");
    expect(makeIndex([proceedDecision(), holdDecision()]).index.verdict).toBe("watch");
  });

  it("invalid dominates blocking dominates insufficient dominates advisory", () => {
    const i = makeIndex([
      tamperedDecision(), // invalid
      rejectDecision(), // blocking
      insufficientDecision(), // insufficient
      followupDecision(), // advisory
    ]);
    expect(i.index.verdict).toBe("invalid");
    expect(i.index.invalidInputs).toBeGreaterThan(0);
    expect(i.index.blocking).toBeGreaterThan(0);
    expect(i.index.insufficiencies).toBeGreaterThan(0);
    expect(i.index.advisories).toBeGreaterThan(0);
  });

  it("emits reasons in canonical order (a superset view)", () => {
    const { rollup } = computeIndexRollup(ledgerOf([rejectDecision(), followupDecision()]), defaultPolicy());
    expect(rollup.reasons.indexOf("decision-rejected")).toBeLessThan(
      rollup.reasons.indexOf("decision-followup"),
    );
  });
});

describe("computeIndexRollup — --strict escalation", () => {
  it("escalates a watch batch to blocked, flagging strictEscalated (from watch)", () => {
    const i = makeIndex([proceedDecision(), followupDecision()], { strict: true });
    expect(i.index).toMatchObject({ verdict: "blocked", strictEscalated: true, strictEscalatedFrom: "watch" });
    expect(i.index.detail).toMatch(/strict/i);
  });

  it("escalates an insufficient batch to blocked (from insufficient)", () => {
    const i = makeIndex([proceedDecision(), insufficientDecision()], { strict: true });
    expect(i.index).toMatchObject({ verdict: "blocked", strictEscalated: true, strictEscalatedFrom: "insufficient" });
  });

  it("does NOT escalate a clean stable batch", () => {
    const i = makeIndex([proceedDecision(), proceedDecision()], { strict: true });
    expect(i.index).toMatchObject({ verdict: "stable", strictEscalated: false, strictEscalatedFrom: null });
  });

  it("does NOT re-flag an already-blocked / invalid batch as an escalation", () => {
    expect(makeIndex([rejectDecision()], { strict: true }).index.strictEscalated).toBe(false);
    expect(makeIndex([tamperedDecision()], { strict: true }).index.strictEscalated).toBe(false);
  });
});

describe("deriveIndexReasons — closed predicate set", () => {
  it("fires exactly the conditions present", () => {
    const reasons = deriveIndexReasons(ledgerOf([proceedDecision(), holdDecision(), notADecision()]));
    expect(reasons).toContain("record-unreadable");
    expect(reasons).toContain("decision-hold");
    expect(reasons).not.toContain("decision-rejected");
  });

  it("a clean batch fires nothing", () => {
    expect(deriveIndexReasons(ledgerOf([proceedDecision()]))).toEqual([]);
  });
});
