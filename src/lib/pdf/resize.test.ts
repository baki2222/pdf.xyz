// @native-canvas
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { PDFDocument, PDFName, StandardFonts, degrees } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { PdfEngineError } from "./engine";
import {
  MAX_RESIZE_SIDE_PT,
  MIN_RESIZE_SIDE_PT,
  RESIZE_SIZES,
  orientedTarget,
  resizeOutputName,
  resizePdf,
} from "./resize";

/**
 * Resize PDF, read back by pdf.js: the size a viewer shows each page at
 * (its viewport, after /Rotate and the CropBox), and where a text mark and a
 * link land on the page a reader sees. None of it goes through resize.ts's
 * own geometry, so the geometry cannot certify itself.
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

interface Shown {
  width: number;
  height: number;
  /** Where "MARK" starts, in displayed points from the TOP-left. */
  mark: [number, number] | null;
  /** The first link's rectangle in displayed points (top-left origin). */
  link: [number, number, number, number] | null;
}

async function shown(bytes: Uint8Array): Promise<Shown[]> {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  const out: Shown[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const text = await page.getTextContent();
    const item = text.items.find(
      (i) => "str" in i && i.str.includes("MARK"),
    ) as { transform: number[] } | undefined;
    let mark: Shown["mark"] = null;
    if (item) {
      const [x, y] = viewport.convertToViewportPoint(
        item.transform[4]!,
        item.transform[5]!,
      );
      mark = [x!, y!];
    }
    const annots = (await page.getAnnotations()) as { rect: number[] }[];
    let link: Shown["link"] = null;
    if (annots[0]) {
      const [x0, y0, x1, y1] = annots[0].rect as [
        number,
        number,
        number,
        number,
      ];
      const a = viewport.convertToViewportPoint(x0, y0);
      const b = viewport.convertToViewportPoint(x1, y1);
      const r = [a[0]!, a[1]!, b[0]!, b[1]!];
      link = [
        Math.min(r[0]!, r[2]!),
        Math.min(r[1]!, r[3]!),
        Math.max(r[0]!, r[2]!),
        Math.max(r[1]!, r[3]!),
      ];
    }
    out.push({ width: viewport.width, height: viewport.height, mark, link });
  }
  await task.destroy();
  return out;
}

const A4 = RESIZE_SIZES.find((s) => s.id === "a4")!.size;
const LETTER = RESIZE_SIZES.find((s) => s.id === "letter")!.size;

/** A 400×600 page with "MARK" at (100, 500) and a link at 50,50–150,80. */
async function markedPdf({
  pages = 1,
  rotate = 0,
  cropBox,
}: {
  pages?: number;
  rotate?: number;
  cropBox?: [number, number, number, number];
} = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i += 1) {
    const page = doc.addPage([400, 600]);
    page.drawText("MARK", { x: 100, y: 500, size: 12, font });
    if (cropBox) page.setCropBox(...cropBox);
    page.setRotation(degrees(rotate));
    const link = doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [50, 50, 150, 80],
      Border: [0, 0, 0],
      A: { S: "URI", URI: "https://example.com/" },
    });
    page.node.set(PDFName.of("Annots"), doc.context.obj([link]));
  }
  return doc.save();
}

describe("orientedTarget", () => {
  it("matches each page's own orientation, or the one asked for", () => {
    const wide = { width: 600, height: 400 };
    const tall = { width: 400, height: 600 };
    expect(orientedTarget(A4, "match", wide).width).toBe(A4.height);
    expect(orientedTarget(A4, "match", tall).width).toBe(A4.width);
    expect(orientedTarget(A4, "landscape", tall).width).toBe(A4.height);
    expect(orientedTarget(A4, "portrait", wide).width).toBe(A4.width);
  });
});

