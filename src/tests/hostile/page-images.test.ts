import { describe, expect, test } from "vitest";
import {
  PAGE_IMAGES_NOTE,
  RASTER_MAX_PAGE_IMAGE_PIXELS,
  pageImagesTooLargeMessage,
} from "@/lib/pdf/pdfjs-guard";
import { AUTO_CROP_PAD_PT } from "@/lib/pdf/auto-crop";
import { runBounded, type BoundedOutcome } from "./bounded";

// The per-page image budget (`RASTER_MAX_PAGE_IMAGE_PIXELS`), on every
// client render path, each case in a child process with a hard kill: a
// page of ten 49 MP images (each within the per-image budget) drew for
// 106 s in the editor before it (PR #306's measurement), and decoded about
// 2 GB. Every page in these fixtures is 600 x 600 pt; images sit in a grid
// from (50, 50) (./page-images.fixtures.ts).

/**
 * What one case may ADD to the child's resident memory, MB, after pdf.js
 * and the canvas are warmed (./memory.ts). A 49 MP image decodes to 196 MB
 * of RGBA, ten of them to 1.96 GB; CO-08's 100 MP image to 400 MB.
 * Measured after the fix (Windows, Node 24, max-rss): 4-101 MB on the
 * refused, noted and placed cases.
 */
const GROWTH_MB = 300;
const CHILD = "src/tests/hostile/page-images.child.ts";

function settled(r: BoundedOutcome): Record<string, unknown> {
  expect(r, JSON.stringify(r)).toMatchObject({ kind: "settled" });
  return (r as { value: Record<string, unknown> }).value;
}

const run = (c: string, ms: number) =>
  runBounded(CHILD, [c], ms, { maxOldSpaceMb: 2048 }).then(settled);

describe("a page whose images together pass the page budget reaches an outcome in bounded time and memory", () => {
  test("the budget is the per-image one: a page never costs more than the worst single image already admitted", () => {
    expect(RASTER_MAX_PAGE_IMAGE_PIXELS).toBe(50_000_000);
    // The copy states the figure from the constant.
    expect(pageImagesTooLargeMessage(3)).toContain("Page 3 ");
    expect(pageImagesTooLargeMessage(3)).toContain(
      `${RASTER_MAX_PAGE_IMAGE_PIXELS / 1e6} megapixels`,
    );
  });

  test("editor (preview): ten 49 MP images on one page draw a note, in seconds, never decoding them", async () => {
    const v = await run("editor-10x49", 60_000);
    expect(v.pages).toEqual([{ kind: "note", inked: false }]);
    expect(Math.max(...(v.pageMs as number[]))).toBeLessThan(10_000);
    expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
  }, 90_000);

  test("editor positive control: ONE 49 MP image on a page is still drawn, ink and all", async () => {
    // Measured 2026-11-14 (Windows, Node 24): 20-30 s for the decode alone.
    const v = await run("editor-1x49", 150_000);
    expect(v.pages).toEqual([{ kind: "page", inked: true }]);
  }, 180_000);

  test("viewer (preview): the same page is a note", async () => {
    const v = await run("viewer-10x49", 60_000);
    expect(v.pages).toEqual([{ kind: "note", inked: false }]);
    expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
  }, 90_000);

  test("PDF to JPG (output): the page is refused by number, with the limit, typed, before anything is decoded", async () => {
    const v = await run("raster-10x49", 60_000);
    expect(v.error).toEqual({
      name: "PdfEngineError",
      message: pageImagesTooLargeMessage(1),
    });
    expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
  }, 90_000);

  test("output positive control: one 49 MP image on a page is written", async () => {
    const v = await run("raster-1x49", 150_000);
    expect(v).toMatchObject({ ok: true, rendered: [0] });
  }, 180_000);

  test("a mixed document: only page 2 is past the budget; pages 1 and 3 draw as before", async () => {
    const editor = await run("editor-mixed", 90_000);
    // Page 3's own 9 MP image is drawn (inked): only page 2 is a note.
    expect(editor.pages).toEqual([
      { kind: "page", inked: false },
      { kind: "note", inked: false },
      { kind: "page", inked: true },
    ]);
    const thumbs = await run("thumbs-mixed", 90_000);
    expect(thumbs.tiles).toEqual([
      { drawn: true, note: null },
      { drawn: true, note: PAGE_IMAGES_NOTE },
      { drawn: true, note: null },
    ]);
    const raster = await run("raster-mixed", 90_000);
    expect(raster.error).toEqual({
      name: "PdfEngineError",
      message: pageImagesTooLargeMessage(2),
    });
    // The pages around it are written when they are the pages asked for.
    const others = await run("raster-mixed-others", 90_000);
    expect(others).toMatchObject({ ok: true, rendered: [0, 2] });
  }, 400_000);

  test("Auto-crop on the mixed document: page 2's images are placed, not decoded; pages 1 and 3 crop as before", async () => {
    const v = await run("autocrop-mixed", 90_000);
    const plan = v.plan as {
      perPage: ({ top: number; left: number; right: number } | null)[];
      whole: number[];
    };
    expect(plan.whole).toEqual([]);
    // Page 2: ten images in a 4-wide grid of 125-pt cells from (50, 50):
    // the content reaches x 50..550 and up to y = 50 + 3 x 125 = 425.
    expect(plan.perPage[1]).toMatchObject({
      left: 50 - AUTO_CROP_PAD_PT,
      right: 600 - 550 - AUTO_CROP_PAD_PT,
    });
    // One analysis pixel is 600 / 420 = 1.43 pt: the edge lands within it,
    // never inside the content.
    const top = 600 - 425 - AUTO_CROP_PAD_PT;
    expect(plan.perPage[1]!.top).toBeLessThanOrEqual(top);
    expect(plan.perPage[1]!.top).toBeGreaterThan(top - 600 / 420);
    // Page 3: its own image, drawn and found as ink.
    expect(plan.perPage[2]).toMatchObject({
      top: 600 - 550 - AUTO_CROP_PAD_PT,
      left: 50 - AUTO_CROP_PAD_PT,
    });
    // Page 1: only its label.
    expect(plan.perPage[0]!.top).toBeGreaterThan(500);
    expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
  }, 120_000);
});

