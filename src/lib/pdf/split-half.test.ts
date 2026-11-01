// @native-canvas
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { mergePdfs, PdfEncryptedError, PdfEngineError } from "./engine";
import {
  pagesToSplit,
  splitHalfOutputName,
  splitPagesInHalf,
  type SplitDirection,
  type SplitOrder,
} from "./split-half";
import {
  colourGrid,
  gridDistance,
  renderPdfPages,
  type RenderedPage,
} from "@/tests/pdf-render";
import {
  ownerOnlyEncryptedPdf,
  userPasswordEncryptedPdf,
} from "@/tests/encrypted-pdf-fixture";

/**
 * Split Pages in Half, judged by what a reader receives: the SAVED file,
 * opened with pdf.js. The oracle is never this module's geometry — it is the
 * SOURCE page rendered by pdf.js, cut in half in pixel space. Each output half
 * must look like that half of the source as a reader sees it, on every
 * `/Rotate` and box shape, so a half taken from the wrong content axis (the
 * `/Rotate 90` trap) or from the uncropped sheet shows up as wrong colours.
 */

const require = createRequire(import.meta.url);
type Pdfjs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<Pdfjs> | null = null;
function pdfjs(): Promise<Pdfjs> {
  pdfjsPromise ??= import(
    /* @vite-ignore */ pathToFileURL(
      require.resolve("pdfjs-dist/legacy/build/pdf.mjs"),
    ).href
  ) as Promise<Pdfjs>;
  return pdfjsPromise;
}

/** Each page's displayed size and text, read the way a viewer reads it. */
async function asDisplayed(
  bytes: Uint8Array,
): Promise<{ width: number; height: number; text: string }[]> {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  const out = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    out.push({ width: viewport.width, height: viewport.height, text });
  }
  await task.destroy();
  return out;
}

const ROTATIONS = [0, 90, 180, 270] as const;

/** Box shapes in content space: [x0, y0, x1, y1]. */
const SHAPES: {
  label: string;
  media: [number, number, number, number];
  crop?: [number, number, number, number];
}[] = [
  { label: "landscape spread at origin", media: [0, 0, 800, 560] },
  { label: "offset MediaBox", media: [100, 200, 900, 760] },
  {
    label: "inset CropBox",
    media: [0, 0, 800, 560],
    crop: [40, 60, 760, 500],
  },
];

/** 4×4 cells, every one a different colour, over the page's VISIBLE box. */
const CELLS = 4;
const cellColour = (col: number, row: number) =>
  rgb(col / 3, row / 3, (col + row) % 2);

async function gridPage(
  doc: PDFDocument,
  rotation: number,
  shape: (typeof SHAPES)[number],
): Promise<void> {
  const [x0, y0, x1, y1] = shape.media;
  const page = doc.addPage([x1 - x0, y1 - y0]);
  page.setMediaBox(x0, y0, x1 - x0, y1 - y0);
  const [vx0, vy0, vx1, vy1] = shape.crop ?? shape.media;
  if (shape.crop) page.setCropBox(vx0, vy0, vx1 - vx0, vy1 - vy0);
  const w = (vx1 - vx0) / CELLS;
  const h = (vy1 - vy0) / CELLS;
  for (let col = 0; col < CELLS; col += 1) {
    for (let row = 0; row < CELLS; row += 1) {
      page.drawRectangle({
        x: vx0 + col * w,
        y: vy0 + row * h,
        width: w,
        height: h,
        color: cellColour(col, row),
      });
    }
  }
  page.setRotation(degrees(rotation));
}

async function gridPdf(
  rotation: number,
  shape: (typeof SHAPES)[number],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  await gridPage(doc, rotation, shape);
  return doc.save();
}

/** Normalized rects of the SOURCE render that each output half must show. */
const HALF_RECT = {
  left: [0, 0, 0.5, 1],
  right: [0.5, 0, 1, 1],
  top: [0, 0, 1, 0.5],
  bottom: [0, 0.5, 1, 1],
} as const satisfies Record<string, [number, number, number, number]>;

/** Colour cells per side of a compared grid; 2 per source cell. */
const GRID = 8;
/** A cell differs from its neighbours by ≥ 85 in some channel; edges blur. */
const SAME = 30;

function looksLike(
  output: RenderedPage,
  source: RenderedPage,
  rect: readonly [number, number, number, number],
): number {
  return gridDistance(
    colourGrid(output, GRID),
    colourGrid(source, GRID, [...rect]),
  );
}

/**
 * The output order each choice must give, typed here and NOT read from the
 * engine's own `halvesInOrder` — an oracle that asked the engine which half
 * comes first would agree with a swapped engine (it did, on the first
 * mutation run: this test stayed green with the halves swapped).
 */
