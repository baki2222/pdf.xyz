import { describe, expect, it } from "vitest";
import { ingestFinalizeIndex, UNRECOGNIZED_FINALIZE_INDEX } from "./ingest";
import {
  blockedWindow,
  incompleteWindow,
  indexedHistory,
  indexedWindow,
  invalidWindow,
  notAWindow,
  openWindow,
  tamperedWindow,
  tamperFinalizeIndexVerdict,
} from "./fixtures";
import { RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_VERDICTS } from "./types";

type Obj = Record<string, unknown>;

describe("ingestFinalizeIndex — trust boundary over finalize-index windows", () => {
  it("marks a real self-consistent window of each index verdict usable and reduces its facts", () => {
    for (const window of [indexedWindow(), openWindow(), incompleteWindow(), blockedWindow(), invalidWindow()]) {
      const r = ingestFinalizeIndex(window);
      expect(r.recognized).toBe(true);
      expect(r.usable).toBe(true);
      expect(RELEASE_DECISION_CLOSEOUT_GOVERNANCE_FINALIZE_INDEX_VERDICTS).toContain(r.verdict);
      expect(r.facts).not.toBeNull();
      expect(r.facts!.verdict).toBe(window.finalizeIndex.verdict);
      expect(r.facts!.finalizationsConsidered).toBe(window.coverage.finalizationsConsidered);
    }
  });

  it("reduces the aggregate finalization distribution + latest finalization of a multi-bundle window", () => {
    const r = ingestFinalizeIndex(indexedHistory());
    expect(r.usable).toBe(true);
    expect(r.facts!.finalizationsUsable).toBe(3);
    expect(r.facts!.finalizationVerdictCounts.finalized).toBe(3);
    expect(r.facts!.latestFinalization).toBe("finalized");
  });

  it("a non-object / wrong-schema input is UNRECOGNIZED (unreadable), never echoed", () => {
    expect(ingestFinalizeIndex(notAWindow())).toEqual(UNRECOGNIZED_FINALIZE_INDEX);
    expect(ingestFinalizeIndex(null)).toEqual(UNRECOGNIZED_FINALIZE_INDEX);
    expect(ingestFinalizeIndex("string")).toEqual(UNRECOGNIZED_FINALIZE_INDEX);
    expect(ingestFinalizeIndex([indexedWindow()])).toEqual(UNRECOGNIZED_FINALIZE_INDEX);
  });

  it("a hand-flipped index verdict is caught as a tamper (recognized, not usable), surfacing the CLAIM", () => {
    const r = ingestFinalizeIndex(tamperedWindow());
    expect(r.recognized).toBe(true);
    expect(r.usable).toBe(false);
    expect(r.verdict).toBe("index-blocked");
    expect(r.facts).toBeNull();
  });

  it("catches a flip in EITHER direction (a blocked window forged to look indexed is a tamper)", () => {
    const r = ingestFinalizeIndex(tamperFinalizeIndexVerdict(blockedWindow(), "indexed", 0));
    expect(r.usable).toBe(false);
    expect(r.verdict).toBe("indexed");
  });

  it("a smuggled inconsistent coverage count (not matching the sequence) is a tamper", () => {
    const w = JSON.parse(JSON.stringify(indexedWindow())) as Obj & { coverage: Obj };
    w.coverage.finalizationsUsable = 99;
    expect(ingestFinalizeIndex(w).usable).toBe(false);
  });

  it("a smuggled inconsistent policy (strictOpen disagreeing with the rollup) is a tamper", () => {
    const w = JSON.parse(JSON.stringify(indexedWindow())) as Obj & {
      policy: { strictOpen: boolean };
      finalizeIndex: { strictOpen: boolean };
    };
    w.policy.strictOpen = !w.finalizeIndex.strictOpen;
    expect(ingestFinalizeIndex(w).usable).toBe(false);
  });

  it("an off-enum reason id in the recorded rollup is a corrupt window (tamper)", () => {
    const w = JSON.parse(JSON.stringify(indexedWindow())) as Obj & { finalizeIndex: { reasons: unknown } };
    w.finalizeIndex.reasons = ["not-a-real-reason-id"];
    expect(ingestFinalizeIndex(w).usable).toBe(false);
  });

  it("stray secret-shaped EXTRA fields on a coherent window do not break usability (they are dropped)", () => {
    const w = JSON.parse(JSON.stringify(indexedWindow())) as Obj & { finalizeIndex: Obj };
    w.evilTop = "s3://evil-bucket/secret";
    w.generatedAt = "2099-12-31T23:59:59.000Z";
    w.finalizeIndex.detail = "192.168.44.7";
    const r = ingestFinalizeIndex(w);
    expect(r.usable).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(r.facts!, "evilTop")).toBe(false);
  });
});
