import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
  degrees,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import { cropPdf } from "./crop";
import { addHeaderFooter } from "./header-footer";
import { addPageNumbers } from "./page-numbers";
import { STAMP_POSITIONS } from "./stamp";
import { addWatermark } from "./watermark";

/**
 * Stamps land on the part of the page a viewer SHOWS.
 *
 * A viewer displays the CropBox (clipped to the MediaBox), not the MediaBox
 * from its origin. Page numbers, headers/footers and watermarks were placed
 * from `page.getSize()` — the MediaBox's width and height, measured from 0,0 —
 * so on a cropped page the footer was drawn in the region the crop hides, and
 * on a page whose MediaBox does not start at 0,0 it landed mid-body. Measured
 * at 67e8d0f: cropPdf(A4, 60/50/60/50) then addPageNumbers drew the label at
 * y 36..47, with the visible bottom edge at y 60. Crop PDF is our own tool, so
 * the two tools composed into an invisible result, reported as success.
 *
 * The expected box is computed HERE, independently, from the raw /CropBox and
 * /MediaBox arrays (normalized, intersected) — not from the helper the fix
 * added — and every drawn label is read back out of the saved file: its `Tm`
 * position and angle, and its text, so its width comes from the font metrics
 * rather than from the code under test.
 */

type Box = { x0: number; y0: number; x1: number; y1: number };

function rectOf(page: PDFPage, key: "CropBox" | "MediaBox"): Box | null {
  const arr = page.node.lookupMaybe(PDFName.of(key), PDFArray);
  if (!arr) return null;
  const [a, b, c, d] = arr
    .asArray()
    .map((n) => (n instanceof PDFNumber ? n.asNumber() : NaN));
  return {
    x0: Math.min(a!, c!),
    y0: Math.min(b!, d!),
    x1: Math.max(a!, c!),
    y1: Math.max(b!, d!),
  };
}

/** What a viewer shows: the CropBox clipped to the MediaBox. */
function shownBox(page: PDFPage): Box {
  const media = rectOf(page, "MediaBox")!;
  const crop = rectOf(page, "CropBox") ?? media;
  const box = {
    x0: Math.max(media.x0, crop.x0),
    y0: Math.max(media.y0, crop.y0),
    x1: Math.min(media.x1, crop.x1),
    y1: Math.min(media.y1, crop.y1),
  };
  return box.x1 > box.x0 && box.y1 > box.y0 ? box : media;
}

interface Drawn {
  text: string;
  size: number;
  /** Tm: text-space x axis direction and origin. */
  a: number;
  b: number;
  e: number;
  f: number;
}

/** Every string drawn on `page`, with its Tm and font size, from the file. */
function drawnText(page: PDFPage): Drawn[] {
  const contents = page.node.lookup(PDFName.of("Contents"));
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((r) => page.doc.context.lookup(r))
      : [contents];
  const out: Drawn[] = [];
  for (const stream of streams) {
    if (!(stream instanceof PDFRawStream)) continue;
    const ops = new TextDecoder("latin1").decode(
      decodePDFRawStream(stream).decode(),
    );
    const re =
      /([-\d.]+) Tf[\s\S]*?([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) Tm\s*<([0-9A-Fa-f]*)> Tj/g;
    for (const m of ops.matchAll(re)) {
      const hex = m[8]!;
      let text = "";
      for (let i = 0; i < hex.length; i += 2) {
        text += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      }
      out.push({
        text,
        size: Number(m[1]),
        a: Number(m[2]),
        b: Number(m[3]),
        e: Number(m[6]),
        f: Number(m[7]),
      });
    }
  }
  return out;
}

/** The label's four corners in content space. */
function corners(d: Drawn, font: PDFFont): [number, number][] {
  const w = font.widthOfTextAtSize(d.text, d.size);
  const h = font.heightAtSize(d.size);
  const [ux, uy] = [d.a, d.b]; // unit x axis of the rotated text
  const [vx, vy] = [-d.b, d.a]; // unit y axis
  return [
    [d.e, d.f],
    [d.e + w * ux, d.f + w * uy],
    [d.e + h * vx, d.f + h * vy],
    [d.e + w * ux + h * vx, d.f + w * uy + h * vy],
  ];
}

const inside = (box: Box, [x, y]: [number, number]) =>
  x >= box.x0 - 0.01 &&
  x <= box.x1 + 0.01 &&
  y >= box.y0 - 0.01 &&
  y <= box.y1 + 0.01;

/**
 * Twelve pages: three box shapes x four rotations.
 *  - "cropped by our own tool": A4, then cropPdf 60/50/60/50 (below)
 *  - "offset MediaBox": a MediaBox whose origin is not 0,0
 *  - "CropBox past the MediaBox, corners inverted": clip must still apply
 */
async function fixture(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const rotation of [0, 90, 180, 270]) {
    const a4 = doc.addPage([595, 842]);
    a4.setRotation(degrees(rotation));
    const offset = doc.addPage([595, 842]);
    offset.setMediaBox(-100, -392, 595, 842);
    offset.setRotation(degrees(rotation));
    const wild = doc.addPage([595, 842]);
    wild.node.set(
      PDFName.of("CropBox"),
      doc.context.obj([700, 900, 40, 30]), // inverted, and past the MediaBox
    );
    wild.setRotation(degrees(rotation));
  }
  const bytes = await doc.save();
  // Crop the A4 pages (0, 3, 6, 9) with the real Crop PDF engine.
  return cropPdf(bytes, {
    margins: { top: 60, right: 50, bottom: 60, left: 50 },
    pages: [0, 3, 6, 9],
  });
}

