import { describe, expect, it } from "vitest";
import { ingestGovernanceIndex, UNRECOGNIZED_INDEX } from "./ingest";
import {
  blockedWindow,
  incompleteWindow,
  indexedHistory,
  indexedWindow,
  notAWindow,
  tamperedWindow,
  tamperIndexVerdict,
  watchWindow,
} from "./fixtures";
import { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICTS } from "./types";

type Obj = Record<string, unknown>;

describe("ingestGovernanceIndex — trust boundary over governance-index windows", () => {
  it("marks a real self-consistent window of each index verdict usable and reduces its facts", () => {
    for (const window of [indexedWindow(), watchWindow(), incompleteWindow(), blockedWindow()]) {
      const r = ingestGovernanceIndex(window);
      expect(r.recognized).toBe(true);
      expect(r.usable).toBe(true);
      expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_INDEX_VERDICTS).toContain(r.verdict);
      expect(r.facts).not.toBeNull();
      expect(r.facts!.verdict).toBe(window.governanceIndex.verdict);
      expect(r.facts!.governanceConsidered).toBe(window.ledger.governanceConsidered);
    }
  });

  it("reduces the aggregate governance distribution + latest governance of a multi-bundle window", () => {
    const w = indexedHistory(); // three closed governance bundles
    const r = ingestGovernanceIndex(w);
    expect(r.usable).toBe(true);
    expect(r.facts!.governanceUsable).toBe(3);
    expect(r.facts!.governanceVerdictCounts.closed).toBe(3);
    expect(r.facts!.latestGovernance).toBe("closed");
  });

  it("a non-object / wrong-schema input is UNRECOGNIZED (unreadable), never echoed", () => {
    expect(ingestGovernanceIndex(notAWindow())).toEqual(UNRECOGNIZED_INDEX);
    expect(ingestGovernanceIndex(null)).toEqual(UNRECOGNIZED_INDEX);
    expect(ingestGovernanceIndex("string")).toEqual(UNRECOGNIZED_INDEX);
    expect(ingestGovernanceIndex([indexedWindow()])).toEqual(UNRECOGNIZED_INDEX); // an array is not a window
  });

  it("a hand-flipped index verdict is caught as a tamper (recognized, not usable), surfacing the CLAIM", () => {
    const t = tamperedWindow(); // indexed → blocked
    const r = ingestGovernanceIndex(t);
    expect(r.recognized).toBe(true);
    expect(r.usable).toBe(false);
    expect(r.verdict).toBe("index-blocked"); // the untrusted claim is surfaced
    expect(r.facts).toBeNull();
  });

  it("catches a flip in EITHER direction (a blocked window forged to look indexed is a tamper)", () => {
    const forgedClean = tamperIndexVerdict(blockedWindow(), "indexed", 0);
    const r = ingestGovernanceIndex(forgedClean);
    expect(r.usable).toBe(false);
    expect(r.verdict).toBe("indexed");
  });

  it("a smuggled inconsistent ledger count (not matching the sequence) is a tamper", () => {
    const w = JSON.parse(JSON.stringify(indexedWindow())) as Obj & { ledger: Obj };
    // Inflate the usable count so the ledger no longer re-derives from the points sequence.
    (w.ledger as Obj).governanceUsable = 99;
    const r = ingestGovernanceIndex(w);
    expect(r.usable).toBe(false);
  });

  it("a smuggled inconsistent policy (strictOpen disagreeing with the rollup) is a tamper", () => {
    const w = JSON.parse(JSON.stringify(indexedWindow())) as Obj & {
      policy: Obj;
      governanceIndex: Obj;
    };
    (w.policy as Obj).strictOpen = !(w.governanceIndex as Obj).strictOpen;
    expect(ingestGovernanceIndex(w).usable).toBe(false);
  });

  it("an off-enum reason id in the recorded rollup is a corrupt window (tamper)", () => {
    const w = JSON.parse(JSON.stringify(indexedWindow())) as Obj & { governanceIndex: { reasons: unknown[] } };
    w.governanceIndex.reasons = ["not-a-real-reason-id"];
    expect(ingestGovernanceIndex(w).usable).toBe(false);
  });

  it("stray secret-shaped EXTRA fields on a coherent window do not break usability (they are dropped)", () => {
    const w = JSON.parse(JSON.stringify(indexedWindow())) as Obj;
    w.evilTop = "s3://evil-bucket/secret";
    w.generatedAt = "2099-12-31T23:59:59.000Z";
    (w.governanceIndex as Obj).detail = "192.168.44.7";
    const r = ingestGovernanceIndex(w);
    expect(r.usable).toBe(true); // extras are non-load-bearing
    expect(r.facts).not.toHaveProperty("evilTop");
  });
});
