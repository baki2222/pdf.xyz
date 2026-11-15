// @vitest-environment jsdom
// @native-canvas
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFString,
  rgb,
  type PDFPage,
} from "pdf-lib";
import { embedDrawingFont } from "@/lib/pdf/unicode-font";
import { drawRasterImage, embedRasterImage } from "@/lib/pdf/pdf-lib";
import { TOLERANCE, type Plane } from "@/lib/pdf/compare/visual-diff";
import { extractLegacy } from "@/tests/compare-fixtures";
import { compareExtractedPdfText } from "./compare-result";
import { canClaimNoVisualDiff } from "./visual-claim";
import {
  capturePairs,
  claimStateOf,
  visualRender,
  type PairOutcome,
} from "./visual-pairs";

/**
 * The Overlay's composed chain (S3, 2026-11-15), on real PDFs: the real
 * `capturePairs` → the real `capturePdfPages` (preflight, page budget,
 * pdf.js drawing each page) → the capture hook → `luminancePlane` →
 * `bestShift` → `diffPlanes`. Rule 5: the units are tested on synthetic
 * planes in `visual-diff.test.ts`; this is the path a reader's files take.
 *
 * Stubbed on globals and restored after each test, no `vi.mock`:
 * `document.createElement("canvas")` returns an `@napi-rs/canvas` (pdf.js's
 * own Node canvas; jsdom's has no 2D context) and `globalThis.pdfjsWorker`
 * is pdf.js's worker module, as grayscale-runner.test.tsx does.
 *
 * Every pixel figure is relative to the drawing's own ink (Linux draws
 * text thinner than Windows); the only typed counts are 0 and ≥ 1.
 */

const requireHere = createRequire(import.meta.url);
const napi = createRequire(requireHere.resolve("pdfjs-dist/package.json"))(
  "@napi-rs/canvas",
) as {
  createCanvas(
    width: number,
    height: number,
  ): HTMLCanvasElement & { toBuffer(mime: string): Buffer };
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

const LINES = [
  "Master services agreement",
  "1. The supplier delivers the goods by the date agreed.",
  "2. The buyer pays within thirty days of the invoice.",
  "3. Either party may end this agreement with notice.",
];

/** A letter-size page of text, drawn `dx` points to the right. */
async function textPage(
  doc: PDFDocument,
  dx = 0,
  size: [number, number] = [612, 792],
): Promise<PDFPage> {
  const font = await embedDrawingFont(doc, LINES);
  const page = doc.addPage(size);
  LINES.forEach((line, i) =>
    page.drawText(line, {
      x: 60 + dx,
      y: size[1] - 80 - i * 20,
      size: 12,
      font,
    }),
  );
  return page;
}

async function onePage(
  draw: (doc: PDFDocument) => Promise<void>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  await draw(doc);
  return doc.save();
}

/** A PNG: a dark square with a lighter ring, `side` px. */
function logoPng(side = 60): Uint8Array {
  const c = napi.createCanvas(side, side);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, side, side);
  ctx.fillStyle = "#202020";
  ctx.fillRect(6, 6, side - 12, side - 12);
  ctx.fillStyle = "#909090";
  ctx.fillRect(18, 18, side - 36, side - 36);
  return new Uint8Array(c.toBuffer("image/png"));
}

/** A grey "scan" with noise-free text-like bars, as one full-page image. */
function scanPng(mark: boolean): Uint8Array {
  const c = napi.createCanvas(850, 1100);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f4f4f4";
  ctx.fillRect(0, 0, 850, 1100);
  ctx.fillStyle = "#222222";
  for (let y = 100; y < 900; y += 40) ctx.fillRect(80, y, 600 - (y % 120), 12);
  if (mark) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(600, 950, 120, 60);
  }
  return new Uint8Array(c.toBuffer("image/png"));
}

const realCapture = visualRender.capture;

async function pair(left: Uint8Array, right: Uint8Array, k = 0) {
  // The real capturePdfPages, whatever an earlier file in this worker set.
  visualRender.capture = realCapture;
  const result = await capturePairs(left, right, [k], { keep: true });
  const o = result.outcomes[0];
  return { result, o };
}

function checked(o: PairOutcome | undefined) {
  expect(o?.status, JSON.stringify(o && { ...o, diff: undefined })).toBe(
    "checked",
  );
  return o as Extract<PairOutcome, { status: "checked" }>;
}

const inkOf = (p: Plane) => {
  let n = 0;
  for (const v of p.data) if (255 - v > TOLERANCE) n++;
  return n;
};

