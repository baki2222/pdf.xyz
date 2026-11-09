import { describe, expect, it } from "vitest";
import { cappedPixelRatio } from "./editor/page-render";
import { currentPage, layoutPages } from "./view-layout";
import {
  CSS_PX_PER_PT,
  MAX_CANVAS_PIXELS,
  MAX_CANVAS_SIDE,
  MAX_ZOOM,
  MIN_FIT_ZOOM,
  MIN_ZOOM,
  VIEWER_LIVE_PAGES,
  VIEWER_PRINT_DPI,
  VIEWER_PRINT_MAX_PAGES,
  VIEWER_PRINT_MAX_PIXELS,
  VIEWER_PRINT_MAX_SIDE,
  ZOOM_STEPS,
  canvasSize,
  fitZoom,
  liveWindow,
  printPlan,
  quarterTurn,
  readingAnchor,
  scaleOf,
  scrollForAnchor,
  scrollForPage,
  stepZoom,
  turnFractionRect,
  turnedSize,
  viewerRenderScale,
  visibleRange,
} from "./viewer-geometry";

const LETTER = { width: 612, height: 792 };

describe("viewerRenderScale: a hard cap on every canvas, with no floor", () => {
  /** Every page side 1..14,400 pt (PDF's own limit) the loop tries. */
  const SIDES = [1, 10, 72, 612, 792, 1_224, 2_384, 3_370, 5_000, 14_400];
  const passes = (
    ratioOf: (w: number, h: number, dpr: number) => number,
  ): string[] => {
    const failures: string[] = [];
    for (const w of SIDES)
      for (const h of SIDES)
        for (const zoom of [MIN_FIT_ZOOM, ...ZOOM_STEPS])
          for (const dpr of [1, 2, 3]) {
            const cssW = w * scaleOf(zoom);
            const cssH = h * scaleOf(zoom);
            const r = ratioOf(cssW, cssH, dpr);
            const { width, height } = canvasSize(cssW, cssH, r);
            if (
              width * height > MAX_CANVAS_PIXELS ||
              Math.max(width, height) > MAX_CANVAS_SIDE
            )
              failures.push(`${w}x${h} pt @${zoom} dpr${dpr}`);
          }
    return failures;
  };

  it("holds every size x every zoom x device ratio 1-3 within the area and side caps", () => {
    expect(passes(viewerRenderScale)).toEqual([]);
  });

  it("positive control: the editor's area-only ratio fails the same loop (a long thin page at 400%)", () => {
    // The predicate is not blind: cappedPixelRatio bounds the AREA only, so
    // a 14,400 x 100 pt strip at 400% is 47,923 device px long.
    const failures = passes(cappedPixelRatio);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures).toContain("14400x10 pt @4 dpr1");
  });

  it("keeps the device's own ratio when the canvas fits, and never goes above 3", () => {
    expect(viewerRenderScale(800, 1000, 2)).toBe(2);
    expect(viewerRenderScale(800, 1000, 5)).toBe(3);
    expect(viewerRenderScale(800, 1000, 0)).toBe(1);
  });

  it("has no floor: A0 at 400% on a 3x screen is drawn below 1 device px per CSS px", () => {
    const cssW = 2_384 * scaleOf(MAX_ZOOM);
    const cssH = 3_370 * scaleOf(MAX_ZOOM);
    const r = viewerRenderScale(cssW, cssH, 3);
    expect(r).toBeLessThan(0.5);
    const { width, height } = canvasSize(cssW, cssH, r);
    // Reaches the cap rather than undershooting it by a factor.
    expect(width * height).toBeGreaterThan(MAX_CANVAS_PIXELS * 0.99);
  });
});

