import { describe, expect, it } from "vitest";
import {
  ANNOUNCE_EVERY_FILE_UP_TO,
  ANNOUNCE_STRIDE,
  announcesSettle,
} from "./announce";

const spoken = (total: number, failedAt: number[] = []) =>
  Array.from({ length: total }, (_, i) => i + 1).filter((n) =>
    announcesSettle(n, total, failedAt.includes(n)),
  );

describe("announcesSettle — the live region's policy", () => {
  it("speaks every settle up to the small-batch size", () => {
    expect(spoken(ANNOUNCE_EVERY_FILE_UP_TO)).toHaveLength(
      ANNOUNCE_EVERY_FILE_UP_TO,
    );
    expect(spoken(3)).toEqual([1, 2, 3]);
  });

  it("past it, speaks every stride-th settle plus every failure", () => {
    const total = ANNOUNCE_EVERY_FILE_UP_TO + 10; // 20
    expect(spoken(total)).toEqual(
      Array.from(
        { length: total / ANNOUNCE_STRIDE },
        (_, i) => (i + 1) * ANNOUNCE_STRIDE,
      ),
    );
    expect(spoken(total, [3, 7])).toEqual([3, 5, 7, 10, 15, 20]);
  });

  it("never speaks a settle outside the batch", () => {
    expect(announcesSettle(0, 3, false)).toBe(false);
    expect(announcesSettle(4, 3, true)).toBe(false);
  });
});
