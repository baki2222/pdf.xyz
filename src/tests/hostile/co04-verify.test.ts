// @native-canvas
// @vitest-environment node
/**
 * CO-04 verify: /UserUnit — pdf-lib and pdf.js disagree on page geometry.
 *
 * The rasterizer is replaced by one that computes its geometry with the REAL
 * pdf.js (legacy build, Node) exactly as `rasterizePdf` does in render.ts
 * (`page.getViewport({scale:1})` -> `rasterPageScale(..., RASTER_MAX_DEVICE_PX)`
 * -> `pageWidth: base.width`), then hands the real `onCanvas` hook a canvas that
 * records fillRect. Only pdf.js's pixel render is skipped.
 */
import { describe, expect, it } from "vitest";
import * as F from "./conversion-out.fixtures";
import { getRedactPageSizes, redactPdf } from "@/lib/pdf/redact";
import { rasterPageScale } from "@/lib/pdf/render-utils";
import { RASTER_MAX_DEVICE_PX } from "@/lib/pdf/pdf-to-image";
import type { RasterizeOptions, RasterPage } from "@/lib/pdf/render";

type Fill = { x: number; y: number; w: number; h: number };

function recordingCanvas(width: number, height: number, fills: Fill[]) {
  return {
    width,
    height,
    getContext: () => ({
      fillStyle: "#000000",
      fillRect: (x: number, y: number, w: number, h: number) =>
        fills.push({ x, y, w, h }),
    }),
  };
}

async function runWithPdfjsGeometry(
  bytes: Uint8Array,
  rect: { x: number; y: number; width: number; height: number },
) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const fills: Fill[] = [];
  let canvasSize = { width: 0, height: 0, pageWidth: 0, pageHeight: 0 };
  let userUnit = 0;
  const rasterize = async (
    pdf: Uint8Array,
    opts: RasterizeOptions,
  ): Promise<RasterPage[]> => {
    const task = pdfjs.getDocument({ data: pdf.slice() });
    const doc = await task.promise;
    const page = await doc.getPage(1);
    userUnit = page.userUnit;
    const base = page.getViewport({ scale: 1 });
    const fit = rasterPageScale(
      base.width,
      base.height,
      opts.dpi ?? 150,
      RASTER_MAX_DEVICE_PX,
    );
    const vp = page.getViewport({ scale: fit.scale });
    const width = Math.max(1, Math.floor(vp.width));
    const height = Math.max(1, Math.floor(vp.height));
    canvasSize = {
      width,
      height,
      pageWidth: base.width,
      pageHeight: base.height,
    };
    opts.onCanvas?.(recordingCanvas(width, height, fills) as never, {
      index: 0,
      width,
      height,
      pageWidth: base.width,
      pageHeight: base.height,
    });
    await task.destroy();
    return [];
  };
  let err = "";
  try {
    await redactPdf(
      bytes,
      { rects: [{ page: 1, ...rect }], dpi: 72 } as never,
      rasterize,
    );
  } catch (e) {
    err = String(e);
  }
  return { fills, canvasSize, userUnit, err };
}

describe("CO-04 verify", () => {
  it("UserUnit 1000: full-page box covers 1/1000 of the canvas", async () => {
    const bytes = F.userUnitHugePdf();
    const sizes = await getRedactPageSizes(bytes);
    console.log("pdf-lib sizes", JSON.stringify(sizes));
    // The whole page as the UI bounds it (pdf-lib's crop box).
    const full = await runWithPdfjsGeometry(bytes, {
      x: 0,
      y: 0,
      width: sizes[0]!.width,
      height: sizes[0]!.height,
    });
    console.log("full", JSON.stringify(full));
    const tiny = await runWithPdfjsGeometry(bytes, {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });
    console.log("tiny", JSON.stringify(tiny));
    expect(full.userUnit).toBe(1000);
    // A box covering the whole page should cover the whole canvas.
    const f = full.fills[0]!;
    const coveredFraction =
      (f.w * f.h) / (full.canvasSize.width * full.canvasSize.height);
    console.log("covered fraction of canvas", coveredFraction);
    expect(coveredFraction).toBeLessThan(0.01); // the defect, reproduced
  }, 30000);

  it("control: same page without UserUnit is covered fully", async () => {
    const bytes = F.simplePdf({ mediaBox: "[0 0 14400 14400]" });
    const r = await runWithPdfjsGeometry(bytes, {
      x: 0,
      y: 0,
      width: 14400,
      height: 14400,
    });
    console.log("control", JSON.stringify(r));
    const f = r.fills[0]!;
    expect(f.w).toBe(r.canvasSize.width);
    expect(f.h).toBe(r.canvasSize.height);
  }, 30000);
});

describe("CO-04 verify, realistic UserUnit", () => {
  it("UserUnit 2 on a 1000 pt page: whole-page box covers a quarter", async () => {
    const bytes = F.simplePdf({
      mediaBox: "[0 0 1000 1000]",
      pageExtra: "/UserUnit 2",
    });
    const r = await runWithPdfjsGeometry(bytes, {
      x: 0,
      y: 0,
      width: 1000,
      height: 1000,
    });
    console.log("uu2", JSON.stringify(r));
    const f = r.fills[0]!;
    expect(f.w / r.canvasSize.width).toBeCloseTo(0.5, 2);
  }, 30000);
});