describe("zoom ladder and fit", () => {
  it("steps along the shared ladder from a step or from between steps", () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(0.34, 1)).toBe(0.5);
    expect(stepZoom(1.1, -1)).toBe(1);
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });

  it("fits a Letter page's width, or all of it, inside the column padding", () => {
    const w = fitZoom("width", 800, 600, LETTER);
    expect(LETTER.width * w * CSS_PX_PER_PT).toBeCloseTo(800 - 32, 5);
    const p = fitZoom("page", 800, 600, LETTER);
    expect(LETTER.height * p * CSS_PX_PER_PT).toBeCloseTo(600 - 32, 5);
    expect(p).toBeLessThan(w);
  });

  it("may go below the manual minimum on a phone, never below the fit minimum", () => {
    expect(fitZoom("width", 360, 640, LETTER)).toBeLessThan(MIN_ZOOM);
    expect(fitZoom("width", 40, 640, { width: 14_400, height: 10 })).toBe(
      MIN_FIT_ZOOM,
    );
  });

  it("turns: a quarter turn swaps the sides, four come back", () => {
    expect(turnedSize(LETTER, 90)).toEqual({ width: 792, height: 612 });
    expect(turnedSize(LETTER, 180)).toEqual(LETTER);
    let t: 0 | 90 | 180 | 270 = 0;
    for (let i = 0; i < 4; i++) t = quarterTurn(t, 1);
    expect(t).toBe(0);
    expect(quarterTurn(0, -1)).toBe(270);
  });
});

describe("the visible window: only visible pages and one each side hold canvases", () => {
  const sizes = Array.from({ length: 100 }, () => LETTER);
  const { slots } = layoutPages(sizes, scaleOf(1));
  const pageH = slots[0]!.height;

  it("finds the pages any part of which is in view", () => {
    expect(visibleRange(slots, 0, pageH / 2)).toEqual({ first: 0, last: 0 });
    const top = slots[10]!.top + pageH - 5;
    expect(visibleRange(slots, top, pageH)).toEqual({ first: 10, last: 11 });
    // Past the end: the last page.
    expect(visibleRange(slots, 1e9, 500)).toEqual({ first: 99, last: 99 });
  });

  it("adds one page each side, clipped to the document", () => {
    expect(liveWindow(slots, slots[10]!.top, pageH / 2, 10)).toEqual([
      9, 10, 11,
    ]);
    expect(liveWindow(slots, 0, pageH / 2, 0)).toEqual([0, 1]);
    expect(liveWindow(slots, slots[99]!.top, pageH, 99)).toEqual([98, 99]);
  });

  it("never holds more than VIEWER_LIVE_PAGES canvases, kept around the current page", () => {
    const tiny = layoutPages(sizes, scaleOf(MIN_FIT_ZOOM)).slots;
    const all = liveWindow(tiny, tiny[50]!.top, 100_000, 50);
    expect(all.length).toBe(VIEWER_LIVE_PAGES);
    expect(all).toContain(50);
    // Contiguous.
    expect(all.at(-1)! - all[0]!).toBe(VIEWER_LIVE_PAGES - 1);
    // Every window over a full scroll of the document is bounded.
    for (let y = 0; y < 100 * pageH; y += pageH / 3) {
      expect(liveWindow(slots, y, 3 * pageH, 0).length).toBeLessThanOrEqual(
        VIEWER_LIVE_PAGES,
      );
    }
  });
});

describe("zoom keeps the reading position", () => {
  const sizes = [LETTER, { width: 842, height: 595 }, LETTER, LETTER];
  it("puts the same page, the same distance down it, back under the view's top", () => {
    const before = layoutPages(sizes, scaleOf(1)).slots;
    const scrollTop = before[2]!.top + before[2]!.height * 0.4;
    const anchor = readingAnchor(before, scrollTop);
    expect(anchor.index).toBe(2);
    expect(anchor.fraction).toBeCloseTo(0.4, 6);
    for (const zoom of ZOOM_STEPS) {
      const after = layoutPages(sizes, scaleOf(zoom)).slots;
      const y = scrollForAnchor(after, anchor);
      const again = readingAnchor(after, y);
      expect(again.index).toBe(2);
      expect(again.fraction).toBeCloseTo(0.4, 6);
    }
  });

  it("negative control: keeping the scroll offset instead lands on another page", () => {
    const before = layoutPages(sizes, scaleOf(1)).slots;
    const scrollTop = before[2]!.top + before[2]!.height * 0.4;
    const after = layoutPages(sizes, scaleOf(2)).slots;
    expect(readingAnchor(after, scrollTop).index).not.toBe(2);
  });

  it("scrolls a page into view from its top, where the page number reads it", () => {
    const slots = layoutPages(sizes, scaleOf(1)).slots;
    for (const i of [0, 1, 2, 3]) {
      expect(currentPage(slots, scrollForPage(slots, i), 600)).toBe(i);
    }
  });
});

