// @vitest-environment node
/**
 * The paint is the redaction. Prove it reaches the pixels the encoder receives.
 *
 * `redactPdf` destroys content by rasterizing each page and painting the boxes
 * onto the canvas BEFORE it is encoded. Everything around that step was tested
 * — validation, the point→pixel mapping (`redactionRectToPixels`), the output
 * name — and the step itself was not: `paintRedactions`, the `onCanvas` hook
 * that calls it, the `page.index + 1` grouping that picks a page's boxes, and
 * the fill colour reaching `fillStyle`. The browser proof that claimed to cover
 * it (e2e/client-proof/cases.ts, "redact-pdf") measured ink the FIXTURE had
 * already drawn under the default box, so a no-op paint passed it too.
 *
 * This file drives the real `redactPdf` with a rasterizer that hands the real
 * `onCanvas` hook an in-memory pixel canvas, then reads that canvas — the exact
 * bitmap the product would encode. The render itself (pdfjs) needs a browser;
 * the paint does not, and the paint is what makes the output safe.
 *
 * The corpus is derived, not typed: the fills are the runner's own option list
 * (`REDACTION_FILL_OPTIONS`), and the box is the runner's own default draft
 * (`DEFAULT_REDACTION_DRAFT`) — the one every user who clicks "Add area" gets.
 * The expected pixel rectangle is computed here from first principles
 * (bottom-left points → top-left pixels), independently of
 * `redactionRectToPixels`, so a shared mistake cannot agree with itself.
 */
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  DEFAULT_REDACTION_DRAFT,
  REDACTION_FILL_OPTIONS,
  getRedactPageSizes,
  redactPdf,
  redactionFillHex,
  type RedactionFill,
  type RedactionRect,
} from "./redact";
import type { RasterizeOptions, RasterPage } from "./render";

/** A real 1×1 JPEG, so the rebuild step embeds a genuine image. */
const JPG_1X1 = Uint8Array.from(
  Buffer.from(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Ap//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IX//2gAMAwEAAgADAAAAEP/EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EFBQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EFBABAQAAAAAAAAAAAAAAAAAAARD/2gAIAQEAAT8Qf//Z",
    "base64",
  ),
);

type Rgb = readonly [number, number, number];

/**
 * What the "render" leaves on every page before the hook runs: a mid-grey that
 * is neither fill. A background equal to a fill would make that fill's check
 * vacuous — the health check below asserts it is not.
 */
const RENDERED: Rgb = [0x80, 0x80, 0x80];

function parseHex(style: string): Rgb {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(style);
  // Strict on purpose: a fillStyle this canvas cannot read must fail loudly,
  // not paint some default and let a colour assertion pass by accident.
  if (!match) throw new Error(`pixel canvas cannot parse fillStyle ${style}`);
  return [
    parseInt(match[1]!, 16),
    parseInt(match[2]!, 16),
    parseInt(match[3]!, 16),
  ];
}

/** The subset of a 2D canvas the paint path uses, backed by real pixels. */
class PixelCanvas {
  readonly pixels: Uint8ClampedArray;
  fillRectCalls = 0;
  constructor(
    readonly width: number,
    readonly height: number,
    background: Rgb,
  ) {
    this.pixels = new Uint8ClampedArray(width * height * 3);
    for (let i = 0; i < width * height; i++) this.pixels.set(background, i * 3);
  }
  getContext(kind: string) {
    if (kind !== "2d") return null;
    let fill: Rgb = [0, 0, 0];
    const paint = (x: number, y: number, w: number, h: number) =>
      this.paint(fill, x, y, w, h);
    return {
      set fillStyle(style: string) {
        fill = parseHex(style);
      },
      get fillStyle() {
        return `rgb(${fill.join(",")})`;
      },
      fillRect: paint,
    };
  }
  private paint(fill: Rgb, x: number, y: number, w: number, h: number) {
    this.fillRectCalls++;
    // Pixel (px, py) is covered when its centre lies inside the rect.
    const x0 = Math.max(0, Math.round(x));
    const x1 = Math.min(this.width, Math.round(x + w));
    const y0 = Math.max(0, Math.round(y));
    const y1 = Math.min(this.height, Math.round(y + h));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        this.pixels.set(fill, (py * this.width + px) * 3);
      }
    }
  }
  at(px: number, py: number): Rgb {
    const i = (py * this.width + px) * 3;
    return [this.pixels[i]!, this.pixels[i + 1]!, this.pixels[i + 2]!];
  }
}

