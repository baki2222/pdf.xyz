// @native-canvas
import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { readAsViewer, type Box } from "@/tests/pdf-viewer-read";
import { proveGlyphs } from "@/tests/unicode-fonts";
import { exportEditedPdf, readExportFrames } from "./editor-export";
import {
  DEFAULT_TEXT_STYLE,
  NOTE_PADDING,
  type EditorObject,
} from "./editor/model";
import { lineBaseline } from "./editor/text";

/**
 * The editor's export, read back the way a READER receives it: pdf.js and
 * its viewport, where `/Rotate` and the CropBox are applied. Positions are
 * asserted in the frame the editor stores them in (viewer points, top-left
 * origin) after converting pdf.js's bottom-left reading — never by reading
 * our own mapping back to itself.
 */

const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64",
  ),
);

const TOL = 1; // ±1 pt, the editor's promise

async function page(opts: {
  rotate: number;
  crop?: Box;
  media?: Box;
  text?: string;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const p = doc.addPage([612, 792]);
  if (opts.text) {
    p.drawText(opts.text, {
      x: 60,
      y: 60,
      size: 10,
      font: await doc.embedFont(StandardFonts.Helvetica),
    });
  }
  if (opts.media) p.setMediaBox(...opts.media);
  if (opts.crop) p.setCropBox(...opts.crop);
  p.setRotation(degrees(opts.rotate));
  return doc.save();
}

const style = { ...DEFAULT_TEXT_STYLE, size: 14 };

/** One of each kind, all inside 400 × 400 so every geometry below fits them. */
function objects(): EditorObject[] {
  return [
    {
      id: "t",
      kind: "text",
      page: 0,
      x: 72,
      y: 40,
      width: 200,
      text: "PLACED",
      ...style,
    },
    {
      id: "t2",
      kind: "text",
      page: 0,
      x: 100,
      y: 300,
      width: 120,
      text: "RIGHTSIDE",
      ...style,
      align: "right",
    },
    {
      id: "r",
      kind: "shape",
      shape: "rect",
      page: 0,
      x: 100,
      y: 100,
      width: 80,
      height: 30,
      stroke: "#ff0000",
      strokeWidth: 2,
      fill: null,
      opacity: 1,
    },
    {
      id: "e",
      kind: "shape",
      shape: "ellipse",
      page: 0,
      x: 220,
      y: 100,
      width: 60,
      height: 40,
      stroke: null,
      strokeWidth: 1,
      fill: "#00ff00",
      opacity: 0.5,
    },
    {
      id: "l",
      kind: "line",
      page: 0,
      x1: 20,
      y1: 200,
      x2: 120,
      y2: 200,
      arrow: true,
      stroke: "#000000",
      strokeWidth: 2,
      opacity: 1,
    },
    {
      id: "w",
      kind: "whiteout",
      page: 0,
      x: 300,
      y: 200,
      width: 50,
      height: 20,
    },
    {
      id: "h",
      kind: "highlight",
      page: 0,
      x: 300,
      y: 250,
      width: 70,
      height: 14,
      color: "#facc15",
      opacity: 0.4,
    },
    {
      id: "k",
      kind: "ink",
      page: 0,
      points: [
        { x: 30, y: 330 },
        { x: 60, y: 350 },
        { x: 90, y: 320 },
      ],
      stroke: "#1d4ed8",
      strokeWidth: 3,
      opacity: 1,
    },
    {
      id: "i",
      kind: "image",
      page: 0,
      x: 200,
      y: 300,
      width: 40,
      height: 20,
      format: "png",
      bytes: PNG_1X1,
      opacity: 1,
    },
    {
      id: "n",
      kind: "note",
      page: 0,
      x: 250,
      y: 340,
      width: 120,
      text: "NOTEWORD",
      fill: "#fef08a",
      ...style,
      size: 10,
    },
  ];
}

const GEOMETRIES: { name: string; crop?: Box; media?: Box }[] = [
  { name: "plain" },
  { name: "cropped", crop: [40, 55, 520, 690] },
  { name: "offset MediaBox", media: [100, 50, 500, 700] },
];

/** pdf.js reads bottom-left, y up; the editor stores top-left, y down. */
function topLeft(b: Box, height: number) {
  return { x: b[0], y: height - b[3], width: b[2] - b[0], height: b[3] - b[1] };
}

describe("the editor's export lands where the overlay drew it", () => {
  for (const g of GEOMETRIES) {
    for (const rotate of [0, 90, 180, 270]) {
      it(`${g.name}, /Rotate ${rotate}`, async () => {
        const base = await page({ rotate, crop: g.crop, media: g.media });
        const out = await exportEditedPdf(base, objects());
        const read = await readAsViewer(out.bytes);
        const H = read.height;

        // The UI sizes pages from readExportFrames: it must be the reader's size.
        const [frame] = await readExportFrames(base);
        expect(frame!.width).toBeCloseTo(read.width, 6);
        expect(frame!.height).toBeCloseTo(read.height, 6);

        // Health: everything was drawn and read.
        expect(out.objectCount).toBe(10);
        expect(read.texts.map((t) => t.str).sort()).toEqual([
          "NOTEWORD",
          "PLACED",
          "RIGHTSIDE",
        ]);
        expect(read.images).toHaveLength(1);
        for (const t of read.texts) expect(t.upright, t.str).toBe(true);

        const text = (s: string) => read.texts.find((t) => t.str === s)!;
        // Text: left edge and baseline.
        expect(text("PLACED").x).toBeCloseTo(72, 0);
        expect(Math.abs(text("PLACED").x - 72)).toBeLessThan(TOL);
        expect(
          Math.abs(H - text("PLACED").y - (40 + lineBaseline(0, style))),
        ).toBeLessThan(TOL);
        // Right-aligned: its RIGHT edge sits on the box's right edge.
        const right = text("RIGHTSIDE");
        expect(Math.abs(right.x + right.width - 220)).toBeLessThan(TOL);
        // Note words inset by the padding.
        expect(
          Math.abs(text("NOTEWORD").x - (250 + NOTE_PADDING)),
        ).toBeLessThan(TOL);

        const boxes = read.paths.map((p) => topLeft(p, H));
        const has = (
          want: { x: number; y: number; width: number; height: number },
          slack = TOL,
        ) =>
          boxes.some(
            (b) =>
              Math.abs(b.x - want.x) < slack &&
              Math.abs(b.y - want.y) < slack &&
              Math.abs(b.width - want.width) < slack &&
              Math.abs(b.height - want.height) < slack,
          );
        expect(has({ x: 100, y: 100, width: 80, height: 30 }), "rect").toBe(
          true,
        );
        expect(has({ x: 220, y: 100, width: 60, height: 40 }), "ellipse").toBe(
          true,
        );
        expect(
          has({ x: 20, y: 200, width: 100, height: 0 }),
          "arrow shaft",
        ).toBe(true);
        expect(has({ x: 300, y: 200, width: 50, height: 20 }), "whiteout").toBe(
          true,
        );
        expect(
          has({ x: 300, y: 250, width: 70, height: 14 }),
          "highlight",
        ).toBe(true);
        expect(has({ x: 30, y: 320, width: 60, height: 30 }), "ink").toBe(true);
        // The note's paper: words + padding tall, at its top-left.
        expect(
          boxes.some(
            (b) =>
              Math.abs(b.x - 250) < TOL &&
              Math.abs(b.y - 340) < TOL &&
              Math.abs(b.width - 120) < TOL,
          ),
          "note",
        ).toBe(true);
        // Arrowheads point the way it was drawn: behind the tip (120, 200).
        const heads = boxes.filter(
          (b) => Math.abs(b.x + b.width - 120) < TOL && b.x < 119 && b.x > 100,
        );
        expect(heads.length).toBe(2);

        const img = topLeft(read.images[0]!, H);
        expect(Math.abs(img.x - 200)).toBeLessThan(TOL);
        expect(Math.abs(img.y - 300)).toBeLessThan(TOL);
        expect(Math.abs(img.width - 40)).toBeLessThan(TOL);
        expect(Math.abs(img.height - 20)).toBeLessThan(TOL);
      });
    }
  }

  it("control: a misplaced object fails the same reading", async () => {
    // The comparison above must be able to see a wrong position, or it
    // certifies anything.
    const base = await page({ rotate: 90 });
    const shifted = objects().map((o) =>
      o.id === "r" && o.kind === "shape" ? { ...o, x: o.x + 5 } : o,
    );
    const read = await readAsViewer(
      (await exportEditedPdf(base, shifted)).bytes,
    );
    const boxes = read.paths.map((p) => topLeft(p, read.height));
    expect(
      boxes.some(
        (b) =>
          Math.abs(b.x - 100) < TOL &&
          Math.abs(b.y - 100) < TOL &&
          Math.abs(b.width - 80) < TOL,
      ),
    ).toBe(false);
  });
});

describe("the export keeps the page and writes many objects on many pages", () => {
  it("keeps existing text and draws on two pages in one run", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([612, 792]).drawText("ORIGINAL ONE", { x: 50, y: 700, font });
    const second = doc.addPage([612, 792]);
    second.drawText("ORIGINAL TWO", { x: 50, y: 700, font });
    second.setRotation(degrees(90));
    const base = await doc.save();

    const out = await exportEditedPdf(base, [
      {
        id: "a",
        kind: "text",
        page: 0,
        x: 72,
        y: 72,
        width: 300,
        text: "FIRST PAGE ADD",
        ...style,
      },
      {
        id: "b",
        kind: "text",
        page: 1,
        x: 72,
        y: 72,
        width: 300,
        text: "SECOND PAGE ADD",
        ...style,
      },
      {
        id: "c",
        kind: "whiteout",
        page: 1,
        x: 10,
        y: 10,
        width: 40,
        height: 40,
      },
    ]);
    expect(out.pageCount).toBe(2);
    expect(out.counts.text).toBe(2);
    expect(out.counts.whiteout).toBe(1);
    const one = await readAsViewer(out.bytes, 1);
    const two = await readAsViewer(out.bytes, 2);
    expect(one.texts.map((t) => t.str)).toEqual(
      expect.arrayContaining(["ORIGINAL ONE", "FIRST PAGE ADD"]),
    );
    expect(two.texts.map((t) => t.str)).toEqual(
      expect.arrayContaining(["ORIGINAL TWO", "SECOND PAGE ADD"]),
    );
    // Rotated page two: the addition reads upright where it was placed.
    const added = two.texts.find((t) => t.str === "SECOND PAGE ADD")!;
    expect(added.upright).toBe(true);
    expect(Math.abs(added.x - 72)).toBeLessThan(TOL);
    expect(
      Math.abs(two.height - added.y - (72 + lineBaseline(0, style))),
    ).toBeLessThan(TOL);
  });

  it("a whiteout covers but does not remove: the covered words stay extractable", async () => {
    const base = await page({ rotate: 0, text: "SECRET 12345" });
    const out = await exportEditedPdf(base, [
      {
        id: "w",
        kind: "whiteout",
        page: 0,
        x: 50,
        y: 720,
        width: 120,
        height: 20,
      },
    ]);
    const read = await readAsViewer(out.bytes);
    expect(read.texts.map((t) => t.str)).toContain("SECRET 12345");
  });

  it("wraps text inside its box width, line by line, downward", async () => {
    const base = await page({ rotate: 0 });
    const out = await exportEditedPdf(base, [
      {
        id: "t",
        kind: "text",
        page: 0,
        x: 50,
        y: 50,
        width: 80,
        text: "alpha beta gamma delta",
        ...style,
      },
    ]);
    const read = await readAsViewer(out.bytes);
    expect(read.texts.length).toBeGreaterThan(1);
    for (const t of read.texts) {
      expect(t.x).toBeGreaterThanOrEqual(50 - TOL);
      expect(t.x + t.width).toBeLessThanOrEqual(130 + TOL);
    }
    const ys = read.texts.map((t) => read.height - t.y);
    expect(
      Math.abs(ys[1]! - ys[0]! - style.size * style.lineHeight),
    ).toBeLessThan(TOL);
  });

  it("refuses an object that is entirely off its page, before drawing", async () => {
    const base = await page({ rotate: 0 });
    await expect(
      exportEditedPdf(base, [
        {
          id: "w",
          kind: "whiteout",
          page: 0,
          x: 900,
          y: 10,
          width: 10,
          height: 10,
        },
      ]),
    ).rejects.toThrow(/entirely off the page/);
    await expect(
      exportEditedPdf(base, [
        {
          id: "w",
          kind: "whiteout",
          page: 3,
          x: 1,
          y: 1,
          width: 10,
          height: 10,
        },
      ]),
    ).rejects.toThrow(/page 4, which this PDF does not have/);
  });

  it("refuses an empty list (an empty text box counts as nothing)", async () => {
    const base = await page({ rotate: 0 });
    await expect(
      exportEditedPdf(base, [
        {
          id: "t",
          kind: "text",
          page: 0,
          x: 1,
          y: 1,
          width: 50,
          text: "  ",
          ...style,
        },
      ]),
    ).rejects.toThrow(/at least one item/);
  });
});

