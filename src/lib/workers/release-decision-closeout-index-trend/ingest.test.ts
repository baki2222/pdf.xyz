import { describe, expect, it } from "vitest";
import { ingestCloseoutIndex, UNRECOGNIZED_INDEX } from "./ingest";
import {
  blockedIndex,
  incompleteIndex,
  indexedHistory,
  indexedIndex,
  notAnIndex,
  openIndex,
  tamperedIndex,
  tamperIndexVerdict,
} from "./fixtures";
import { RELEASE_DECISION_CLOSEOUT_INDEX_VERDICTS } from "./types";

type Obj = Record<string, unknown>;

describe("ingestCloseoutIndex — trust boundary over closeout-index windows", () => {
  it("marks a real self-consistent window of each index verdict usable and reduces its facts", () => {
    for (const window of [indexedIndex(), openIndex(), incompleteIndex(), blockedIndex()]) {
      const r = ingestCloseoutIndex(window);
      expect(r.recognized).toBe(true);
      expect(r.usable).toBe(true);
      expect(RELEASE_DECISION_CLOSEOUT_INDEX_VERDICTS).toContain(r.verdict);
      expect(r.facts).not.toBeNull();
      expect(r.facts!.verdict).toBe(window.closeoutIndex.verdict);
      expect(r.facts!.closeoutsConsidered).toBe(window.ledger.closeoutsConsidered);
    }
  });

  it("reduces the aggregate closeout distribution + latest closeout of a multi-closeout window", () => {
    const w = indexedHistory(); // three closed closeouts
    const r = ingestCloseoutIndex(w);
    expect(r.usable).toBe(true);
    expect(r.facts!.closeoutsUsable).toBe(3);
    expect(r.facts!.closeoutVerdictCounts.closed).toBe(3);
    expect(r.facts!.latestCloseout).toBe("closed");
  });

  it("a non-object / wrong-schema input is UNRECOGNIZED (unreadable), never echoed", () => {
    expect(ingestCloseoutIndex(notAnIndex())).toEqual(UNRECOGNIZED_INDEX);
    expect(ingestCloseoutIndex(null)).toEqual(UNRECOGNIZED_INDEX);
    expect(ingestCloseoutIndex("string")).toEqual(UNRECOGNIZED_INDEX);
    expect(ingestCloseoutIndex([indexedIndex()])).toEqual(UNRECOGNIZED_INDEX); // an array is not a window
  });

  it("a hand-flipped index verdict is caught as a tamper (recognized, not usable), surfacing the CLAIM", () => {
    const t = tamperedIndex(); // indexed → blocked
    const r = ingestCloseoutIndex(t);
    expect(r.recognized).toBe(true);
    expect(r.usable).toBe(false);
    expect(r.verdict).toBe("index-blocked"); // the untrusted claim is surfaced
    expect(r.facts).toBeNull();
  });

  it("catches a flip in EITHER direction (a blocked window forged to look indexed is a tamper)", () => {
    const forgedClean = tamperIndexVerdict(blockedIndex(), "indexed", 0);
    const r = ingestCloseoutIndex(forgedClean);
    expect(r.usable).toBe(false);
    expect(r.verdict).toBe("indexed");
  });

  it("a smuggled inconsistent ledger count (not matching the sequence) is a tamper", () => {
    const w = JSON.parse(JSON.stringify(indexedIndex())) as Obj & { ledger: Obj };
    // Inflate the usable count so the ledger no longer re-derives from the points sequence.
    (w.ledger as Obj).closeoutsUsable = 99;
    const r = ingestCloseoutIndex(w);
    expect(r.usable).toBe(false);
  });

  it("a smuggled inconsistent policy (strictOpen disagreeing with the rollup) is a tamper", () => {
    const w = JSON.parse(JSON.stringify(indexedIndex())) as Obj & {
      policy: Obj;
      closeoutIndex: Obj;
    };
    (w.policy as Obj).strictOpen = !(w.closeoutIndex as Obj).strictOpen;
    expect(ingestCloseoutIndex(w).usable).toBe(false);
  });

  it("an off-enum reason id in the recorded rollup is a corrupt window (tamper)", () => {
    const w = JSON.parse(JSON.stringify(indexedIndex())) as Obj & { closeoutIndex: { reasons: unknown[] } };
    w.closeoutIndex.reasons = ["not-a-real-reason-id"];
    expect(ingestCloseoutIndex(w).usable).toBe(false);
  });

  it("stray secret-shaped EXTRA fields on a coherent window do not break usability (they are dropped)", () => {
    const w = JSON.parse(JSON.stringify(indexedIndex())) as Obj;
    w.evilTop = "s3://evil-bucket/secret";
    w.generatedAt = "2099-12-31T23:59:59.000Z";
    (w.closeoutIndex as Obj).detail = "192.168.44.7";
    const r = ingestCloseoutIndex(w);
    expect(r.usable).toBe(true); // extras are non-load-bearing
    expect(r.facts).not.toHaveProperty("evilTop");
  });
});
