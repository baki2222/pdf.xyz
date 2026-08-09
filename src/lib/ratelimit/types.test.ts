import { describe, expect, it } from "vitest";
import { RATE_LIMIT_ACTIONS, retryAfterBucket } from "./types";

describe("retryAfterBucket", () => {
  it("maps an allow (no wait) to `none`", () => {
    expect(retryAfterBucket(0)).toBe("none");
    expect(retryAfterBucket(-5)).toBe("none");
  });

  it("maps positive waits to their coarse bucket", () => {
    expect(retryAfterBucket(5)).toBe("<10s");
    expect(retryAfterBucket(9)).toBe("<10s");
    expect(retryAfterBucket(10)).toBe("10-60s");
    expect(retryAfterBucket(59)).toBe("10-60s");
    expect(retryAfterBucket(60)).toBe("1-5m");
    expect(retryAfterBucket(299)).toBe("1-5m");
    expect(retryAfterBucket(300)).toBe("5-15m");
    expect(retryAfterBucket(899)).toBe("5-15m");
    expect(retryAfterBucket(900)).toBe("15m+");
    expect(retryAfterBucket(3600)).toBe("15m+");
  });

  it("guards non-finite input to `none` (defensive; the guard only passes finite seconds)", () => {
    expect(retryAfterBucket(Number.NaN)).toBe("none");
    expect(retryAfterBucket(Number.POSITIVE_INFINITY)).toBe("none");
  });
});

describe("RATE_LIMIT_ACTIONS", () => {
  it("has the eight guarded actions, unique and stable", () => {
    expect(RATE_LIMIT_ACTIONS).toHaveLength(8);
    expect(new Set(RATE_LIMIT_ACTIONS).size).toBe(8);
  });
});
