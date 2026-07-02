import { describe, expect, it } from "vitest";
import { countBucket, sizeBucket, durationBucket } from "./buckets";

const KB = 1024;
const MB = 1024 * KB;

describe("countBucket", () => {
  it("maps small counts to exact labels", () => {
    expect(countBucket(0)).toBe("0");
    expect(countBucket(1)).toBe("1");
  });

  it("groups larger counts into coarse ranges", () => {
    expect(countBucket(2)).toBe("2-5");
    expect(countBucket(5)).toBe("2-5");
    expect(countBucket(6)).toBe("6-20");
    expect(countBucket(20)).toBe("6-20");
    expect(countBucket(21)).toBe("21-50");
    expect(countBucket(50)).toBe("21-50");
    expect(countBucket(51)).toBe("50+");
    expect(countBucket(10_000)).toBe("50+");
  });

  it("floors fractional counts before bucketing", () => {
    expect(countBucket(1.9)).toBe("1");
    expect(countBucket(5.9)).toBe("2-5");
  });

  it("returns 'unknown' for negative or non-finite input", () => {
    expect(countBucket(-1)).toBe("unknown");
    expect(countBucket(Number.NaN)).toBe("unknown");
    expect(countBucket(Number.POSITIVE_INFINITY)).toBe("unknown");
  });
});

describe("sizeBucket", () => {
  it("uses KB/MB tier boundaries (upper bound is exclusive)", () => {
    expect(sizeBucket(0)).toBe("<100KB");
    expect(sizeBucket(99 * KB)).toBe("<100KB");
    expect(sizeBucket(100 * KB)).toBe("100KB-1MB");
    expect(sizeBucket(MB - 1)).toBe("100KB-1MB");
    expect(sizeBucket(MB)).toBe("1-10MB");
    expect(sizeBucket(10 * MB - 1)).toBe("1-10MB");
    expect(sizeBucket(10 * MB)).toBe("10-50MB");
    expect(sizeBucket(50 * MB)).toBe("50-100MB");
    expect(sizeBucket(100 * MB - 1)).toBe("50-100MB");
    expect(sizeBucket(100 * MB)).toBe("100MB+");
    expect(sizeBucket(500 * MB)).toBe("100MB+");
  });

  it("returns 'unknown' for negative or non-finite input", () => {
    expect(sizeBucket(-5)).toBe("unknown");
    expect(sizeBucket(Number.NaN)).toBe("unknown");
    expect(sizeBucket(Number.POSITIVE_INFINITY)).toBe("unknown");
  });
});

describe("durationBucket", () => {
  it("uses human time tiers (upper bound is exclusive)", () => {
    expect(durationBucket(0)).toBe("<250ms");
    expect(durationBucket(249)).toBe("<250ms");
    expect(durationBucket(250)).toBe("250ms-1s");
    expect(durationBucket(999)).toBe("250ms-1s");
    expect(durationBucket(1000)).toBe("1-5s");
    expect(durationBucket(4999)).toBe("1-5s");
    expect(durationBucket(5000)).toBe("5-30s");
    expect(durationBucket(29_999)).toBe("5-30s");
    expect(durationBucket(30_000)).toBe("30s+");
    expect(durationBucket(120_000)).toBe("30s+");
  });

  it("returns 'unknown' for negative or non-finite input", () => {
    expect(durationBucket(-1)).toBe("unknown");
    expect(durationBucket(Number.NaN)).toBe("unknown");
  });
});
