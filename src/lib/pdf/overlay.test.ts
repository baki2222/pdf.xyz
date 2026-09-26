import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
  rgb,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import { PdfEngineError } from "./engine";
import {
  OVERLAY_LAYERS,
  clampOpacity,
  fitOverlayRect,
  neededOverlayIndices,
  overlayOutputName,
  overlayPageIndexFor,
  overlayPdf,
  placeOverlay,
  viewerRotation,
} from "./overlay";

/** A base PDF with the given page sizes (points). */
async function basePdf(sizes: [number, number][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const [w, h] of sizes) doc.addPage([w, h]);
  return doc.save();
}

/** An overlay PDF whose pages carry a distinctive filled rectangle. */
async function overlayDoc(
  pages = 1,
  size: [number, number] = [200, 100],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) {
    const page = doc.addPage(size);
    page.drawRectangle({
      x: 10,
      y: 10,
      width: 80,
      height: 40,
      color: rgb(0.9, 0.1, 0.1),
    });
  }
  return doc.save();
}

describe("fitOverlayRect", () => {
  it("fits inside the page preserving aspect ratio, centered", () => {
    const rect = fitOverlayRect({
      overlayWidth: 100,
      overlayHeight: 200,
      pageWidth: 300,
      pageHeight: 300,
      fit: "fit",
    });
    // min(300/100, 300/200) = 1.5 → 150 x 300
    expect(rect).toEqual({ x: 75, y: 0, width: 150, height: 300 });
  });

  it("stretches to exactly cover the page", () => {
    expect(
      fitOverlayRect({
        overlayWidth: 100,
        overlayHeight: 200,
        pageWidth: 300,
        pageHeight: 400,
        fit: "stretch",
      }),
    ).toEqual({ x: 0, y: 0, width: 300, height: 400 });
  });

  it("keeps the overlay's actual size, centered", () => {
    expect(
      fitOverlayRect({
        overlayWidth: 100,
        overlayHeight: 200,
        pageWidth: 300,
        pageHeight: 300,
        fit: "actual",
      }),
    ).toEqual({ x: 100, y: 50, width: 100, height: 200 });
  });

  it("scales small overlays up to fit", () => {
    const rect = fitOverlayRect({
      overlayWidth: 50,
      overlayHeight: 50,
      pageWidth: 200,
      pageHeight: 400,
      fit: "fit",
    });
    expect(rect).toEqual({ x: 0, y: 100, width: 200, height: 200 });
  });

  it("falls back to covering the page for degenerate sizes", () => {
    expect(
      fitOverlayRect({
        overlayWidth: 0,
        overlayHeight: 100,
        pageWidth: 300,
        pageHeight: 300,
        fit: "fit",
      }),
    ).toEqual({ x: 0, y: 0, width: 300, height: 300 });
  });
});

describe("viewerRotation", () => {
  it("normalizes quarter turns and ignores anything else, as pdf.js does", () => {
    expect([0, 90, 180, 270, 360, 450, -90, -270].map(viewerRotation)).toEqual([
      0, 90, 180, 270, 0, 90, 270, 90,
    ]);
    expect(viewerRotation(45)).toBe(0);
    expect(viewerRotation(Number.NaN)).toBe(0);
  });
});