describe("turnFractionRect places an unturned rectangle on the turned sheet", () => {
  const r = { left: 0.1, top: 0.2, width: 0.3, height: 0.1 };
  it("maps each corner the way a clockwise turn moves it", () => {
    expect(turnFractionRect(r, 0)).toEqual(r);
    // Clockwise 90: (x, y) -> (1 - y, x).
    const t = turnFractionRect(r, 90);
    expect(t.left).toBeCloseTo(0.7, 9);
    expect(t.top).toBeCloseTo(0.1, 9);
    expect(t.width).toBeCloseTo(0.1, 9);
    expect(t.height).toBeCloseTo(0.3, 9);
    // Four turns compose to none.
    let x = r;
    for (const _ of [0, 1, 2, 3]) x = turnFractionRect(x, 90);
    expect(x.left).toBeCloseTo(r.left, 9);
    expect(x.top).toBeCloseTo(r.top, 9);
    // 90 then 180 is 270.
    const a = turnFractionRect(turnFractionRect(r, 90), 180);
    const b = turnFractionRect(r, 270);
    expect(a.left).toBeCloseTo(b.left, 9);
    expect(a.top).toBeCloseTo(b.top, 9);
  });
});

describe("printPlan: the pages one print sends, and why it stops", () => {
  it("sends a short document whole, at the stated resolution", () => {
    const plan = printPlan([LETTER, LETTER]);
    expect(plan.stoppedBy).toBeNull();
    expect(plan.pages).toEqual([
      { index: 0, width: 1275, height: 1650 },
      { index: 1, width: 1275, height: 1650 },
    ]);
    expect(1275).toBe(Math.floor((612 / 72) * VIEWER_PRINT_DPI));
  });

  it("stops at the page cap, saying so (A5 pages, small enough to reach it)", () => {
    const a5 = { width: 420, height: 595 };
    const plan = printPlan(Array.from({ length: 80 }, () => a5));
    expect(plan.pages.length).toBe(VIEWER_PRINT_MAX_PAGES);
    expect(plan.stoppedBy).toBe("pages");
  });

  it("stops at the pixel budget first on Letter pages (47 of them), and never passes it", () => {
    const letters = printPlan(Array.from({ length: 80 }, () => LETTER));
    expect(letters).toMatchObject({ stoppedBy: "pixels" });
    expect(letters.pages.length).toBe(47);
    const a3 = { width: 842, height: 1191 };
    const plan = printPlan(Array.from({ length: 80 }, () => a3));
    expect(plan.stoppedBy).toBe("pixels");
    const total = plan.pages.reduce((n, p) => n + p.width * p.height, 0);
    expect(total).toBeLessThanOrEqual(VIEWER_PRINT_MAX_PIXELS);
    expect(plan.pages.length).toBeLessThan(VIEWER_PRINT_MAX_PAGES);
  });

  it("draws a huge page smaller rather than past the side cap, and always sends page 1", () => {
    const plan = printPlan([{ width: 14_400, height: 14_400 }]);
    expect(plan.pages.length).toBe(1);
    expect(plan.pages[0]!.width).toBeLessThanOrEqual(VIEWER_PRINT_MAX_SIDE);
  });
});
