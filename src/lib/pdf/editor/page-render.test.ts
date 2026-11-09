// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  CSS_PX_PER_PT,
  MAX_ZOOM,
  MIN_FIT_ZOOM,
  scaleForZoom,
} from "./geometry";
import {
  MAX_CANVAS_PIXELS,
  cappedPixelRatio,
  editorPdfjs,
  openEditorPdf,
} from "./page-render";
import { PDFJS_DOCUMENT_DEFAULTS } from "../wasm-assets";
import { PDF_IMAGE_TOO_LARGE_MESSAGE } from "../pdfjs-guard";
import {
  CONTROL,
  imageHugeDimsPdf,
} from "@/tests/hostile/conversion-out.fixtures";

/**
 * The editor's pdf.js open (Edit, Annotate and Sign PDF) is a PREVIEW: it
 * spreads the preflight's `previewOptions` into `getDocument` exactly as the
 * thumbnails do (`createThumbnailRenderer`), so pdf.js skips an image over
 * its raster budget before decoding it (CO-08), and the editor says so.
 * The bounded, decoded proof is in src/tests/hostile/pdfjs-guard-bounds.test.ts
 * ("CO-08 editor canvas"); this file pins the options at the call.
 *
 * The spy goes through `editorPdfjs`, the module's own seam, not `vi.mock`:
 * under `isolate: false` a module evaluated under a mock stays bound to the
 * stub for the next file (src/tests/mock-isolation.test.ts).
 */
async function openWithSpy(bytes: Uint8Array) {
  const getDocument = vi.fn(() => ({
    promise: Promise.resolve({ numPages: 1 }),
    destroy: () => Promise.resolve(),
  }));
  const real = editorPdfjs.load;
  editorPdfjs.load = (() =>
    Promise.resolve({ getDocument })) as unknown as typeof real;
  try {
    const doc = await openEditorPdf(bytes);
    await doc.destroy();
    return { doc, options: getDocument.mock.calls.map((c) => c) };
  } finally {
    editorPdfjs.load = real;
  }
}

describe("openEditorPdf hands pdf.js the preflight's preview options", () => {
  it("an over-budget image: maxImageSize reaches getDocument, beside the defaults, and the editor has its sentence", async () => {
    const { doc, options } = await openWithSpy(imageHugeDimsPdf());
    expect(options).toHaveLength(1);
    const [opts] = options[0] as unknown as [Record<string, unknown>];
    // 100,000 x 100,000: pdf.js skips images of this many pixels and more.
    expect(opts.maxImageSize).toBe(100_000 * 100_000 - 1);
    expect(opts).toMatchObject(PDFJS_DOCUMENT_DEFAULTS);
    expect(opts.data).toBeInstanceOf(Uint8Array);
    expect(doc.imageNotice).toContain(PDF_IMAGE_TOO_LARGE_MESSAGE);
    // Never a page number: pdf.js 6 does not report which page skipped it.
    expect(doc.imageNotice).not.toMatch(/\bpage \d/i);
  });

  it("negative control: a file within budget opens exactly as before, no maxImageSize and no sentence", async () => {
    const { doc, options } = await openWithSpy(CONTROL());
    expect(options).toHaveLength(1);
    const [opts] = options[0] as unknown as [Record<string, unknown>];
    expect("maxImageSize" in opts).toBe(false);
    expect(doc.imageNotice).toBeNull();
  });

  it("the seam is restored: the next open loads the real pdf.js", async () => {
    const { loadPdfjs } = await import("../pdfjs");
    expect(editorPdfjs.load).toBe(loadPdfjs);
  });
});

describe("cappedPixelRatio holds a page under MAX_CANVAS_PIXELS at every zoom", () => {
  // Points: Letter, A4, tabloid, A1, A0, and PDF's largest page (200 in).
  const PAGES: [number, number][] = [
    [612, 792],
    [595, 842],
    [792, 1224],
    [1684, 2384],
    [2384, 3370],
    [14_400, 14_400],
  ];
  const ZOOMS = [MIN_FIT_ZOOM, 0.5, 1, 2, 3, MAX_ZOOM];

  it("never past the cap, for every page, zoom and device ratio", () => {
    let checked = 0;
    for (const [w, h] of PAGES) {
      for (const zoom of ZOOMS) {
        for (const dpr of [0.5, 1, 1.5, 2, 3, 4]) {
          const scale = scaleForZoom(zoom);
          const cssW = w * scale;
          const cssH = h * scale;
          const ratio = cappedPixelRatio(cssW, cssH, dpr);
          const device = Math.floor(cssW * ratio) * Math.floor(cssH * ratio);
          expect(device, `${w}x${h} at ${zoom} x${dpr}`).toBeLessThanOrEqual(
            MAX_CANVAS_PIXELS,
          );
          expect(ratio).toBeGreaterThan(0);
          checked += 1;
        }
      }
    }
    // Health: the grid ran, and it reached the pages that once broke it.
    expect(checked).toBe(PAGES.length * ZOOMS.length * 6);
  });

  it("positive control: a page within the cap keeps the device's own ratio (clamped to 1-3)", () => {
    const s = CSS_PX_PER_PT;
    expect(cappedPixelRatio(612 * s, 792 * s, 2)).toBe(2);
    expect(cappedPixelRatio(612 * s, 792 * s, 3)).toBe(3);
    expect(cappedPixelRatio(612 * s, 792 * s, 4)).toBe(3);
    expect(cappedPixelRatio(612 * s, 792 * s, 0.5)).toBe(1);
  });

  it("past the cap, the canvas is the cap, not a fraction of it", () => {
    const scale = scaleForZoom(MAX_ZOOM);
    const cssW = 2384 * scale;
    const cssH = 3370 * scale;
    const ratio = cappedPixelRatio(cssW, cssH, 2);
    expect(cssW * ratio * cssH * ratio).toBeCloseTo(MAX_CANVAS_PIXELS, -2);
  });
});
