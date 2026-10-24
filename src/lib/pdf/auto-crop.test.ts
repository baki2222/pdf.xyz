// @native-canvas
import { describe, expect, it } from "vitest";
import { PDFDocument, degrees, rgb } from "pdf-lib";
import {
  AUTO_CROP_LONG_SIDE_PX,
  AUTO_CROP_PAD_PT,
  appliedMargins,
  findInkBox,
  planAutoCrop,
  type AutoCropPlan,
  type InkBox,
} from "./auto-crop";
import { cropPdf, getPageSizes, type CropMargins } from "./crop";
import { renderPdfPages, type RenderedPage } from "@/tests/pdf-render";

/**
 * Auto-crop, judged the way a reader judges it: render a fixture whose white
 * margins are known, plan the crop from that render, crop, and render the
 * SAVED file again. The crop must keep every mark (the ink measured in the
 * output is the ink measured in the input) and must remove most of the white
 * (each margin cut is at least {@link MOST} of the known one). A blank page
 * stays as it was and is named, so the runner can say so.
 */

/** "Most of the white margin": the share of each known margin removed. */
const MOST = 0.8;

/**
 * The fixture's pages, each with the margins a reader sees around its ink
 * (points, displayed frame). Page 2 is blank; page 3 is stored landscape and
 * turned a quarter by /Rotate 90, so its displayed margins are its content
 * margins turned round (content left 100 shows on top, content top 50 on
 * the right, and so on — the mapping `toContentMargins` inverts).
 */
const KNOWN: (CropMargins | null)[] = [
  { top: 100, right: 60, bottom: 100, left: 60 },
  null,
  { top: 100, right: 50, bottom: 100, left: 50 },
  { top: 50, right: 130, bottom: 220, left: 50 },
];

async function fixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const black = rgb(0, 0, 0);
  // Page 1: 400×600, ink from (60,100) to (340,500), text inside it.
  const one = doc.addPage([400, 600]);
  one.drawRectangle({ x: 60, y: 100, width: 280, height: 400, color: black });
  // Page 2: blank.
  doc.addPage([400, 600]);
  // Page 3: stored 600×400, ink (100,50)–(500,350), shown turned.
  const three = doc.addPage([600, 400]);
  three.drawRectangle({ x: 100, y: 50, width: 400, height: 300, color: black });
  three.setRotation(degrees(90));
  // Page 4: lopsided margins, ink drawn as a thin outline so the box is
  // found from strokes, not from one solid block. A 2 pt border is centred
  // on its path, so the ink's outer edge is (50,220)–(270,550).
  const four = doc.addPage([400, 600]);
  four.drawRectangle({
    x: 51,
    y: 221,
    width: 218,
    height: 328,
    borderColor: rgb(0.3, 0.3, 0.3),
    borderWidth: 2,
  });
  return doc.save();
}

/** Analyse a render the way the runner does, then plan. */
async function plan(bytes: Uint8Array): Promise<AutoCropPlan> {
  const renders = await renderPdfPages(bytes, AUTO_CROP_LONG_SIDE_PX);
  const sizes = await getPageSizes(bytes);
  return planAutoCrop(
    renders.map((raster) => ({ ink: findInkBox(raster), raster })),
    sizes,
  );
}

/** The ink's extent on a rendered page, in points of that page. */
function inkPt(page: RenderedPage, size: { width: number; height: number }) {
  const ink = findInkBox(page) as InkBox;
  const sx = size.width / page.width;
  const sy = size.height / page.height;
  return {
    width: (ink.right - ink.left) * sx,
    height: (ink.bottom - ink.top) * sy,
    margins: {
      left: ink.left * sx,
      right: (page.width - ink.right) * sx,
      top: ink.top * sy,
      bottom: (page.height - ink.bottom) * sy,
    },
  };
}

const EDGES = ["top", "right", "bottom", "left"] as const;