describe("text in other scripts is drawn with real glyphs", () => {
  it("Bengali: extractable, drawn glyphs, none of them .notdef", async () => {
    const base = await page({ rotate: 90 });
    const words = "আমার সোনার বাংলা";
    // Bengali alone first: `proveGlyphs` reads EVERY string in the content
    // stream as 2-byte glyph ids, so a standard-font run beside it would be
    // misread as glyphs (measured: "Latin beside" came back as six "empty
    // outline" ids, 0x4C61 = "La").
    const alone = await exportEditedPdf(base, [
      {
        id: "b",
        kind: "text",
        page: 0,
        x: 60,
        y: 60,
        width: 300,
        text: words,
        ...style,
      },
    ]);
    const proof = await proveGlyphs(alone.bytes);
    expect(proof.embeddedFonts).toBe(1);
    expect(proof.glyphIds.length).toBeGreaterThan(0);
    expect(proof.notdefIds).toEqual([]);
    expect(proof.emptyOutlineIds).toEqual([]);
    expect(proof.untranslatableIds).toEqual([]);
    // Then beside a Latin box, which keeps its standard face.
    const out = await exportEditedPdf(base, [
      {
        id: "b",
        kind: "text",
        page: 0,
        x: 60,
        y: 60,
        width: 300,
        text: words,
        ...style,
      },
      {
        id: "l",
        kind: "text",
        page: 0,
        x: 60,
        y: 160,
        width: 300,
        text: "Latin beside",
        ...style,
      },
    ]);
    const read = await readAsViewer(out.bytes);
    const joined = read.texts.map((t) => t.str).join(" ");
    expect(joined).toContain("Latin beside");
    // pdf.js extracts the Bengali through /ToUnicode (shaping may reorder
    // vowel signs, so compare letters as a set).
    for (const ch of ["আ", "ম", "স", "ন", "ব", "ল"])
      expect(joined).toContain(ch);
  });

  it("a Bengali box and a Chinese box on one page each get their own face", async () => {
    const base = await page({ rotate: 0 });
    const out = await exportEditedPdf(base, [
      {
        id: "b",
        kind: "text",
        page: 0,
        x: 60,
        y: 60,
        width: 300,
        text: "বাংলা",
        ...style,
      },
      {
        id: "c",
        kind: "text",
        page: 0,
        x: 60,
        y: 160,
        width: 300,
        text: "机密文件",
        ...style,
      },
    ]);
    const proof = await proveGlyphs(out.bytes);
    expect(proof.embeddedFonts).toBe(2);
    expect(proof.notdefIds).toEqual([]);
  });

  it("one box may carry Bengali with Latin beside it; two non-Latin scripts in one box are refused", async () => {
    const base = await page({ rotate: 0 });
    const out = await exportEditedPdf(base, [
      {
        id: "m",
        kind: "text",
        page: 0,
        x: 60,
        y: 60,
        width: 400,
        text: "বাংলা and English",
        ...style,
      },
    ]);
    const proof = await proveGlyphs(out.bytes);
    expect(proof.embeddedFonts).toBe(1);
    expect(proof.notdefIds).toEqual([]);
    expect(proof.untranslatableIds).toEqual([]);
    await expect(
      exportEditedPdf(base, [
        {
          id: "x",
          kind: "text",
          page: 0,
          x: 60,
          y: 60,
          width: 400,
          text: "বাংলা 机密",
          ...style,
        },
      ]),
    ).rejects.toThrow(/mixes/);
  });
});

describe("what the export keeps", () => {
  it("keeps a form field's value and the document title", async () => {
    const doc = await PDFDocument.create();
    doc.setTitle("Kept Title");
    const p = doc.addPage([612, 792]);
    const field = doc.getForm().createTextField("name");
    field.setText("Ada");
    field.addToPage(p, { x: 50, y: 600, width: 200, height: 24 });
    const base = await doc.save();
    const out = await exportEditedPdf(base, [
      {
        id: "t",
        kind: "text",
        page: 0,
        x: 72,
        y: 72,
        width: 200,
        text: "Added",
        ...style,
      },
    ]);
    const after = await PDFDocument.load(out.bytes);
    expect(after.getTitle()).toBe("Kept Title");
    expect(after.getForm().getTextField("name").getText()).toBe("Ada");
    expect(after.getPageCount()).toBe(1);
  });
});
