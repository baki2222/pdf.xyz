// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import {
  buildArtifactCleanupReceipt,
  emitArtifactCleanupReceipt,
  resetArtifactCleanupObserverForTests,
  setArtifactCleanupObserver,
  type ArtifactCleanupReceipt,
} from "./receipt";
import { evaluateArtifactInventory } from "./evaluate";
import { ARTIFACT_POLICY_ID, ARTIFACT_POLICY_VERSION } from "../policy";

const NOW = 1_700_000_000_000;

const REPORT = evaluateArtifactInventory(
  {
    records: [
      { declaredLifecycle: "live", expiresAtMs: null, deleted: false, manifest: "valid", provider: "remote-configured", kind: "pdf", processor: "compress", age: "1-24h", size: "64kb-1mb", wellFormed: true },
      { declaredLifecycle: null, expiresAtMs: 1000, deleted: false, manifest: "valid", provider: "remote-configured", kind: "pdf", processor: "compress", age: "over-30d", size: "1-10mb", wellFormed: true },
    ],
  },
  NOW,
);

afterEach(() => resetArtifactCleanupObserverForTests());

describe("buildArtifactCleanupReceipt", () => {
  it("projects only bounded verdict/counts and stamps the policy", () => {
    const receipt = buildArtifactCleanupReceipt(REPORT, new Date(NOW).toISOString());
    expect(receipt).toMatchObject({
      category: "artifact-cleanup",
      verdict: "drift",
      total: 2,
      cleanupRecommended: 1,
      policyId: ARTIFACT_POLICY_ID,
      policyVersion: ARTIFACT_POLICY_VERSION,
    });
    expect(receipt.severities).toMatchObject({ ok: 1, drift: 1 });
    expect(receipt.at).toBe(new Date(NOW).toISOString());
  });

  it("omits the timestamp when none is supplied", () => {
    expect(buildArtifactCleanupReceipt(REPORT).at).toBeUndefined();
  });
});

describe("observer seam", () => {
  it("defaults to no observer (no side effect)", () => {
    // No throw, no observer wired: emit just returns the receipt.
    expect(emitArtifactCleanupReceipt(REPORT).verdict).toBe("drift");
  });

  it("delivers the receipt to a wired observer", () => {
    const seen: ArtifactCleanupReceipt[] = [];
    setArtifactCleanupObserver((r) => seen.push(r));
    emitArtifactCleanupReceipt(REPORT, new Date(NOW).toISOString());
    expect(seen).toHaveLength(1);
    expect(seen[0]!.verdict).toBe("drift");
  });

  it("swallows a throwing observer (observability never breaks a run)", () => {
    setArtifactCleanupObserver(() => {
      throw new Error("sink down");
    });
    expect(() => emitArtifactCleanupReceipt(REPORT)).not.toThrow();
  });
});