describe("auto-crop on a fixture with known margins", () => {
  it("proposes per-page margins inside the white and keeps most of it out", async () => {
    const result = await plan(await fixture());
    expect(result.blank).toEqual([1]);
    expect(result.unread).toEqual([]);
    KNOWN.forEach((known, i) => {
      const got = result.perPage[i];
      if (!known) {
        expect(got, `page ${i + 1} is blank and stays uncropped`).toBeNull();
        return;
      }
      for (const edge of EDGES) {
        // Never into the ink (the pad is kept)…
        expect(got![edge], `page ${i + 1} ${edge}`).toBeLessThanOrEqual(
          known[edge] - AUTO_CROP_PAD_PT + 0.01,
        );
        // …and most of the white is gone.
        expect(got![edge], `page ${i + 1} ${edge}`).toBeGreaterThanOrEqual(
          known[edge] * MOST,
        );
      }
    });
  });

  it("the cropped file still shows every mark, close to its new edges", async () => {
    const input = await fixture();
    const result = await plan(input);
    const output = await cropPdf(input, {
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      perPage: appliedMargins(result, "per-page"),
    });
    const [beforeSizes, afterSizes] = [
      await getPageSizes(input),
      await getPageSizes(output),
    ];
    const before = await renderPdfPages(input, 1200);
    const after = await renderPdfPages(output, 1200);
    // One px at this resolution, in points, on the larger page side.
    const px = 600 / 1200;
    KNOWN.forEach((known, i) => {
      if (!known) {
        expect(afterSizes[i], "the blank page keeps its size").toEqual(
          beforeSizes[i],
        );
        expect(findInkBox(after[i]!)).toBeNull();
        return;
      }
      const was = inkPt(before[i]!, beforeSizes[i]!);
      const now = inkPt(after[i]!, afterSizes[i]!);
      // Every mark survives: the ink is as wide and as tall as it was.
      expect(now.width, `page ${i + 1} ink width`).toBeCloseTo(was.width, 0);
      expect(now.height, `page ${i + 1} ink height`).toBeCloseTo(was.height, 0);
      for (const edge of EDGES) {
        // The white left is about the pad: never less than half a pad (the
        // crop did not shave the ink), never much more (it did crop).
        expect(now.margins[edge], `page ${i + 1} ${edge}`).toBeGreaterThan(
          AUTO_CROP_PAD_PT / 2,
        );
        expect(now.margins[edge], `page ${i + 1} ${edge}`).toBeLessThan(
          known[edge] * (1 - MOST) + AUTO_CROP_PAD_PT + 4 * px,
        );
      }
    });
  });

  it("uniform: one box for every inked page, the smallest margin per edge", async () => {
    const result = await plan(await fixture());
    const applied = appliedMargins(result, "uniform");
    expect(
      applied[1],
      "a blank page stays uncropped in uniform too",
    ).toBeNull();
    const inked = result.perPage.filter((m): m is CropMargins => m !== null);
    for (const edge of EDGES) {
      const smallest = Math.min(...inked.map((m) => m[edge]));
      for (const i of [0, 2, 3]) expect(applied[i]![edge]).toBe(smallest);
    }
    // Health: the pages really disagree, so "uniform" is a real choice.
    expect(new Set(inked.map((m) => m.left)).size).toBeGreaterThan(1);
  });

  it("a document with no ink at all: nothing to crop, and the engine says so", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 300]);
    const bytes = await doc.save();
    const result = await plan(bytes);
    expect(result).toMatchObject({ blank: [0], uniform: null });
    await expect(
      cropPdf(bytes, {
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
        perPage: appliedMargins(result, "per-page"),
      }),
    ).rejects.toThrow(/white margin to crop/i);
  });
});

describe("findInkBox", () => {
  const page = (w: number, h: number, ink: [number, number][] = []) => {
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    for (const [x, y] of ink)
      data.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 3);
    return { width: w, height: h, data };
  };

  it("bounds the ink pixels, right and bottom exclusive", () => {
    expect(
      findInkBox(
        page(10, 8, [
          [2, 3],
          [7, 5],
        ]),
      ),
    ).toEqual({
      left: 2,
      top: 3,
      right: 8,
      bottom: 6,
    });
  });

  it("near-white is paper, not ink; a white page has none", () => {
    const pale = page(4, 4);
    pale.data.fill(240, 0, 3); // 15 below white: under the threshold
    expect(findInkBox(pale)).toBeNull();
    expect(findInkBox(page(4, 4))).toBeNull();
  });

  it("refuses a short buffer rather than calling the rest white", () => {
    expect(() =>
      findInkBox({ width: 4, height: 4, data: new Uint8ClampedArray(8) }),
    ).toThrow(/expected 64/);
  });
});
