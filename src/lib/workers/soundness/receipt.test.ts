// @vitest-environment node
/**
 * The content-free quarantine receipt: the coarse size bucketer's boundaries, the
 * builder's stamping/clamping, and the structural guarantee that a receipt has ONLY
 * bounded enums, policy constants, a bucket, a count, and an optional timestamp — no
 * field into which a filename, key, path, URL, secret, or byte could ever flow.
 */
import { describe, expect, it } from "vitest";
import {
  buildSoundnessReceipt,
  soundnessSizeBucket,
  SOUNDNESS_SIZE_BUCKETS,
} from "./receipt";

const KIB = 1024;
const MIB = 1024 * KIB;
const GIB = 1024 * MIB;

describe("soundnessSizeBucket", () => {
  it("maps representative sizes to the expected coarse bucket", () => {
    expect(soundnessSizeBucket(0)).toBe("0");
    expect(soundnessSizeBucket(1)).toBe("<1KiB");
    expect(soundnessSizeBucket(KIB - 1)).toBe("<1KiB");
    expect(soundnessSizeBucket(KIB)).toBe("1KiB-64KiB");
    expect(soundnessSizeBucket(64 * KIB - 1)).toBe("1KiB-64KiB");
    expect(soundnessSizeBucket(64 * KIB)).toBe("64KiB-1MiB");
    expect(soundnessSizeBucket(MIB - 1)).toBe("64KiB-1MiB");
    expect(soundnessSizeBucket(MIB)).toBe("1MiB-10MiB");
    expect(soundnessSizeBucket(10 * MIB - 1)).toBe("1MiB-10MiB");
    expect(soundnessSizeBucket(10 * MIB)).toBe("10MiB-100MiB");
    expect(soundnessSizeBucket(100 * MIB)).toBe("100MiB-1GiB");
    expect(soundnessSizeBucket(GIB - 1)).toBe("100MiB-1GiB");
    expect(soundnessSizeBucket(GIB)).toBe("1GiB+");
  });

  it("returns `unknown` for a non-finite or negative measurement", () => {
    for (const bad of [-1, NaN, Infinity, -Infinity]) {
      expect(soundnessSizeBucket(bad)).toBe("unknown");
    }
  });

  it("only ever returns a value from the closed bucket set", () => {
    for (const n of [0, 10, KIB, MIB, GIB, -1, NaN]) {
      expect(SOUNDNESS_SIZE_BUCKETS).toContain(soundnessSizeBucket(n));
    }
  });
});

describe("buildSoundnessReceipt", () => {
  it("stamps the stable policy id/version and buckets the total size", () => {
    const receipt = buildSoundnessReceipt({
      verdict: "unsound",
      reason: "malformed_pdf",
      processor: "compress",
      totalBytes: 500,
      inputCount: 1,
    });
    expect(receipt).toEqual({
      verdict: "unsound",
      reason: "malformed_pdf",
      policyId: "pdfxyz-worker-soundness",
      policyVersion: 1,
      processor: "compress",
      sizeBucket: "<1KiB",
      inputCount: 1,
    });
    // No timestamp field when none was supplied.
    expect("at" in receipt).toBe(false);
  });

  it("includes an ISO timestamp when one is supplied", () => {
    const at = new Date(1_700_000_000_000).toISOString();
    const receipt = buildSoundnessReceipt({
      verdict: "unsound",
      reason: "size_mismatch",
      processor: "ocr",
      totalBytes: 5 * MIB,
      inputCount: 2,
      at,
    });
    expect(receipt.at).toBe(at);
    expect(receipt.sizeBucket).toBe("1MiB-10MiB");
    expect(receipt.processor).toBe("ocr");
  });

  it("clamps the input count to a non-negative integer", () => {
    const build = (inputCount: number) =>
      buildSoundnessReceipt({
        verdict: "unsound",
        reason: "too_many_inputs",
        processor: "other",
        totalBytes: 0,
        inputCount,
      }).inputCount;
    expect(build(-3)).toBe(0);
    expect(build(2.7)).toBe(2);
    expect(build(NaN)).toBe(0);
    expect(build(5)).toBe(5);
  });
});

describe("receipt privacy — no field can carry content", () => {
  it("a receipt serializes to only bounded, content-free fields", () => {
    const receipt = buildSoundnessReceipt({
      verdict: "unsound",
      reason: "unsupported_family",
      processor: "compress",
      totalBytes: 1234,
      inputCount: 1,
      at: new Date(1_700_000_000_000).toISOString(),
    });
    // The receipt has exactly the whitelisted keys — nothing free-form.
    expect(Object.keys(receipt).sort()).toEqual(
      [
        "at",
        "inputCount",
        "policyId",
        "policyVersion",
        "processor",
        "reason",
        "sizeBucket",
        "verdict",
      ].sort(),
    );
    // Every string value is a stable enum/constant, not user content.
    const serialized = JSON.stringify(receipt);
    expect(serialized).toContain("pdfxyz-worker-soundness");
    expect(serialized).not.toMatch(/\.pdf|https?:|\/|X-Amz|SECRET|passwd/);
  });
});
