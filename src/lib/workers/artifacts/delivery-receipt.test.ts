// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { ARTIFACT_POLICY_ID, ARTIFACT_POLICY_VERSION } from "./policy";
import {
  buildArtifactDeliveryReceipt,
  emitArtifactDeliveryReceipt,
  resetArtifactDeliveryObserverForTests,
  setArtifactDeliveryObserver,
  type ArtifactDeliveryReceipt,
} from "./delivery-receipt";

afterEach(resetArtifactDeliveryObserverForTests);

describe("buildArtifactDeliveryReceipt", () => {
  it("folds a delivered decision into a bounded, stamped receipt", () => {
    const r = buildArtifactDeliveryReceipt({
      reason: "ok",
      kind: "pdf",
      provider: "local-dev",
      method: "GET",
      range: "none",
    });
    expect(r).toEqual({
      category: "delivery",
      outcome: "delivered",
      reason: "ok",
      kind: "pdf",
      provider: "local-dev",
      method: "GET",
      range: "none",
      policyId: ARTIFACT_POLICY_ID,
      policyVersion: ARTIFACT_POLICY_VERSION,
    });
  });

  it("folds every denial reason to the denied outcome and records method/range", () => {
    const r = buildArtifactDeliveryReceipt({
      reason: "size_mismatch",
      kind: "unknown",
      provider: "remote-configured",
      method: "HEAD",
      range: "ignored",
    });
    expect(r.outcome).toBe("denied");
    expect(r.reason).toBe("size_mismatch");
    expect(r.method).toBe("HEAD");
    expect(r.range).toBe("ignored");
  });

  it("includes an ISO timestamp only when supplied", () => {
    const withAt = buildArtifactDeliveryReceipt({
      reason: "ok",
      kind: "pdf",
      provider: "remote-configured",
      method: "GET",
      range: "none",
      at: "2026-07-03T00:00:00.000Z",
    });
    expect(withAt.at).toBe("2026-07-03T00:00:00.000Z");
    const withoutAt = buildArtifactDeliveryReceipt({
      reason: "ok",
      kind: "pdf",
      provider: "remote-configured",
      method: "GET",
      range: "none",
    });
    expect("at" in withoutAt).toBe(false);
  });
});

describe("emitArtifactDeliveryReceipt", () => {
  it("emits to a registered observer and returns the receipt", () => {
    const seen: ArtifactDeliveryReceipt[] = [];
    setArtifactDeliveryObserver((r) => seen.push(r));
    const r = emitArtifactDeliveryReceipt({
      reason: "oversize",
      kind: "archive",
      provider: "remote-configured",
      method: "GET",
      range: "none",
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(r);
    expect(r.outcome).toBe("denied");
  });

  it("is inert with no observer (default) and swallows a throwing observer", () => {
    // No observer registered: no throw, returns the receipt.
    expect(() =>
      emitArtifactDeliveryReceipt({
        reason: "ok",
        kind: "pdf",
        provider: "local-dev",
        method: "GET",
        range: "none",
      }),
    ).not.toThrow();
    // A throwing observer must never break a download.
    setArtifactDeliveryObserver(() => {
      throw new Error("sink blew up");
    });
    expect(() =>
      emitArtifactDeliveryReceipt({
        reason: "ok",
        kind: "pdf",
        provider: "local-dev",
        method: "HEAD",
        range: "none",
      }),
    ).not.toThrow();
  });

  it("is content-free: no field carries a handle, key, size, or byte", () => {
    const r = buildArtifactDeliveryReceipt({
      reason: "stream_error",
      kind: "unknown",
      provider: "remote-configured",
      method: "GET",
      range: "ignored",
    });
    const blob = JSON.stringify(r);
    for (const secret of [
      "art_abcdefghij0123456789",
      "amazonaws",
      "X-Amz-Signature",
      "/etc/passwd",
      "AWS_SECRET",
    ]) {
      expect(blob).not.toContain(secret);
    }
    // Only bounded keys — never a size, path, or byte field.
    expect(Object.keys(r).sort()).toEqual(
      [
        "category",
        "kind",
        "method",
        "outcome",
        "policyId",
        "policyVersion",
        "provider",
        "range",
        "reason",
      ].sort(),
    );
  });
});