describe("the Overlay on real PDFs", () => {
  it("sees a stamp the text comparison cannot, over most of the stamp's ink", async () => {
    const base = await onePage(async (doc) => {
      await textPage(doc);
    });
    const stamped = await onePage(async (doc) => {
      const page = await textPage(doc);
      page.drawRectangle({
        x: 380,
        y: 300,
        width: 160,
        height: 70,
        borderColor: rgb(0.7, 0, 0),
        borderWidth: 6,
        color: rgb(0.85, 0.2, 0.2),
      });
    });
    // The text comparison sees nothing: same words.
    const a = {
      name: "a.pdf",
      size: base.length,
      extracted: await extractLegacy(base),
    };
    const b = {
      name: "b.pdf",
      size: stamped.length,
      extracted: await extractLegacy(stamped),
    };
    expect(compareExtractedPdfText(a, b).verdict).toBe("identical");

    const { o } = await pair(base, stamped);
    const c = checked(o);
    expect(c.diff.regions.length).toBeGreaterThanOrEqual(1);
    expect(c.diff.regions.some((r) => r.kind === "added")).toBe(true);
    const extra = inkOf(c.planes!.right) - inkOf(c.planes!.left);
    // Health: the stamp drew ink at all.
    expect(extra).toBeGreaterThan(0);
    const marked = c.diff.regions.reduce((sum, r) => sum + r.pixels, 0);
    expect(marked).toBeGreaterThanOrEqual(0.5 * extra);
    expect(c.left.dpi).toBe(150);
  });

  it("an identical pair (two separate saves) has no region, and the gate opens", async () => {
    const a = await onePage(async (doc) => {
      await textPage(doc);
    });
    const b = await onePage(async (doc) => {
      await textPage(doc);
    });
    expect(a).not.toBe(b);
    const { result, o } = await pair(a, b);
    expect(checked(o).diff.regions).toHaveLength(0);
    expect(
      canClaimNoVisualDiff(
        claimStateOf(result, {
          pairsTotal: 1,
          unpaired: 0,
          hasText: () => true,
        }),
      ),
    ).toBe(true);
  });

  // Review r1, 2026-11-15, finding 1: each of these drew "No differences
  // visible" before the area test, because no pixel changed by more than
  // TOLERANCE. The corpus before used only dark stamps (darkness ~154).
  describe("changes under the per-pixel tolerance are seen", () => {
    const gateOf = (r: Awaited<ReturnType<typeof capturePairs>>, text = true) =>
      canClaimNoVisualDiff(
        claimStateOf(r, { pairsTotal: 1, unpaired: 0, hasText: () => text }),
      );
    /** A region's centre lies inside the box (PDF points, page 792 high). */
    const near = (
      c: Extract<PairOutcome, { status: "checked" }>,
      box: { x: number; y: number; w: number; h: number },
    ) => {
      const s = c.left.dpi / 72;
      const x0 = box.x * s;
      const x1 = (box.x + box.w) * s;
      const y0 = (792 - box.y - box.h) * s;
      const y1 = (792 - box.y) * s;
      return c.diff.regions.some((r) => {
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
      });
    };

    it("a block recoloured red to blue (luma 76 to 29)", async () => {
      const box = { x: 380, y: 300, w: 160, h: 80 };
      const mk = (c: ReturnType<typeof rgb>) =>
        onePage(async (doc) => {
          const p = await textPage(doc);
          p.drawRectangle({
            x: box.x,
            y: box.y,
            width: box.w,
            height: box.h,
            color: c,
          });
        });
      const { result, o } = await pair(
        await mk(rgb(1, 0, 0)),
        await mk(rgb(0, 0, 1)),
      );
      const c = checked(o);
      expect(c.diff.regions.length).toBeGreaterThanOrEqual(1);
      expect(near(c, box)).toBe(true);
      expect(gateOf(result)).toBe(false);
    });

    it("a pale DRAFT watermark (0.85 grey)", async () => {
      const a = await onePage(async (doc) => {
        await textPage(doc);
      });
      const b = await onePage(async (doc) => {
        const p = await textPage(doc);
        const font = await embedDrawingFont(doc, ["DRAFT"]);
        p.drawText("DRAFT", {
          x: 120,
          y: 300,
          size: 140,
          font,
          color: rgb(0.85, 0.85, 0.85),
        });
      });
      const { result, o } = await pair(a, b);
      const c = checked(o);
      expect(c.diff.regions.length).toBeGreaterThanOrEqual(1);
      expect(c.diff.regions.some((r) => r.kind === "added")).toBe(true);
      expect(near(c, { x: 120, y: 290, w: 480, h: 120 })).toBe(true);
      expect(gateOf(result)).toBe(false);
    });

    it("a yellow highlight bar", async () => {
      const a = await onePage(async (doc) => {
        await textPage(doc);
      });
      const box = { x: 55, y: 450, w: 330, h: 16 };
      const b = await onePage(async (doc) => {
        const p = await textPage(doc);
        p.drawRectangle({
          x: box.x,
          y: box.y,
          width: box.w,
          height: box.h,
          color: rgb(1, 1, 0),
        });
      });
      const { result, o } = await pair(a, b);
      const c = checked(o);
      expect(c.diff.regions.length).toBeGreaterThanOrEqual(1);
      expect(near(c, box)).toBe(true);
      expect(gateOf(result)).toBe(false);
    });

    it("two pages of pale colour only, with no text", async () => {
      const mk = (c: ReturnType<typeof rgb>) =>
        onePage(async (doc) => {
          const p = doc.addPage([612, 792]);
          p.drawRectangle({ x: 50, y: 50, width: 500, height: 600, color: c });
        });
      const { result, o } = await pair(
        await mk(rgb(1, 1, 0.6)),
        await mk(rgb(0.8, 0.9, 1)),
      );
      expect(checked(o).diff.regions.length).toBeGreaterThanOrEqual(1);
      expect(gateOf(result, false)).toBe(false);
    });

    it("control: the same pale page twice, and a pale block moved 0.3 pt, are no region", async () => {
      const mk = (dx: number) =>
        onePage(async (doc) => {
          const p = await textPage(doc);
          p.drawRectangle({
            x: 380.4 + dx,
            y: 300.7,
            width: 160,
            height: 80,
            color: rgb(1, 1, 0),
          });
          const font = await embedDrawingFont(doc, ["DRAFT"]);
          p.drawText("DRAFT", {
            x: 120 + dx,
            y: 300,
            size: 140,
            font,
            color: rgb(0.85, 0.85, 0.85),
          });
        });
      const same = await pair(await mk(0), await mk(0));
      expect(checked(same.o).diff.regions).toHaveLength(0);
      expect(gateOf(same.result)).toBe(true);
      const moved = await pair(await mk(0), await mk(0.3));
      expect(checked(moved.o).diff.regions).toHaveLength(0);
    });
  });

  it("text moved 0.3 pt is no region", async () => {
    const a = await onePage(async (doc) => {
      await textPage(doc);
    });
    const b = await onePage(async (doc) => {
      await textPage(doc, 0.3);
    });
    expect(checked((await pair(a, b)).o).diff.regions).toHaveLength(0);
  });

  it("a logo moved 30 pt shows where it left and where it arrived", async () => {
    const png = logoPng();
    const page = (x: number) =>
      onePage(async (doc) => {
        const p = await textPage(doc);
        const img = await embedRasterImage(doc, png, "png");
        await drawRasterImage(p, img, { x, y: 420, width: 60, height: 60 });
      });
    const c = checked((await pair(await page(100), await page(130))).o);
    const kinds = new Set(c.diff.regions.map((r) => r.kind));
    // Moved 30 pt (62 px, past the 12 px alignment): never lined up away.
    expect(c.diff.shift).toEqual({ dx: 0, dy: 0 });
    expect(kinds.has("removed") || kinds.has("changed")).toBe(true);
    expect(kinds.has("added") || kinds.has("changed")).toBe(true);
    expect(c.diff.regions.length).toBeGreaterThanOrEqual(1);
  });

  it("two image-only pages: a mark on one is a region at the mark", async () => {
    const scan = (mark: boolean) =>
      onePage(async (doc) => {
        const p = doc.addPage([612, 792]);
        const img = await embedRasterImage(doc, scanPng(mark), "png");
        await drawRasterImage(p, img, { x: 0, y: 0, width: 612, height: 792 });
      });
    const c = checked((await pair(await scan(false), await scan(true))).o);
    expect(c.diff.regions.length).toBeGreaterThanOrEqual(1);
    // The mark sits in the lower right of the page.
    const r = c.diff.regions[0]!;
    expect(r.x + r.w / 2).toBeGreaterThan(c.diff.w / 2);
    expect(r.y + r.h / 2).toBeGreaterThan(c.diff.h / 2);
  });

  it("a Stamp annotation with an appearance stream is drawn, so it is seen", async () => {
    const plain = await onePage(async (doc) => {
      await textPage(doc);
    });
    const annotated = await onePage(async (doc) => {
      const page = await textPage(doc);
      const ctx = doc.context;
      const ap = ctx.stream("0.1 0.1 0.6 rg 0 0 150 60 re f", {
        Type: "XObject",
        Subtype: "Form",
        BBox: [0, 0, 150, 60],
      });
      const apRef = ctx.register(ap);
      const annot = ctx.obj({
        Type: "Annot",
        Subtype: "Stamp",
        Rect: [380, 200, 530, 260],
        Name: PDFName.of("Approved"),
        Contents: PDFString.of("Approved"),
        F: PDFNumber.of(4),
        AP: ctx.obj({ N: apRef }),
      });
      page.node.set(PDFName.of("Annots"), ctx.obj([ctx.register(annot)]));
    });
    const c = checked((await pair(plain, annotated)).o);
    expect(c.diff.regions.length).toBeGreaterThanOrEqual(1);
  });

  it("an A1 page against an A3 page is a size difference, and the A3 side is drawn below 150 dpi", async () => {
    const a1 = await onePage(async (doc) => {
      await textPage(doc, 0, [1684, 2384]);
    });
    const a3 = await onePage(async (doc) => {
      await textPage(doc, 0, [842, 1191]);
    });
    const c = checked((await pair(a1, a3)).o);
    expect(c.diff.sizeDiffers).toBe(true);
    expect(c.right.dpiCapped).toBe(true);
    expect(c.right.dpi).toBeLessThan(150);
    expect(Math.max(c.planes!.right.w, c.planes!.right.h)).toBeLessThanOrEqual(
      2000,
    );
    expect(c.right.pageWidth).toBeCloseTo(842, 0);
  });
});
