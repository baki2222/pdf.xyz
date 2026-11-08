import { describe, expect, it } from "vitest";
import {
  LAZY_SCROLL_FRAME_WAIT_MS,
  LAZY_SCROLL_MAX_MS,
  LAZY_SCROLL_MAX_STEPS,
  LAZY_SCROLL_SETTLE_MS,
  LAZY_SCROLL_STEP_MS,
  lazyScrollPositions,
  lazyScrollTo,
} from "./lazy-scroll";
import { VIRTUAL_TIME_BUDGET_MS } from "./native";
import { resolveNativeHtmlRenderConfig } from "./native-config";

describe("the scroll pass's stops (audit webpage-to-pdf#4)", () => {
  it("one screen further each step, ending with the last screen in view", () => {
    expect(lazyScrollPositions(3000, 800)).toEqual([800, 1600, 2200]);
    expect(lazyScrollPositions(2400, 800)).toEqual([800, 1600]);
  });

  it("nothing for a page that fits one screen, or figures it cannot use", () => {
    expect(lazyScrollPositions(800, 800)).toEqual([]);
    expect(lazyScrollPositions(500, 800)).toEqual([]);
    for (const [h, v] of [
      [undefined, 800],
      [3000, 0],
      [Number.NaN, 800],
      ["3000", 800],
    ] as const)
      expect(lazyScrollPositions(h, v)).toEqual([]);
  });

  it("an endless page stops at the step cap", () => {
    const stops = lazyScrollPositions(1e9, 800);
    expect(stops).toHaveLength(LAZY_SCROLL_MAX_STEPS);
    expect(stops.at(-1)).toBe(LAZY_SCROLL_MAX_STEPS * 800);
  });

  it("scrolls to a whole, non-negative pixel", () => {
    expect(lazyScrollTo(12.6)).toBe("window.scrollTo(0, 13)");
    expect(lazyScrollTo(-5)).toBe("window.scrollTo(0, 0)");
  });
});

describe("the scroll pass is bounded", () => {
  it("its page time is the steps plus the settle", () => {
    expect(LAZY_SCROLL_MAX_MS).toBe(
      LAZY_SCROLL_MAX_STEPS * LAZY_SCROLL_STEP_MS + LAZY_SCROLL_SETTLE_MS,
    );
  });

  /*
   * A SECOND, independent bound (CLAUDE.md rule 3): the render's own
   * timeout. The pass's worst case — every frame wait expiring, plus all
   * its page time and the first budget run in real time — must leave most
   * of the default timeout for loading and printing.
   */
  it("its worst case fits well inside the default render timeout", () => {
    const { timeoutMs } = resolveNativeHtmlRenderConfig({});
    const worst =
      (LAZY_SCROLL_MAX_STEPS + 1) * LAZY_SCROLL_FRAME_WAIT_MS +
      LAZY_SCROLL_MAX_MS +
      VIRTUAL_TIME_BUDGET_MS;
    expect(worst).toBeLessThanOrEqual(timeoutMs / 2);
  });
});
