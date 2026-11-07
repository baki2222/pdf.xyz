// @vitest-environment jsdom
// @native-canvas
/**
 * PDF to PNG's transparent background (audit pdf-to-png#5, 2026-11-07),
 * through REAL pixels: pdf.js renders a page that paints only a black square
 * onto an `@napi-rs/canvas` (pdf.js's own Node canvas; jsdom's has no 2D
 * context), the PNG `rasterizePdf` returns is decoded by that library, and
 * the alpha channel is read back.
 *
 * Until then every page was painted onto opaque white — `background` was
 * passed, but pdf.js creates its context with `alpha: false` whenever it is
 * handed a canvas, so no background colour could have made it transparent.
 *
 * Stubbed on globals and restored after each test, no `vi.mock` (the suite
 * shares one module cache): `document.createElement("canvas")` and
 * `globalThis.pdfjsWorker`, as grayscale-runner.test.tsx does.
 */
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, rgb } from "pdf-lib";
import { rasterizePdf } from "./render";

const requireHere = createRequire(import.meta.url);
const napi = createRequire(requireHere.resolve("pdfjs-dist/package.json"))(
  "@napi-rs/canvas",
) as {
  createCanvas(width: number, height: number): HTMLCanvasElement;
  loadImage(src: Buffer): Promise<{ width: number; height: number }>;
};

beforeEach(async () => {
  await import("pdfjs-dist/legacy/build/pdf.mjs");
  const worker: unknown = await import(
    // @ts-expect-error -- pdfjs-dist ships no type declarations for its worker.
    "pdfjs-dist/legacy/build/pdf.worker.mjs"
  );
  vi.stubGlobal("pdfjsWorker", worker);
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((
    tag: string,
    options?: ElementCreationOptions,
  ) => {
    if (tag.toLowerCase() !== "canvas") return createElement(tag, options);
    return napi.createCanvas(1, 1);
  }) as typeof document.createElement);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A 72 × 72 pt page with a black 24 pt square in its middle, nothing else. */
async function squarePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([72, 72]);
  page.drawRectangle({
    x: 24,
    y: 24,
    width: 24,
    height: 24,
    color: rgb(0, 0, 0),
  });
  return doc.save();
}

/** RGBA of the decoded PNG at (x, y). */
async function pixels(png: Uint8Array) {
  const image = await napi.loadImage(Buffer.from(png));
  const canvas = napi.createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(image as never, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  return {
    width: image.width,
    at: (x: number, y: number) => {
      const i = (y * image.width + x) * 4;
      return [data[i], data[i + 1], data[i + 2], data[i + 3]];
    },
  };
}

describe("rasterizePdf · transparent PNG background", () => {
  it("leaves the unpainted page transparent and the square opaque black", async () => {
    const [page] = await rasterizePdf(await squarePdf(), {
      format: "png",
      dpi: 72,
      transparent: true,
    });
    const img = await pixels(page!.bytes);
    expect(img.width).toBe(72);
    expect(img.at(2, 2)[3]).toBe(0);
    expect(img.at(36, 36)).toEqual([0, 0, 0, 255]);
  });

  it("control: by default the page is opaque white", async () => {
    const [page] = await rasterizePdf(await squarePdf(), {
      format: "png",
      dpi: 72,
    });
    const img = await pixels(page!.bytes);
    expect(img.at(2, 2)).toEqual([255, 255, 255, 255]);
    expect(img.at(36, 36)).toEqual([0, 0, 0, 255]);
  });

  it("a JPEG ignores it: JPEG has no alpha, so the page stays white", async () => {
    const [page] = await rasterizePdf(await squarePdf(), {
      format: "jpg",
      dpi: 72,
      transparent: true,
    });
    const img = await pixels(page!.bytes);
    const [r, g, b, a] = img.at(2, 2);
    expect(a).toBe(255);
    expect(Math.min(r!, g!, b!)).toBeGreaterThan(240);
  });
});