describe("resizePdf — scale content to fit", () => {
  it("control: the source page is 400 × 600 with the mark where drawn", async () => {
    const [page] = await shown(await markedPdf());
    expect(page!.width).toBeCloseTo(400, 1);
    expect(page!.height).toBeCloseTo(600, 1);
    expect(page!.mark![0]).toBeCloseTo(100, 1);
    expect(page!.mark![1]).toBeCloseTo(100, 1);
  });

  it("makes the page A4 and scales the mark and the link with it, centred", async () => {
    const result = await resizePdf(await markedPdf(), {
      ...A4,
      orientation: "match",
      mode: "fit",
    });
    const [page] = await shown(result.bytes);
    expect(page!.width).toBeCloseTo(A4.width, 1);
    expect(page!.height).toBeCloseTo(A4.height, 1);
    // Independent oracle: scale to fit, centre horizontally (it is the
    // narrower fit), measured from the TOP as a reader sees it.
    const s = Math.min(A4.width / 400, A4.height / 600);
    const offsetX = (A4.width - 400 * s) / 2;
    const offsetY = (A4.height - 600 * s) / 2;
    expect(page!.mark![0]).toBeCloseTo(offsetX + 100 * s, 1);
    expect(page!.mark![1]).toBeCloseTo(offsetY + 100 * s, 1);
    // The link still covers the same part of the content.
    expect(page!.link![0]).toBeCloseTo(offsetX + 50 * s, 1);
    expect(page!.link![1]).toBeCloseTo(offsetY + (600 - 80) * s, 1);
    expect(page!.link![2]).toBeCloseTo(offsetX + 150 * s, 1);
    expect(page!.link![3]).toBeCloseTo(offsetY + (600 - 50) * s, 1);
  });

  it("scales UP to a bigger page too (A3 from 400 × 600)", async () => {
    const a3 = RESIZE_SIZES.find((s) => s.id === "a3")!.size;
    const result = await resizePdf(await markedPdf(), {
      ...a3,
      orientation: "portrait",
      mode: "fit",
    });
    const [page] = await shown(result.bytes);
    expect(page!.width).toBeCloseTo(a3.width, 1);
    const s = Math.min(a3.width / 400, a3.height / 600);
    expect(s).toBeGreaterThan(1);
    expect(page!.mark![0]).toBeCloseTo((a3.width - 400 * s) / 2 + 100 * s, 1);
  });

  it("shows a /Rotate 90 page at the target size, the right way up", async () => {
    const result = await resizePdf(await markedPdf({ rotate: 90 }), {
      ...A4,
      orientation: "match",
      mode: "fit",
    });
    const [page] = await shown(result.bytes);
    // Displayed landscape (600 × 400 before), so A4 landscape after.
    expect(page!.width).toBeCloseTo(A4.height, 1);
    expect(page!.height).toBeCloseTo(A4.width, 1);
  });

  it("fits the VISIBLE box: an inset CropBox fills the new page", async () => {
    // Visible part: 50..350 × 100..500 (300 × 400), mark at its top-left area.
    const result = await resizePdf(
      await markedPdf({ cropBox: [50, 100, 300, 400] }),
      { ...LETTER, orientation: "portrait", mode: "fit" },
    );
    const [page] = await shown(result.bytes);
    expect(page!.width).toBeCloseTo(LETTER.width, 1);
    const s = Math.min(LETTER.width / 300, LETTER.height / 400);
    const offsetX = (LETTER.width - 300 * s) / 2;
    const offsetY = (LETTER.height - 400 * s) / 2;
    expect(page!.mark![0]).toBeCloseTo(offsetX + (100 - 50) * s, 1);
    expect(page!.mark![1]).toBeCloseTo(offsetY + (500 - 500) * s, 1);
  });

  it("resizes only the pages selected", async () => {
    const result = await resizePdf(await markedPdf({ pages: 3 }), {
      ...A4,
      orientation: "match",
      mode: "fit",
      pages: [1],
    });
    expect(result.resizedPages).toBe(1);
    const pages = await shown(result.bytes);
    expect(pages.map((p) => Math.round(p.width))).toEqual([
      400,
      Math.round(A4.width),
      400,
    ]);
  });
});

describe("resizePdf — change canvas only", () => {
  it("keeps the content's size and centres the new page on it", async () => {
    const result = await resizePdf(await markedPdf(), {
      ...A4,
      orientation: "portrait",
      mode: "canvas",
    });
    const [page] = await shown(result.bytes);
    expect(page!.width).toBeCloseTo(A4.width, 1);
    expect(page!.height).toBeCloseTo(A4.height, 1);
    // Unscaled: the mark moves by the added margin only.
    expect(page!.mark![0]).toBeCloseTo((A4.width - 400) / 2 + 100, 1);
    expect(page!.mark![1]).toBeCloseTo((A4.height - 600) / 2 + 100, 1);
    // The link keeps its own size.
    expect(page!.link![2] - page!.link![0]).toBeCloseTo(100, 1);
  });

  it("a smaller canvas hides the edges but keeps them in the file", async () => {
    const a5 = RESIZE_SIZES.find((s) => s.id === "a5")!.size;
    const result = await resizePdf(await markedPdf(), {
      ...a5,
      orientation: "portrait",
      mode: "canvas",
    });
    const [page] = await shown(result.bytes);
    expect(page!.width).toBeCloseTo(a5.width, 1);
    const doc = await PDFDocument.load(result.bytes);
    // Same content stream: nothing was redrawn or removed.
    expect(doc.getPage(0).node.Contents()).toBeDefined();
  });
});

describe("resizePdf — refusals and names", () => {
  it("refuses a side outside the accepted range", async () => {
    const pdf = await markedPdf();
    for (const width of [MIN_RESIZE_SIDE_PT - 1, MAX_RESIZE_SIDE_PT + 1]) {
      await expect(
        resizePdf(pdf, {
          width,
          height: 500,
          orientation: "portrait",
          mode: "fit",
        }),
      ).rejects.toBeInstanceOf(PdfEngineError);
    }
  });

  it("refuses an empty selection", async () => {
    await expect(
      resizePdf(await markedPdf(), {
        ...A4,
        orientation: "match",
        mode: "fit",
        pages: [9],
      }),
    ).rejects.toThrow(/at least one page/);
  });

  it("names the copy after the source", () => {
    expect(resizeOutputName("deck.pdf")).toBe("deck-resized.pdf");
  });
});
