// @vitest-environment jsdom
// @native-canvas
/**
 * CO-02, the composed chain: Redact validates boxes against
 * `getRedactPageSizes` (pdf-lib) and paints them on the page pdf.js renders.
 * With object 3 defined twice and the xref naming the FIRST body, the two used
 * to read different pages (400 x 400 against 300 x 200): a box past the real
 * edge was accepted, and the size shown in the panel was not the page's.
 *
 * Here the real `redactPdf` runs with the real rasterizer (pdf.js painting
 * onto `@napi-rs/canvas`, as `render-transparent.test.ts` sets it up), and
 * the OUTPUT is rendered again and read back: the page size the validator
 * used must be the output's, the box must be black where the user put it, and
 * a box past the edge the viewer shows must be refused. The twin whose xref
 * names the last body is the control.
 */
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRedactPageSizes, redactPdf } from "@/lib/pdf/redact";
import { rasterizePdf } from "@/lib/pdf/render";
import { duplicateObjectPdf } from "./conversion-out.fixtures";

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

/** Render page 1 at 72 dpi (1 px = 1 pt) and read pixels, top-left origin. */
async function render(bytes: Uint8Array) {
  const [page] = await rasterizePdf(bytes, { format: "png", dpi: 72 });
  const image = await napi.loadImage(Buffer.from(page!.bytes));
  const canvas = napi.createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(image as never, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  return {
    width: image.width,
    height: image.height,
    /** Darkest channel at a point given in PDF points, bottom-left origin. */
    ink: (x: number, y: number) => {
      const i = ((image.height - 1 - Math.round(y)) * image.width + x) * 4;
      return Math.max(data[i]!, data[i + 1]!, data[i + 2]!);
    },
  };
}

describe("CO-02: a redaction lands where the user placed it", () => {
  for (const which of ["first", "second"] as const) {
    it(`CO-02: xref -> ${which}: validator size = rendered size, box painted in place`, async () => {
      const input = duplicateObjectPdf(which);
      const before = await render(input);
      const [size] = await getRedactPageSizes(input);
      // The geometry the boxes are validated against is the page's as shown.
      expect([size!.width, size!.height]).toEqual([
        before.width,
        before.height,
      ]);

      // Health: the area is white before redaction, so black after is the paint.
      expect(before.ink(180, 40)).toBeGreaterThan(200);
      // A 60 x 40 box low on the page, inside both bodies.
      const box = { page: 1, x: 150, y: 20, width: 60, height: 40 };
      const out = await redactPdf(input, { rects: [box], dpi: 72 });
      const after = await render(out.bytes);
      expect([after.width, after.height]).toEqual([
        before.width,
        before.height,
      ]);
      // Black inside the box (a JPEG round trip: dark, not exactly 0)…
      expect(after.ink(180, 40)).toBeLessThan(60);
      // …and still white just outside it, on the side away from the text.
      expect(after.ink(230, 40)).toBeGreaterThan(200);

      // A box past the right edge the viewer shows is refused, not accepted
      // against a page that is not on screen.
      const past = {
        page: 1,
        x: before.width + 10,
        y: 20,
        width: 40,
        height: 40,
      };
      await expect(
        redactPdf(input, { rects: [past], dpi: 72 }),
      ).rejects.toThrow();
    }, 60_000);
  }
});