describe("long scans and shared structures stay unaffected", () => {
  test("120 pages of one image each, one shared /Resources, object streams: every page mapped under the budget", async () => {
    const v = await run("preflight-long-scan", 60_000);
    // Health: the map was built (59 MP in all is past the page budget) and
    // found every page through the object streams.
    expect(v).toMatchObject({
      ok: true,
      mapped: 120,
      incomplete: null,
      heaviest: 700 * 700,
    });
  }, 90_000);

  test("...and every page is drawn, none noted", async () => {
    const v = await run("thumbs-long-scan", 180_000);
    const tiles = v.tiles as { drawn: boolean; note: string | null }[];
    expect(tiles).toHaveLength(120);
    expect(tiles.filter((t) => !t.drawn || t.note !== null)).toEqual([]);
  }, 240_000);

  test("...and written", async () => {
    const v = await run("raster-long-scan", 120_000);
    expect(v).toMatchObject({ ok: true, rendered: [0, 59, 119] });
  }, 180_000);

  test("forms painting one image four times: it counts once (pdf.js decodes it once per page), and the page is drawn", async () => {
    const p = await run("preflight-forms-twice", 60_000);
    // 16 MP once, not 64 MP; the other page is 36 MP.
    expect(p).toMatchObject({ mapped: 2, weights: [16_000_000, 36_000_000] });
    const v = await run("editor-forms-twice", 120_000);
    expect(v.pages).toEqual([{ kind: "page", inked: true }]);
  }, 200_000);
});

describe("Auto-crop never decodes an image past its budget, and never crops it away", () => {
  test("CO-08: a 100 MP image's placement is content: the crop keeps it, and memory shows it was never decoded", async () => {
    const v = await run("autocrop-co08", 60_000);
    const plan = v.plan as {
      perPage: { top: number; left: number; right: number; bottom: number }[];
      whole: number[];
    };
    // The image fills [50, 550] x [50, 550]; the label sits below it at
    // y = 20. Without the placement, the crop kept only the label.
    expect(plan.whole).toEqual([]);
    expect(plan.perPage[0]).toMatchObject({
      top: 600 - 550 - AUTO_CROP_PAD_PT,
      left: 50 - AUTO_CROP_PAD_PT,
      right: 600 - 550 - AUTO_CROP_PAD_PT,
    });
    expect(plan.perPage[0]!.bottom).toBeLessThan(20);
    // 100 MP decoded is 400 MB of RGBA at least.
    expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
  }, 90_000);

  test("CO-08 inside a tiling pattern: its placement is not followed, so the page is kept whole and named", async () => {
    const v = await run("autocrop-co08-pattern", 60_000);
    expect(v.plan).toMatchObject({ perPage: [null], whole: [0] });
    expect(v.growthMb as number).toBeLessThan(GROWTH_MB);
  }, 90_000);
});
