/**
 * Rasterize a PDF page with pdf.js, in Node — what a VIEWER paints, with the
 * page's CropBox and `/Rotate` applied exactly as a reader sees them.
 *
 * Tests that place content on a page used to read the author's artifact: the
 * `cm` operands the engine emitted, the stream it appended. Those pass while
 * the stamp lands sideways on a `/Rotate 90` page or outside a CropBox,
 * because the operands are exactly what the code meant to write. Pixels are
 * what the user downloads.
 *
 * pdf.js paints through `@napi-rs/canvas` here (its own optional dependency,
 * reached through its `NodeCanvasFactory`). If that factory is ever missing
 * this throws rather than returning a blank buffer: a blank render agrees with
 * every "this region is white" assertion, which is the convenient direction.
 */
import { PDFJS_DOCUMENT_DEFAULTS } from "@/lib/pdf/wasm-assets";
import { nodeAssetOptions } from "./pdf-image-decode";
import { awaitPdfjsDocument } from "@/lib/pdf/pdfjs";

export interface RenderedPage {
  /** Pixel width of the viewer frame (rotation and crop applied). */
  width: number;
  /** Pixel height of the viewer frame. */
  height: number;
  /** RGBA, 4 bytes per pixel, row-major, top row first. */
  data: Uint8ClampedArray;
}

interface CanvasLike {
  getImageData(
    x: number,
    y: number,
    w: number,
    h: number,
  ): { data: Uint8ClampedArray };
}

/**
 * Render every page of `pdf`, each scaled so its longer viewer side is
 * `longSide` pixels.
 */
export async function renderPdfPages(
  pdf: Uint8Array,
  longSide = 160,
): Promise<RenderedPage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: pdf.slice(),
    useWorkerFetch: false,
    isOffscreenCanvasSupported: false,
    disableFontFace: true,
    ...PDFJS_DOCUMENT_DEFAULTS,
    ...nodeAssetOptions(),
  });
  const out: RenderedPage[] = [];
  try {
    const doc = await awaitPdfjsDocument(task);
    const factory = (
      doc as unknown as {
        canvasFactory?: {
          create(
            w: number,
            h: number,
          ): { canvas: unknown; context: CanvasLike };
        };
      }
    ).canvasFactory;
    if (!factory || typeof factory.create !== "function") {
      throw new Error(
        "pdf.js has no canvas factory in this environment — nothing can be rasterized, and a blank render would pass every 'is white' check.",
      );
    }
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const unit = page.getViewport({ scale: 1 });
      const scale = longSide / Math.max(unit.width, unit.height);
      const viewport = page.getViewport({ scale });
      const width = Math.round(viewport.width);
      const height = Math.round(viewport.height);
      const { canvas, context } = factory.create(width, height);
      await page.render({
        canvas: canvas as HTMLCanvasElement,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
        background: "rgb(255,255,255)",
      }).promise;
      out.push({
        width,
        height,
        data: context.getImageData(0, 0, width, height).data,
      });
    }
  } finally {
    await task.destroy();
  }
  return out;
}

export type Rgb = [number, number, number];

/**
 * The mean colour of a region given in NORMALIZED viewer coordinates
 * (0..1, origin top-left), so two renders of different pixel sizes can be
 * compared region for region.
 */
export function regionMean(
  page: RenderedPage,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Rgb {
  const px0 = Math.floor(x0 * page.width);
  const py0 = Math.floor(y0 * page.height);
  const px1 = Math.max(px0 + 1, Math.ceil(x1 * page.width));
  const py1 = Math.max(py0 + 1, Math.ceil(y1 * page.height));
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let y = py0; y < py1 && y < page.height; y++) {
    for (let x = px0; x < px1 && x < page.width; x++) {
      const i = (y * page.width + x) * 4;
      r += page.data[i]!;
      g += page.data[i + 1]!;
      b += page.data[i + 2]!;
      count++;
    }
  }
  if (count === 0) throw new Error("regionMean: empty region");
  return [r / count, g / count, b / count];
}

/**
 * An `n`×`n` grid of mean colours over a normalized sub-rectangle of the page
 * (the whole page by default), rows top to bottom.
 */
export function colourGrid(
  page: RenderedPage,
  n: number,
  rect: [number, number, number, number] = [0, 0, 1, 1],
): Rgb[][] {
  const [x0, y0, x1, y1] = rect;
  const cw = (x1 - x0) / n;
  const ch = (y1 - y0) / n;
  return Array.from({ length: n }, (_, row) =>
    Array.from({ length: n }, (_, col) =>
      regionMean(
        page,
        x0 + col * cw,
        y0 + row * ch,
        x0 + (col + 1) * cw,
        y0 + (row + 1) * ch,
      ),
    ),
  );
}

/** The largest per-channel difference between two equally-sized grids. */
export function gridDistance(a: Rgb[][], b: Rgb[][]): number {
  let worst = 0;
  a.forEach((row, r) =>
    row.forEach((cell, c) => {
      const other = b[r]![c]!;
      for (let k = 0; k < 3; k++) {
        worst = Math.max(worst, Math.abs(cell[k]! - other[k]!));
      }
    }),
  );
  return worst;
}