describe("placeOverlay", () => {
  it("is the plain fit on an unrotated, uncropped page", () => {
    expect(
      placeOverlay({
        pageBox: { x: 0, y: 0, width: 612, height: 792 },
        pageRotation: 0,
        formWidth: 612,
        formHeight: 792,
        overlayRotation: 0,
        fit: "fit",
      }),
    ).toEqual({ x: 0, y: 0, width: 612, height: 792, rotate: 0 });
  });

  it("fits into the CropBox, offset by its origin", () => {
    // The Crop tool's 72pt margins on Letter: CropBox [72 72 540 720].
    expect(
      placeOverlay({
        pageBox: { x: 72, y: 72, width: 468, height: 648 },
        pageRotation: 0,
        formWidth: 468,
        formHeight: 648,
        overlayRotation: 0,
        fit: "stretch",
      }),
    ).toEqual({ x: 72, y: 72, width: 468, height: 648, rotate: 0 });
  });

  /**
   * The relationship, over every page and overlay rotation: map the form's
   * corners through the draw (translate, rotate, scale — pdf-lib's order) and
   * then through the base page's viewer transform, and each must land where
   * the overlay's OWN viewer puts that corner, scaled onto the page.
   */
  it("lands every corner where the overlay's own viewer shows it, for all 16 rotation pairs", () => {
    const box = { x: 30, y: 40, width: 500, height: 700 };
    const fw = 200;
    const fh = 100;
    // Content → viewer for a box turned clockwise by `rot` (origin bottom-left).
    const toViewer = (
      b: { x: number; y: number; width: number; height: number },
      rot: number,
      [px, py]: [number, number],
    ): [number, number] => {
      const dx = px - b.x;
      const dy = py - b.y;
      switch (rot) {
        case 90:
          return [dy, b.width - dx];
        case 180:
          return [b.width - dx, b.height - dy];
        case 270:
          return [b.height - dy, dx];
        default:
          return [dx, dy];
      }
    };
    let checked = 0;
    for (const r of [0, 90, 180, 270]) {
      for (const o of [0, 90, 180, 270]) {
        const place = placeOverlay({
          pageBox: box,
          pageRotation: r,
          formWidth: fw,
          formHeight: fh,
          overlayRotation: o,
          fit: "stretch",
        });
        const t = (place.rotate * Math.PI) / 180;
        const sx = place.width / fw;
        const sy = place.height / fh;
        const draw = ([u, v]: [number, number]): [number, number] => [
          place.x + Math.cos(t) * u * sx - Math.sin(t) * v * sy,
          place.y + Math.sin(t) * u * sx + Math.cos(t) * v * sy,
        ];
        const pageW = r % 180 ? box.height : box.width;
        const pageH = r % 180 ? box.width : box.height;
        const overW = o % 180 ? fh : fw;
        const overH = o % 180 ? fw : fh;
        const form = { x: 0, y: 0, width: fw, height: fh };
        const corners: [number, number][] = [
          [0, 0],
          [fw, 0],
          [0, fh],
          [fw, fh],
        ];
        for (const corner of corners) {
          const got = toViewer(box, r, draw(corner));
          const [ox, oy] = toViewer(form, o, corner);
          expect(got[0], `r=${r} o=${o}`).toBeCloseTo((ox / overW) * pageW, 6);
          expect(got[1], `r=${r} o=${o}`).toBeCloseTo((oy / overH) * pageH, 6);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(64);
  });
});

describe("overlayPageIndexFor", () => {
  it("always uses the first overlay page when repeating", () => {
    expect(overlayPageIndexFor(0, 3, "repeat")).toBe(0);
    expect(overlayPageIndexFor(5, 3, "repeat")).toBe(0);
  });

  it("cycles overlay pages in order, wrapping around", () => {
    const seq = [0, 1, 2, 3, 4].map((i) => overlayPageIndexFor(i, 2, "cycle"));
    expect(seq).toEqual([0, 1, 0, 1, 0]);
  });

  it("returns -1 when there are no overlay pages", () => {
    expect(overlayPageIndexFor(0, 0, "cycle")).toBe(-1);
    expect(overlayPageIndexFor(2, 0, "repeat")).toBe(-1);
  });
});

describe("neededOverlayIndices", () => {
  it("needs only the first page when repeating", () => {
    expect(neededOverlayIndices(5, 3, "repeat")).toEqual([0]);
  });

  it("needs only the reachable pages when cycling", () => {
    expect(neededOverlayIndices(3, 2, "cycle")).toEqual([0, 1]);
    expect(neededOverlayIndices(2, 5, "cycle")).toEqual([0, 1]);
    expect(neededOverlayIndices(5, 3, "cycle")).toEqual([0, 1, 2]);
  });

  it("needs nothing for empty inputs", () => {
    expect(neededOverlayIndices(0, 3, "cycle")).toEqual([]);
    expect(neededOverlayIndices(3, 0, "repeat")).toEqual([]);
  });
});

describe("clampOpacity", () => {
  it("clamps into [0, 1] and defaults NaN to opaque", () => {
    expect(clampOpacity(0.5)).toBe(0.5);
    expect(clampOpacity(2)).toBe(1);
    expect(clampOpacity(-1)).toBe(0);
    expect(clampOpacity(Number.NaN)).toBe(1);
  });
});

describe("overlayOutputName", () => {
  it("derives the name from the base file", () => {
    expect(overlayOutputName("contract.pdf")).toBe("contract-overlay.pdf");
    expect(overlayOutputName("")).toBe("document-overlay.pdf");
  });
});

describe("overlayPdf", () => {
  it("overlays a stamp on every page, preserving page count and sizes", async () => {
    const sizes: [number, number][] = [
      [612, 792],
      [400, 400],
      [800, 300],
    ];
    const base = await basePdf(sizes);
    const overlay = await overlayDoc(1);

    const result = await overlayPdf(base, overlay, {
      opacity: 0.5,
      fit: "fit",
    });
    expect(result.pageCount).toBe(3);
    expect(result.overlayPageCount).toBe(1);
    expect(result.opacity).toBe(0.5);
    // Overlaying adds content, so the output is larger than the base alone.
    expect(result.bytes.byteLength).toBeGreaterThan(base.byteLength);

    const out = await PDFDocument.load(result.bytes);
    expect(out.getPageCount()).toBe(3);
    expect(out.getCreator()).toBe("pdf.xyz");
    out.getPages().forEach((page, i) => {
      expect(page.getWidth()).toBeCloseTo(sizes[i]![0]);
      expect(page.getHeight()).toBeCloseTo(sizes[i]![1]);
    });
  });

  it("cycles through multi-page overlays", async () => {
    const base = await basePdf([
      [500, 500],
      [500, 500],
      [500, 500],
    ]);
    const overlay = await overlayDoc(2);
    const result = await overlayPdf(base, overlay, { paging: "cycle" });
    expect(result.pageCount).toBe(3);
    expect(result.overlayPageCount).toBe(2);
    expect(result.paging).toBe("cycle");
    const out = await PDFDocument.load(result.bytes);
    expect(out.getPageCount()).toBe(3);
  });

  it("clamps out-of-range opacity", async () => {
    const base = await basePdf([[300, 300]]);
    const overlay = await overlayDoc(1);
    const result = await overlayPdf(base, overlay, { opacity: 5 });
    expect(result.opacity).toBe(1);
  });

  /** Every content stream of page 1, decoded, in paint order. */
  async function paintOrder(bytes: Uint8Array): Promise<string[]> {
    const doc = await PDFDocument.load(bytes);
    const contents = doc.getPage(0).node.Contents();
    expect(contents).toBeInstanceOf(PDFArray);
    const arr = contents as PDFArray;
    return Array.from({ length: arr.size() }, (_, i) => {
      const stream = arr.lookup(i);
      expect(stream).toBeInstanceOf(PDFRawStream);
      return new TextDecoder().decode(
        decodePDFRawStream(stream as PDFRawStream).decode(),
      );
    });
  }

  /** q/Q never underflow and end balanced across the whole page. */
  function balanced(streams: string[]): boolean {
    let depth = 0;
    for (const token of streams.join("\n").split(/\s+/)) {
      if (token === "q") depth += 1;
      if (token === "Q") depth -= 1;
      if (depth < 0) return false;
    }
    return depth === 0;
  }

  it("paints the overlay last on top, FIRST behind content, and keeps q/Q balanced", async () => {
    const base = await (async () => {
      const doc = await PDFDocument.create();
      doc.addPage([300, 300]).drawRectangle({
        x: 10,
        y: 10,
        width: 50,
        height: 50,
        color: rgb(0, 0, 0),
      });
      return doc.save();
    })();
    const overlay = await overlayDoc(1);
    const seen: string[] = [];
    for (const { id } of OVERLAY_LAYERS) {
      const result = await overlayPdf(base, overlay, { layer: id });
      expect(result.layer).toBe(id);
      const streams = await paintOrder(result.bytes);
      const drawsOverlay = streams.map((s) =>
        /\/EmbeddedPdfPage-\d+ Do/.test(s),
      );
      expect(drawsOverlay.filter(Boolean), id).toHaveLength(1);
      const at = drawsOverlay.indexOf(true);
      expect(at, id).toBe(id === "back" ? 0 : streams.length - 1);
      // The base's own drawing is still there — after the overlay when behind.
      const baseAt = streams.findIndex((s) => /\b0 0 0 rg\b/.test(s));
      expect(baseAt, id).toBeGreaterThanOrEqual(0);
      expect(baseAt > at, id).toBe(id === "back");
      expect(balanced(streams), id).toBe(true);
      seen.push(id);
    }
    expect(seen.sort()).toEqual(["back", "front", "multiply"]);
  });

  it("uses a Multiply blend only for the multiply layer", async () => {
    const base = await basePdf([[300, 300]]);
    const overlay = await overlayDoc(1);
    for (const { id } of OVERLAY_LAYERS) {
      const out = await PDFDocument.load(
        (await overlayPdf(base, overlay, { layer: id })).bytes,
      );
      const states = out
        .getPage(0)
        .node.Resources()!
        .lookup(PDFName.of("ExtGState"));
      expect(String(states).includes("/Multiply"), id).toBe(id === "multiply");
    }
  });

  it("rejects a base file that isn't a PDF", async () => {
    const notPdf = new TextEncoder().encode("this is not a pdf");
    const overlay = await overlayDoc(1);
    await expect(overlayPdf(notPdf, overlay)).rejects.toBeInstanceOf(
      PdfEngineError,
    );
  });

  it("rejects an overlay that isn't a PDF", async () => {
    const base = await basePdf([[300, 300]]);
    const notPdf = new TextEncoder().encode("this is not a pdf");
    await expect(overlayPdf(base, notPdf)).rejects.toBeInstanceOf(
      PdfEngineError,
    );
  });
});
