// @vitest-environment node
/**
 * Contract for the content-free artifact-lifecycle/expiry drift receipt: the stable policy
 * stamp, the optional timestamp, the no-leak guarantee across every bounded state × provider,
 * and the swappable observer. Pure and node-free — no store, no route, no clock.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ARTIFACT_POLICY_ID, ARTIFACT_POLICY_VERSION } from "./policy";
import { RETRIEVAL_STORAGE_PROVIDERS } from "./access";
import { ARTIFACT_LIFECYCLE_STATES } from "./lifecycle";
import {
  buildArtifactExpiryReceipt,
  emitArtifactExpiryReceipt,
  resetArtifactExpiryObserverForTests,
  setArtifactExpiryObserver,
} from "./expiry-receipt";

afterEach(resetArtifactExpiryObserverForTests);

describe("buildArtifactExpiryReceipt", () => {
  it("stamps the policy and copies an optional timestamp", () => {
    expect(
      buildArtifactExpiryReceipt({
        state: "expired",
        provider: "remote-configured",
        at: "2026-07-03T00:00:00.000Z",
      }),
    ).toEqual({
      category: "expiry",
      state: "expired",
      provider: "remote-configured",
      policyId: ARTIFACT_POLICY_ID,
      policyVersion: ARTIFACT_POLICY_VERSION,
      at: "2026-07-03T00:00:00.000Z",
    });
  });

  it("omits an absent timestamp", () => {
    const r = buildArtifactExpiryReceipt({
      state: "live",
      provider: "remote-configured",
    });
    expect("at" in r).toBe(false);
  });

  it("is content-free for every state × provider — only bounded keys, no free text", () => {
    const keys = ["category", "policyId", "policyVersion", "provider", "state"];
    for (const state of ARTIFACT_LIFECYCLE_STATES) {
      for (const provider of RETRIEVAL_STORAGE_PROVIDERS) {
        const r = buildArtifactExpiryReceipt({ state, provider });
        expect(Object.keys(r).sort()).toEqual([...keys].sort());
        expect(ARTIFACT_LIFECYCLE_STATES).toContain(r.state);
        expect(RETRIEVAL_STORAGE_PROVIDERS).toContain(r.provider);
        expect(r.category).toBe("expiry");
        // No key that could carry an id, object key, bucket, timestamp value, or byte.
        const serialized = JSON.stringify(r).toLowerCase();
        for (const bad of [
          "art_",
          "://",
          "bucket",
          "amazonaws",
          ".pdf",
          "secret",
        ]) {
          expect(serialized).not.toContain(bad);
        }
      }
    }
  });
});

describe("expiry-receipt observer", () => {
  it("emits to a registered observer and returns the receipt", () => {
    const spy = vi.fn();
    setArtifactExpiryObserver(spy);
    const r = emitArtifactExpiryReceipt({
      state: "expired",
      provider: "remote-configured",
    });
    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(r);
    expect(r.state).toBe("expired");
  });

  it("is a no-op (but still returns the receipt) with no observer registered", () => {
    const r = emitArtifactExpiryReceipt({
      state: "live",
      provider: "remote-configured",
    });
    expect(r.category).toBe("expiry");
  });

  it("swallows a throwing observer so a download can never break on observability", () => {
    setArtifactExpiryObserver(() => {
      throw new Error("sink is down");
    });
    expect(() =>
      emitArtifactExpiryReceipt({
        state: "unknown",
        provider: "remote-configured",
      }),
    ).not.toThrow();
  });
});
