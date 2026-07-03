// @vitest-environment node
/**
 * Proof for the content-free artifact-rejection receipt: coarse size bucketing, the
 * stable policy stamp, count clamping, and the optional timestamp. Every field is a
 * bounded enum, a policy constant, a bucket, a small count, or an ISO string.
 */
import { describe, expect, it } from "vitest";
import {
  ARTIFACT_RECEIPT_CATEGORIES,
  ARTIFACT_SIZE_BUCKETS,
  artifactSizeBucket,
  buildArtifactReceipt,
} from "./receipt";

describe("artifactSizeBucket", () => {
  it("buckets representative byte totals", () => {
    expect(artifactSizeBucket(0)).toBe("0");
    expect(artifactSizeBucket(512)).toBe("<1KiB");
    expect(artifactSizeBucket(4096)).toBe("1KiB-64KiB");
    expect(artifactSizeBucket(200_000)).toBe("64KiB-1MiB");
    expect(artifactSizeBucket(5 * 1024 * 1024)).toBe("1MiB-10MiB");
    expect(artifactSizeBucket(2 * 1024 * 1024 * 1024)).toBe("1GiB+");
  });

  it("maps a non-finite/negative measurement to unknown", () => {
    expect(artifactSizeBucket(Number.NaN)).toBe("unknown");
    expect(artifactSizeBucket(-1)).toBe("unknown");
    expect(artifactSizeBucket(Number.POSITIVE_INFINITY)).toBe("unknown");
  });

  it("only ever returns a bounded bucket label", () => {
    for (const n of [0, 1, 1e3, 1e6, 1e9, 1e12, -5, Number.NaN]) {
      expect(ARTIFACT_SIZE_BUCKETS).toContain(artifactSizeBucket(n));
    }
  });
});

describe("buildArtifactReceipt", () => {
  it("stamps the stable policy identity, buckets the size, and clamps the count", () => {
    const r = buildArtifactReceipt({
      category: "rejected",
      reason: "empty_artifact",
      processor: "compress",
      totalBytes: 512,
      artifactCount: 1,
      at: "2026-07-03T00:00:00.000Z",
    });
    expect(r).toEqual({
      category: "rejected",
      reason: "empty_artifact",
      policyId: "pdfxyz-worker-artifact-manifest",
      policyVersion: 1,
      processor: "compress",
      sizeBucket: "<1KiB",
      artifactCount: 1,
      at: "2026-07-03T00:00:00.000Z",
    });
  });

  it("records the bounded lifecycle category (generated / rejected / cleaned)", () => {
    for (const category of ARTIFACT_RECEIPT_CATEGORIES) {
      const r = buildArtifactReceipt({
        category,
        reason: category === "rejected" ? "empty_artifact" : "ok",
        processor: "compress",
        totalBytes: 2048,
        artifactCount: 1,
      });
      expect(r.category).toBe(category);
      expect(ARTIFACT_RECEIPT_CATEGORIES).toContain(r.category);
    }
  });

  it("omits the timestamp when none is supplied and clamps a bad count to 0", () => {
    const r = buildArtifactReceipt({
      category: "rejected",
      reason: "no_artifacts",
      processor: "ocr",
      totalBytes: 0,
      artifactCount: Number.NaN,
    });
    expect(r.at).toBeUndefined();
    expect(r.artifactCount).toBe(0);
    expect(r.sizeBucket).toBe("0");
  });

  it("never carries a byte total, filename, key, or content field", () => {
    const r = buildArtifactReceipt({
      category: "rejected",
      reason: "content_type_mismatch",
      processor: "ocr",
      totalBytes: 123_456,
      artifactCount: 2,
    });
    const keys = Object.keys(r);
    expect(keys).not.toContain("totalBytes");
    expect(keys).not.toContain("bytes");
    expect(keys).not.toContain("filename");
    // The raw byte total is discarded; only the coarse bucket survives.
    expect(JSON.stringify(r)).not.toContain("123456");
  });
});