const CASES: {
  direction: SplitDirection;
  order: SplitOrder;
  halves: [keyof typeof HALF_RECT, keyof typeof HALF_RECT];
}[] = [
  { direction: "left-right", order: "left-first", halves: ["left", "right"] },
  { direction: "left-right", order: "right-first", halves: ["right", "left"] },
  { direction: "top-bottom", order: "left-first", halves: ["top", "bottom"] },
];

describe("splitPagesInHalf as a viewer displays the result", () => {
  it("the instrument tells the halves apart, and sees a wrong half (controls)", async () => {
    const input = await gridPdf(90, SHAPES[0]!);
    const [source] = await renderPdfPages(input, 320);
    // Health check: the fixture's halves really differ, in both cuts.
    expect(looksLikeRects(source!, HALF_RECT.left, HALF_RECT.right)).toBe(true);
    expect(looksLikeRects(source!, HALF_RECT.top, HALF_RECT.bottom)).toBe(true);

    // The assertion the engine is held to below, run over halves written BY
    // HAND, with no engine involved: on an unrotated spread the content's
    // left half is the displayed left half, so the right box passes and the
    // swapped box (the right half, offered as the left page) must FAIL.
    const flat = await gridPdf(0, SHAPES[0]!);
    const [flatSource] = await renderPdfPages(flat, 320);
    const byHand = async (x: number) => {
      const doc = await PDFDocument.load(flat);
      doc.getPage(0).setCropBox(x, 0, 400, 560);
      return (await renderPdfPages(await doc.save(), 320))[0]!;
    };
    expect(
      looksLike(await byHand(0), flatSource!, HALF_RECT.left),
    ).toBeLessThan(SAME);
    expect(
      looksLike(await byHand(400), flatSource!, HALF_RECT.left),
    ).toBeGreaterThan(SAME);

    // And a box taken from the CONTENT's left half — what a split that
    // ignored /Rotate would write — fails it too.
    const naive = await PDFDocument.load(input);
    const page = naive.getPage(0);
    const media = page.getMediaBox();
    page.setCropBox(media.x, media.y, media.width / 2, media.height);
    const [unrotated] = await renderPdfPages(await naive.save(), 320);
    expect(looksLike(unrotated!, source!, HALF_RECT.left)).toBeGreaterThan(
      SAME,
    );
  });

  it("each half shows that half of the page, on every rotation, box shape and order", async () => {
    let checked = 0;
    for (const rotation of ROTATIONS) {
      for (const shape of SHAPES) {
        const input = await gridPdf(rotation, shape);
        const [source] = await renderPdfPages(input, 320);
        const [shown] = await asDisplayed(input);
        for (const { direction, order, halves } of CASES) {
          const where = `rotate ${rotation}, ${shape.label}, ${direction} ${order}`;
          const result = await splitPagesInHalf(input, { direction, order });
          expect(result.pageCount, where).toBe(2);
          expect(result.splitPages, where).toBe(1);

          const sizes = await asDisplayed(result.bytes);
          expect(sizes, where).toHaveLength(2);
          for (const half of sizes) {
            const want =
              direction === "left-right"
                ? { width: shown!.width / 2, height: shown!.height }
                : { width: shown!.width, height: shown!.height / 2 };
            expect(half.width, where).toBeCloseTo(want.width, 3);
            expect(half.height, where).toBeCloseTo(want.height, 3);
          }

          const rendered = await renderPdfPages(result.bytes, 320);
          rendered.forEach((page, n) => {
            const distance = looksLike(page, source!, HALF_RECT[halves[n]!]);
            expect(distance, `${where}: output page ${n + 1}`).toBeLessThan(
              SAME,
            );
          });
          checked += 1;
        }
      }
    }
    expect(checked).toBe(ROTATIONS.length * SHAPES.length * CASES.length);
  });

  it("right page first puts the right half first (a right-to-left book)", async () => {
    const input = await gridPdf(0, SHAPES[0]!);
    const [source] = await renderPdfPages(input, 320);
    const rtl = await renderPdfPages(
      (
        await splitPagesInHalf(input, {
          direction: "left-right",
          order: "right-first",
        })
      ).bytes,
      320,
    );
    expect(looksLike(rtl[0]!, source!, HALF_RECT.right)).toBeLessThan(SAME);
    expect(looksLike(rtl[1]!, source!, HALF_RECT.left)).toBeLessThan(SAME);
  });

  it("covers left whole stay whole, in place, and the pages between are split in order", async () => {
    const doc = await PDFDocument.create();
    for (const rotation of [0, 0, 90, 0]) {
      await gridPage(doc, rotation, SHAPES[0]!);
    }
    const input = await doc.save();
    const sources = await renderPdfPages(input, 320);
    const shown = await asDisplayed(input);
    const result = await splitPagesInHalf(input, {
      direction: "left-right",
      order: "left-first",
      keepFirstWhole: true,
      keepLastWhole: true,
    });
    expect(result).toMatchObject({ sourcePages: 4, splitPages: 2 });
    expect(result.pageCount).toBe(6);

    const sizes = await asDisplayed(result.bytes);
    const rendered = await renderPdfPages(result.bytes, 320);
    // [source page, which part]: the output's pages in order.
    const plan: [number, keyof typeof HALF_RECT | "whole"][] = [
      [0, "whole"],
      [1, "left"],
      [1, "right"],
      [2, "left"],
      [2, "right"],
      [3, "whole"],
    ];
    expect(sizes).toHaveLength(plan.length);
    plan.forEach(([src, part], n) => {
      const where = `output page ${n + 1} (source ${src + 1}, ${part})`;
      const full = shown[src]!;
      expect(sizes[n]!.width, where).toBeCloseTo(
        part === "whole" ? full.width : full.width / 2,
        3,
      );
      expect(sizes[n]!.height, where).toBeCloseTo(full.height, 3);
      const rect = part === "whole" ? ([0, 0, 1, 1] as const) : HALF_RECT[part];
      expect(looksLike(rendered[n]!, sources[src]!, rect), where).toBeLessThan(
        SAME,
      );
    });
  });

  it("text stays text: each half's words are selectable, the other half's are out of view", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([800, 560]);
    page.drawText("LEFTWORD", { x: 100, y: 280, size: 24, font });
    page.drawText("RIGHTWORD", { x: 500, y: 280, size: 24, font });
    const result = await splitPagesInHalf(await doc.save(), {
      direction: "left-right",
      order: "left-first",
    });
    const [left, right] = await asDisplayed(result.bytes);
    expect(left!.text).toContain("LEFTWORD");
    expect(left!.text).not.toContain("RIGHTWORD");
    expect(right!.text).toContain("RIGHTWORD");
    expect(right!.text).not.toContain("LEFTWORD");

    // Hidden, not deleted (the page's disclosure): reset the crop box, as
    // any editor can, and the other half's words are back.
    const reopened = await PDFDocument.load(result.bytes);
    const first = reopened.getPage(0);
    const media = first.getMediaBox();
    first.setCropBox(media.x, media.y, media.width, media.height);
    const [reset] = await asDisplayed(await reopened.save());
    expect(reset!.text).toContain("RIGHTWORD");
    // And the MediaBox was never touched.
    expect(media.width).toBeCloseTo(800);
  });

  it("the two halves share one copy of the page's drawing (the file does not double)", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([800, 560]);
    // A heavy page: thousands of rectangles, so the drawing dominates the file.
    for (let i = 0; i < 4000; i += 1) {
      page.drawRectangle({
        x: (i * 37) % 780,
        y: (i * 53) % 540,
        width: 12,
        height: 12,
        color: rgb(((i * 7) % 10) / 10, ((i * 3) % 10) / 10, 0.5),
      });
    }
    const input = await doc.save();
    const output = await splitPagesInHalf(input, {
      direction: "left-right",
      order: "left-first",
    });
    // Positive control: the instrument sees a real second copy of a drawing.
    const twice = await mergePdfs([input, input]);
    expect(twice.byteLength / input.byteLength).toBeGreaterThan(1.8);
    expect(output.bytes.byteLength / input.byteLength).toBeLessThan(1.2);
  });
});