/**
 * Stands in for `rasterizePdf`: one "rendered" canvas per page, at the
 * requested DPI and the page's displayed size, handed to the real `onCanvas`
 * hook exactly where the product calls it (after render, before encode). The
 * canvases are kept — they ARE what the encoder would have been given.
 */
function pixelRasterizer() {
  const encoded: PixelCanvas[] = [];
  const rasterize = async (
    bytes: Uint8Array,
    options: RasterizeOptions,
  ): Promise<RasterPage[]> => {
    const sizes = await getRedactPageSizes(bytes);
    const scale = (options.dpi ?? 150) / 72;
    return sizes.map((size, index) => {
      const width = Math.round(size.width * scale);
      const height = Math.round(size.height * scale);
      const canvas = new PixelCanvas(width, height, RENDERED);
      options.onCanvas?.(canvas as unknown as HTMLCanvasElement, {
        index,
        width,
        height,
        pageWidth: size.width,
        pageHeight: size.height,
      });
      encoded.push(canvas);
      return {
        index,
        bytes: JPG_1X1,
        width,
        height,
        pageWidth: size.width,
        pageHeight: size.height,
        undecodedImages: 0,
      };
    });
  };
  return { rasterize, encoded };
}

async function textPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]);
  return doc.save();
}

interface RegionTally {
  /** Pixels whose centre is > 1px inside the box: must all be the fill. */
  inside: number;
  insideFilled: number;
  /** Pixels whose centre is > 1px outside the box: must all be untouched. */
  outside: number;
  outsideUntouched: number;
}

/**
 * Classify every pixel against the box, mapped here from first principles: a
 * PDF box has a bottom-left origin in points, a canvas a top-left origin in
 * pixels. The 1px band on the boundary is skipped — the product rounds the box
 * OUTWARD, which is allowed; it may never round inward, which this catches.
 */
function tally(
  canvas: PixelCanvas,
  rect: Pick<RedactionRect, "x" | "y" | "width" | "height">,
  pageHeightPt: number,
  fill: Rgb,
): RegionTally {
  const s = canvas.height / pageHeightPt;
  const left = rect.x * s;
  const right = (rect.x + rect.width) * s;
  const top = (pageHeightPt - rect.y - rect.height) * s;
  const bottom = (pageHeightPt - rect.y) * s;
  const t: RegionTally = {
    inside: 0,
    insideFilled: 0,
    outside: 0,
    outsideUntouched: 0,
  };
  const same = (a: Rgb, b: Rgb) =>
    a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  for (let py = 0; py < canvas.height; py++) {
    for (let px = 0; px < canvas.width; px++) {
      const cx = px + 0.5;
      const cy = py + 0.5;
      const pixel = canvas.at(px, py);
      if (cx > left + 1 && cx < right - 1 && cy > top + 1 && cy < bottom - 1) {
        t.inside++;
        if (same(pixel, fill)) t.insideFilled++;
      } else if (
        cx < left - 1 ||
        cx > right + 1 ||
        cy < top - 1 ||
        cy > bottom + 1
      ) {
        t.outside++;
        if (same(pixel, RENDERED)) t.outsideUntouched++;
      }
    }
  }
  return t;
}

