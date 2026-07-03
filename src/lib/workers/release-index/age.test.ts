import { describe, expect, it } from "vitest";
import { ageBucket, ageInDays, instantToMs } from "./age";

const NOW = Date.parse("2026-07-03T00:00:00.000Z");
const days = (n: number) => NOW - n * 24 * 60 * 60 * 1000;
const hours = (n: number) => NOW - n * 60 * 60 * 1000;

describe("instantToMs", () => {
  it("parses a valid ISO instant deterministically", () => {
    expect(instantToMs("2026-07-03T00:00:00.000Z")).toBe(NOW);
  });

  it("is null for a non-string, empty, or unparseable value", () => {
    for (const bad of [undefined, null, 42, "", "   ", "not-a-date", {}]) {
      expect(instantToMs(bad as unknown)).toBeNull();
    }
  });
});

describe("ageBucket", () => {
  it("buckets increasing ages into the coarse ladder", () => {
    expect(ageBucket(NOW, hours(0.5))).toBe("<1h");
    expect(ageBucket(NOW, hours(5))).toBe("1-24h");
    expect(ageBucket(NOW, days(3))).toBe("1-7d");
    expect(ageBucket(NOW, days(20))).toBe("7-30d");
    expect(ageBucket(NOW, days(60))).toBe("30-90d");
    expect(ageBucket(NOW, days(120))).toBe("90d+");
  });

  it("is `future` for an instant after the clock (skew, surfaced honestly)", () => {
    expect(ageBucket(NOW, NOW + 60_000)).toBe("future");
  });

  it("is `unknown` for a null artifact instant or a non-finite clock", () => {
    expect(ageBucket(NOW, null)).toBe("unknown");
    expect(ageBucket(null, days(1))).toBe("unknown");
    expect(ageBucket(Number.NaN, days(1))).toBe("unknown");
  });

  it("bucket boundaries are inclusive of the lower bucket", () => {
    // exactly 1 hour → still under the 1-24h band start (>= 1h leaves <1h)
    expect(ageBucket(NOW, hours(1))).toBe("1-24h");
    // exactly 7 days → leaves 1-7d
    expect(ageBucket(NOW, days(7))).toBe("7-30d");
  });
});

describe("ageInDays", () => {
  it("floors the whole-day age for the retention comparison", () => {
    expect(ageInDays(NOW, days(0))).toBe(0);
    expect(ageInDays(NOW, days(1))).toBe(1);
    expect(ageInDays(NOW, hours(36))).toBe(1); // 1.5 days floors to 1
    expect(ageInDays(NOW, days(95))).toBe(95);
  });

  it("is null for a future instant (never over-age) or an unavailable instant", () => {
    expect(ageInDays(NOW, NOW + 60_000)).toBeNull();
    expect(ageInDays(NOW, null)).toBeNull();
    expect(ageInDays(null, days(1))).toBeNull();
  });
});
