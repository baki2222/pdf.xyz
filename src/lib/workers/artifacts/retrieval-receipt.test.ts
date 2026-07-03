// @vitest-environment node
/**
 * Contract for the content-free artifact-retrieval receipt: the outcome fold, the stable
 * policy stamp, the optional timestamp, the no-leak guarantee across every bounded
 * reason, and the swappable observer. Pure and node-free — no store, no route, no clock.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ARTIFACT_POLICY_ID, ARTIFACT_POLICY_VERSION } from "./policy";
import { ARTIFACT_OUTPUT_KINDS } from "./types";
import { ARTIFACT_ACCESS_REASONS } from "./access";
import {
  buildArtifactRetrievalReceipt,
  emitArtifactRetrievalReceipt,
  resetArtifactRetrievalObserverForTests,
  setArtifactRetrievalObserver,
} from "./retrieval-receipt";

afterEach(resetArtifactRetrievalObserverForTests);

describe("buildArtifactRetrievalReceipt", () => {
  it("folds ok to served, stamps the policy, and copies an optional timestamp", () => {
    expect(
      buildArtifactRetrievalReceipt({
        reason: "ok",
        kind: "pdf",
        at: "2026-07-03T00:00:00.000Z",
      }),
    ).toEqual({
      category: "retrieval",
      outcome: "served",
      reason: "ok",
      kind: "pdf",
      policyId: ARTIFACT_POLICY_ID,
      policyVersion: ARTIFACT_POLICY_VERSION,
      at: "2026-07-03T00:00:00.000Z",
    });
  });

  it("folds every denial reason to `denied` and omits an absent timestamp", () => {
    for (const reason of ARTIFACT_ACCESS_REASONS) {
      if (reason === "ok") continue;
      const r = buildArtifactRetrievalReceipt({ reason, kind: "unknown" });
      expect(r.outcome).toBe("denied");
      expect(r.reason).toBe(reason);
      expect("at" in r).toBe(false);
    }
  });

  it("is content-free for every reason × kind — only bounded keys, no free text", () => {
    const keys = ["category", "kind", "outcome", "policyId", "policyVersion", "reason"];
    for (const reason of ARTIFACT_ACCESS_REASONS) {
      for (const kind of ARTIFACT_OUTPUT_KINDS) {
        const r = buildArtifactRetrievalReceipt({ reason, kind });
        expect(Object.keys(r).sort()).toEqual([...keys].sort());
        // Bounded enums only — nothing that could carry an id, key, name, or byte.
        expect(ARTIFACT_ACCESS_REASONS).toContain(r.reason);
        expect(ARTIFACT_OUTPUT_KINDS).toContain(r.kind);
        expect(["served", "denied"]).toContain(r.outcome);
      }
    }
  });
});

describe("retrieval-receipt observer", () => {
  it("emits to a registered observer and returns the receipt", () => {
    const spy = vi.fn();
    setArtifactRetrievalObserver(spy);
    const r = emitArtifactRetrievalReceipt({ reason: "expired", kind: "unknown" });
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(r);
    expect(r.outcome).toBe("denied");
  });

  it("is a no-op (but still returns the receipt) with no observer registered", () => {
    const r = emitArtifactRetrievalReceipt({ reason: "ok", kind: "pdf" });
    expect(r.outcome).toBe("served");
  });

  it("swallows a throwing observer so a download can never break on observability", () => {
    setArtifactRetrievalObserver(() => {
      throw new Error("sink is down");
    });
    expect(() =>
      emitArtifactRetrievalReceipt({ reason: "ok", kind: "pdf" }),
    ).not.toThrow();
  });
});