describe("the redaction paint reaches the bitmap that is encoded", () => {
  it("has a corpus that can fail: at least two distinct fills, none equal to the render", () => {
    // Health check. Two fills that painted the same colour could not tell a
    // wired fill from an ignored one; a fill equal to the background would
    // pass on an unpainted page.
    expect(REDACTION_FILL_OPTIONS.length).toBeGreaterThanOrEqual(2);
    const colours = REDACTION_FILL_OPTIONS.map((o) =>
      parseHex(redactionFillHex(o.value)).join(","),
    );
    expect(new Set(colours).size).toBe(colours.length);
    expect(colours).not.toContain(RENDERED.join(","));
    expect(DEFAULT_REDACTION_DRAFT.page).toBe(1);
  });

  for (const option of REDACTION_FILL_OPTIONS) {
    it(`default box, ${option.label} fill: every covered pixel is ${option.value}, nothing else moved`, async () => {
      const { rasterize, encoded } = pixelRasterizer();
      const fill: RedactionFill = option.value;
      const result = await redactPdf(
        await textPdf(2),
        { rects: [{ ...DEFAULT_REDACTION_DRAFT }], fill, dpi: 96 },
        rasterize,
      );
      expect(result.pageCount).toBe(2);
      expect(encoded).toHaveLength(2);

      const colour = parseHex(redactionFillHex(fill));
      const [first, second] = encoded as [PixelCanvas, PixelCanvas];

      const onBox = tally(first, DEFAULT_REDACTION_DRAFT, 792, colour);
      // Non-vacuous: the box covers thousands of pixels at 96 DPI.
      expect(onBox.inside).toBeGreaterThan(10_000);
      expect(onBox.insideFilled, "covered pixels that kept their content").toBe(
        onBox.inside,
      );
      expect(
        onBox.outsideUntouched,
        "pixels outside the box were painted",
      ).toBe(onBox.outside);

      // Page 2 carries no box: grouping by page must leave it exactly as
      // rendered. This is the per-page positive control — the same region,
      // unpainted, must NOT read as filled.
      const control = tally(second, DEFAULT_REDACTION_DRAFT, 792, colour);
      expect(control.insideFilled).toBe(0);
      expect(control.outsideUntouched).toBe(control.outside);
      expect(second.fillRectCalls).toBe(0);
    });
  }

  it("a box on page 2 paints page 2 only — the 1-based page number reaches the right canvas", async () => {
    const { rasterize, encoded } = pixelRasterizer();
    const rect = { ...DEFAULT_REDACTION_DRAFT, page: 2 };
    await redactPdf(await textPdf(3), { rects: [rect], dpi: 96 }, rasterize);
    const black = parseHex(redactionFillHex(undefined));
    const [p1, p2, p3] = encoded as [PixelCanvas, PixelCanvas, PixelCanvas];
    const hit = tally(p2, rect, 792, black);
    expect(hit.inside).toBeGreaterThan(10_000);
    expect(hit.insideFilled).toBe(hit.inside);
    for (const untouched of [p1, p3]) {
      expect(untouched.fillRectCalls).toBe(0);
      expect(tally(untouched, rect, 792, black).insideFilled).toBe(0);
    }
  });

  it("several boxes: every box on a page is painted, and each page gets only its own", async () => {
    // Every case above paints exactly ONE box, so a loop that painted only the
    // first box per page — or a grouping that kept only the first box per
    // page — passed them all (the review mutated both loops to
    // `rects.slice(0, 1)` and every test stayed green). Two boxes share page
    // 1, a third sits on page 3 at page 1's SECOND box position, and page 2
    // carries none.
    const { rasterize, encoded } = pixelRasterizer();
    const first = { ...DEFAULT_REDACTION_DRAFT, page: 1 };
    const second = {
      ...DEFAULT_REDACTION_DRAFT,
      page: 1,
      y: DEFAULT_REDACTION_DRAFT.y + DEFAULT_REDACTION_DRAFT.height + 200,
    };
    const third = { ...second, page: 3 };
    const rects = [first, second, third];
    const result = await redactPdf(
      await textPdf(3),
      { rects, dpi: 96 },
      rasterize,
    );
    expect(result.redactionCount).toBe(rects.length);
    expect(encoded).toHaveLength(3);
    const black = parseHex(redactionFillHex(undefined));

    encoded.forEach((canvas, index) => {
      const own = rects.filter((r) => r.page === index + 1);
      const others = rects.filter((r) => r.page !== index + 1);
      for (const rect of own) {
        const hit = tally(canvas, rect, 792, black);
        expect(hit.inside).toBeGreaterThan(10_000);
        expect(
          hit.insideFilled,
          `page ${index + 1}: box at y=${rect.y} kept its content`,
        ).toBe(hit.inside);
      }
      // A box that belongs to another page must leave this page's region as
      // rendered (the regions overlap across pages by construction).
      for (const rect of others) {
        if (own.some((o) => o.y === rect.y && o.x === rect.x)) continue;
        expect(
          tally(canvas, rect, 792, black).insideFilled,
          `page ${index + 1} painted page ${rect.page}'s box`,
        ).toBe(0);
      }
      expect(canvas.fillRectCalls).toBe(own.length);
    });
  });
});