/** True when two rects of one render look different (fixture health). */
function looksLikeRects(
  page: RenderedPage,
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): boolean {
  return (
    gridDistance(
      colourGrid(page, GRID, [...a]),
      colourGrid(page, GRID, [...b]),
    ) > SAME
  );
}

describe("which pages are split", () => {
  it("all pages by default; covers and a list narrow it", () => {
    expect(pagesToSplit(4, {})).toEqual([0, 1, 2, 3]);
    expect(pagesToSplit(4, { keepFirstWhole: true })).toEqual([1, 2, 3]);
    expect(pagesToSplit(4, { keepLastWhole: true })).toEqual([0, 1, 2]);
    expect(
      pagesToSplit(4, { keepFirstWhole: true, keepLastWhole: true }),
    ).toEqual([1, 2]);
    expect(pagesToSplit(5, { pages: [3, 1, 1, 9, -1] })).toEqual([1, 3]);
  });

  it("refuses when nothing is left to split", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([800, 560]);
    await expect(
      splitPagesInHalf(await doc.save(), {
        direction: "left-right",
        order: "left-first",
        keepFirstWhole: true,
      }),
    ).rejects.toBeInstanceOf(PdfEngineError);
  });

  it("refuses encrypted files at open, restricted-only ones included, as Crop and Resize do", async () => {
    for (const bytes of [ownerOnlyEncryptedPdf(), userPasswordEncryptedPdf()]) {
      await expect(
        splitPagesInHalf(bytes, {
          direction: "left-right",
          order: "left-first",
        }),
      ).rejects.toBeInstanceOf(PdfEncryptedError);
    }
  });

  it("names the output in the house style", () => {
    expect(splitHalfOutputName("book.pdf")).toBe("book-halved.pdf");
  });
});