async function helvetica(bold = false): Promise<PDFFont> {
  const doc = await PDFDocument.create();
  return doc.embedFont(
    bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica,
  );
}

describe("stamps are drawn inside the box a viewer shows", () => {
  it("POSITIVE CONTROL: the fixture really has hidden regions", async () => {
    const doc = await PDFDocument.load(await fixture());
    const [cropped, offset] = doc.getPages();
    // The crop hides the bottom 60pt of the MediaBox...
    expect(shownBox(cropped!)).toEqual({ x0: 50, y0: 60, x1: 545, y1: 782 });
    // ...and the offset page's visible origin is not 0,0.
    expect(shownBox(offset!).y0).toBe(-392);
  });

  for (const position of STAMP_POSITIONS) {
    it(`page numbers at ${position}`, async () => {
      const font = await helvetica();
      const out = await PDFDocument.load(
        await addPageNumbers(await fixture(), { position }),
      );
      for (const [i, page] of out.getPages().entries()) {
        const labels = drawnText(page);
        expect(labels, `page ${i + 1}`).toHaveLength(1);
        for (const corner of corners(labels[0]!, font)) {
          expect(
            inside(shownBox(page), corner),
            `page ${i + 1} (${page.getRotation().angle}°) ${position}: ${corner} outside ${JSON.stringify(shownBox(page))}`,
          ).toBe(true);
        }
      }
    });
  }

  it("headers and footers, all six slots", async () => {
    const font = await helvetica();
    const out = await PDFDocument.load(
      await addHeaderFooter(await fixture(), {
        header: { left: "HL", center: "HC", right: "HR" },
        footer: { left: "FL", center: "FC", right: "FR" },
      }),
    );
    for (const [i, page] of out.getPages().entries()) {
      const labels = drawnText(page);
      expect(labels, `page ${i + 1}`).toHaveLength(6);
      for (const label of labels) {
        for (const corner of corners(label, font)) {
          expect(
            inside(shownBox(page), corner),
            `page ${i + 1} ${label.text}: ${corner}`,
          ).toBe(true);
        }
      }
    }
  });

  it("watermarks are centred on the visible page", async () => {
    const font = await helvetica(true);
    const out = await PDFDocument.load(
      await addWatermark(await fixture(), "DRAFT", { fontSize: 40 }),
    );
    for (const [i, page] of out.getPages().entries()) {
      const [label] = drawnText(page);
      const pts = corners(label!, font);
      const cx = pts.reduce((s, p) => s + p[0], 0) / 4;
      const cy = pts.reduce((s, p) => s + p[1], 0) / 4;
      const box = shownBox(page);
      expect(cx, `page ${i + 1} x`).toBeCloseTo((box.x0 + box.x1) / 2, 3);
      expect(cy, `page ${i + 1} y`).toBeCloseTo((box.y0 + box.y1) / 2, 3);
    }
  });
});
