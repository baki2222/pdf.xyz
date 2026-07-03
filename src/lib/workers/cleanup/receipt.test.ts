// @vitest-environment node
/**
 * Contract for the content-free cleanup-verification receipt: the stable policy stamp, the
 * optional timestamp, count clamping, the swappable observer, and the swallow-throwing-observer
 * guarantee. Pure and node-free.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLEANUP_POLICY_ID, CLEANUP_POLICY_VERSION } from "./types";
import {
  buildCleanupVerificationReceipt,
  emitCleanupVerificationReceipt,
  resetCleanupVerificationObserverForTests,
  setCleanupVerificationObserver,
} from "./receipt";

afterEach(resetCleanupVerificationObserverForTests);

describe("buildCleanupVerificationReceipt", () => {
  it("stamps the category + stable policy id/version", () => {
    const receipt = buildCleanupVerificationReceipt({
      verdict: "verified",
      provider: "remote-configured",
      total: 3,
      reaped: 3,
      drift: 0,
    });
    expect(receipt).toMatchObject({
      category: "cleanup",
      verdict: "verified",
      provider: "remote-configured",
      policyId: CLEANUP_POLICY_ID,
      policyVersion: CLEANUP_POLICY_VERSION,
    });
    expect(receipt.at).toBeUndefined();
  });

  it("carries an optional ISO timestamp when supplied", () => {
    const receipt = buildCleanupVerificationReceipt({
      verdict: "drift",
      provider: "remote-configured",
      total: 1,
      reaped: 0,
      drift: 1,
      at: "2026-07-03T00:00:00.000Z",
    });
    expect(receipt.at).toBe("2026-07-03T00:00:00.000Z");
  });

  it("clamps non-integer / negative counts to safe values", () => {
    const receipt = buildCleanupVerificationReceipt({
      verdict: "unknown",
      provider: "not-configured",
      total: -3,
      reaped: Number.POSITIVE_INFINITY,
      drift: 2.7,
    });
    expect(receipt.total).toBe(0);
    expect(receipt.reaped).toBe(0);
    expect(receipt.drift).toBe(2);
  });
});

describe("emitCleanupVerificationReceipt", () => {
  it("is silent by default (no observer wired)", () => {
    expect(() =>
      emitCleanupVerificationReceipt({
        verdict: "verified",
        provider: "remote-configured",
        total: 0,
        reaped: 0,
        drift: 0,
      }),
    ).not.toThrow();
  });

  it("delivers the receipt to a wired observer", () => {
    const observer = vi.fn();
    setCleanupVerificationObserver(observer);
    const receipt = emitCleanupVerificationReceipt({
      verdict: "drift",
      provider: "remote-configured",
      total: 5,
      reaped: 2,
      drift: 1,
    });
    expect(observer).toHaveBeenCalledWith(receipt);
  });

  it("swallows a throwing observer (observability never breaks a check)", () => {
    setCleanupVerificationObserver(() => {
      throw new Error("sink down");
    });
    expect(() =>
      emitCleanupVerificationReceipt({
        verdict: "verified",
        provider: "remote-configured",
        total: 1,
        reaped: 1,
        drift: 0,
      }),
    ).not.toThrow();
  });

  it("stops delivering after reset", () => {
    const observer = vi.fn();
    setCleanupVerificationObserver(observer);
    resetCleanupVerificationObserverForTests();
    emitCleanupVerificationReceipt({
      verdict: "verified",
      provider: "remote-configured",
      total: 0,
      reaped: 0,
      drift: 0,
    });
    expect(observer).not.toHaveBeenCalled();
  });
});
