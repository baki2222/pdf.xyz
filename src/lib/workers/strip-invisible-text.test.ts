// @vitest-environment node
// @native-canvas
/**
 * Redo's pre-pass (`./strip-invisible-text`), judged by what a READER gets
 * (pdf.js's text of the saved file) and by the operators left in the
 * stream — never by the pass's own counters alone.
 *
 * Each shape OCRmyPDF 14's `--redo-ocr` keeps (#290: the mode set before
 * `BT`, and OCRmyPDF's own Form XObject layer) is built with the in-image
 * proof's own fixture builder, so the two cannot drift apart; the shape it
 * already removes (Tesseract's) is here too. Every fixture is first shown
 * to carry its stale words (the positive control), so "gone" can never pass
 * over a layer that was never there.
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFPage,
  PDFRawStream,
  PDFRef,
  StandardFonts,
  decodePDFRawStream,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import { latin1, parseContent } from "@/lib/pdf/editor/content-stream";
import { readAsViewer } from "@/tests/pdfjs-viewer";
import {
  OPEN_PASSWORD_FIXTURE,
  readRestrictedFixture,
} from "@/tests/restricted-pdf-fixtures";
import {
  REDO_OCR_LAYER_SHAPES,
  STALE_OCR_TEXT,
  withStaleOcrLayer,
} from "./ocr-redo-proof";
import {
  stripContentStream,
  stripInvisibleText,
  type DoOutcome,
} from "./strip-invisible-text";

const enc = (s: string) => new TextEncoder().encode(s);
const ops = (bytes: Uint8Array) => parseContent(bytes).map((o) => o.op);
const strip = (
  s: string,
  mode = 0,
  resolve?: Parameters<typeof stripContentStream>[2],
) => stripContentStream(enc(s), mode, resolve);
const text = (bytes: Uint8Array) => latin1(bytes).replace(/\s+/g, " ").trim();

const viewerText = async (pdf: Uint8Array) =>
  (await readAsViewer(pdf)).flatMap((p) => p.runs.map((r) => r.str)).join(" ");

const TYPED = "Typed heading zephyr 5521";

async function blankScan(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return doc.save();
}

/** `pdf` with a visible typed line drawn on page 1. */
async function withTyped(pdf: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.getPage(0).drawText(TYPED, { x: 40, y: 780, size: 18, font });
  return doc.save({ useObjectStreams: false });
}

/** Decoded content of the page (all its streams) as text. */
async function pageOps(pdf: Uint8Array, index = 0): Promise<string[]> {
  const doc = await PDFDocument.load(pdf);
  const contents = doc.getPage(index).node.get(PDFName.of("Contents"));
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents!];
  return refs.flatMap((ref) => {
    const stream = doc.context.lookup(ref as PDFRef) as PDFRawStream;
    return ops(decodePDFRawStream(stream).decode());
  });
}

describe("stripContentStream — the text render mode, as graphics state tracks it", () => {
  it("removes a show drawn with 3 Tr inside BT (the shape Tesseract writes)", () => {
    const s = strip("q BT /F1 14 Tf 3 Tr 40 60 Td (stale) Tj ET Q");
    expect(s.removed).toBe(1);
    expect(text(s.bytes)).toBe("q BT /F1 14 Tf 3 Tr 40 60 Td ET Q");
  });

  it("removes a show whose 3 Tr was set BEFORE BT, since BT does not reset the mode", () => {
    const s = strip(
      "q 3 Tr BT /F1 14 Tf 40 60 Td (stale) Tj ET BT (more) Tj ET Q",
    );
    expect(s.removed).toBe(2);
    expect(ops(s.bytes)).not.toContain("Tj");
  });

  it("control: Q restores the mode q saved, so text after it is visible and kept", () => {
    const src = enc("q 3 Tr Q BT /F1 12 Tf (typed) Tj ET");
    const s = stripContentStream(src);
    expect(s.changed).toBe(false);
    expect(s.bytes).toBe(src);
    expect(s.paints).toBe(true);
  });

  it("keeps visible text in every painting mode, and clip-only mode 7", () => {
    for (const mode of [0, 1, 2, 4, 5, 6, 7]) {
      const s = strip(`BT ${mode} Tr (shown) Tj ET`);
      expect(s.changed, `mode ${mode}`).toBe(false);
      expect(s.paints, `mode ${mode}`).toBe(mode !== 7);
    }
  });

  it("turns an invisible ' and \" into the line move and spacing they also make", () => {
    const s = strip("BT 14 TL 3 Tr (a) ' 1.5 2 (b) \" ET");
    expect(s.removed).toBe(2);
    expect(text(s.bytes)).toBe("BT 14 TL 3 Tr T* 1.5 Tw 2 Tc T* ET");
  });

  it("removes a TJ whole, strings holding ET, parentheses or Tr included", () => {
    const s = strip("BT 3 Tr [(a\\)ET 3 Tr) -250 (b)] TJ ET");
    expect(s.removed).toBe(1);
    expect(text(s.bytes)).toBe("BT 3 Tr ET");
  });

  it("control: a '3 Tr' inside a string is not an operator", () => {
    const s = strip("BT (3 Tr) Tj ET");
    expect(s.changed).toBe(false);
  });

  it("keeps an invisible show whose advance a later visible show relies on", () => {
    const relied = strip("BT 3 Tr (hidden) Tj 0 Tr (shown) Tj ET");
    expect(relied.changed).toBe(false);
    expect(relied.keptForPosition).toBe(1);
    // ...and removes it once the pen is placed again before the visible text.
    for (const place of ["10 0 Td", "1 0 0 1 9 9 Tm", "T*", "0 -14 TD"]) {
      const placed = strip(`BT 3 Tr (hidden) Tj 0 Tr ${place} (shown) Tj ET`);
      expect(placed.removed, place).toBe(1);
      expect(text(placed.bytes), place).toBe(
        `BT 3 Tr 0 Tr ${place} (shown) Tj ET`,
      );
    }
  });

  it("never touches a path, a shading, an image or an inline image", () => {
    const src =
      "q 3 Tr 0 0 m 10 10 l S 0 0 5 5 re f /Sh0 sh /Im1 Do BI /W 1 /H 1 /BPC 8 /CS /G ID \u0080 EI BT (h) Tj ET Q";
    const s = strip(src);
    expect(s.removed).toBe(1);
    expect(ops(s.bytes)).toEqual(ops(enc(src)).filter((o) => o !== "Tj"));
    expect(s.paints).toBe(true);
  });

  it("asks about a Do with the mode in force there, and applies the answer", () => {
    const seen: [string, number][] = [];
    const answer: Record<string, DoOutcome> = {
      Keep: { kind: "keep", paints: true },
      Drop: { kind: "drop", removed: 4 },
      Copy: { kind: "rename", name: "PdfxyzRedo1", removed: 2 },
    };
    const s = strip("/Keep Do q 3 Tr /Drop Do Q /Copy Do", 0, (name, mode) => {
      seen.push([name, mode]);
      return answer[name]!;
    });
    expect(seen).toEqual([
      ["Keep", 0],
      ["Drop", 3],
      ["Copy", 0],
    ]);
    expect(text(s.bytes)).toBe("/Keep Do q 3 Tr Q /PdfxyzRedo1 Do");
    expect(s.removed).toBe(6);
  });

  it("a form's inherited mode counts: text with no Tr of its own is invisible under 3", () => {
    expect(strip("BT (inherited) Tj ET", 3).removed).toBe(1);
    expect(strip("BT (inherited) Tj ET", 0).changed).toBe(false);
  });
});

describe("stripInvisibleText — what a reader of the PDF gets", () => {
  it("health check: the proof's table names three shapes", () => {
    expect(REDO_OCR_LAYER_SHAPES).toEqual([
      "tesseract",
      "ocrmypdf",
      "mode-before-text",
    ]);
  });

  it.each(REDO_OCR_LAYER_SHAPES)(
    "the %s layer: its words are text before, and gone after",
    async (shape) => {
      const pdf = await withStaleOcrLayer(await blankScan(), shape);
      expect(await viewerText(pdf)).toContain(STALE_OCR_TEXT);
      const out = await stripInvisibleText(pdf);
      expect(out.pagesChanged).toBe(1);
      expect(out.removed).toBeGreaterThan(0);
      expect(await viewerText(out.bytes)).not.toMatch(/walrus|quixotic|9031/);
    },
  );

  it("typed text survives beside every stale shape at once", async () => {
    let pdf = await withTyped(await blankScan());
    for (const shape of REDO_OCR_LAYER_SHAPES)
      pdf = await withStaleOcrLayer(pdf, shape);
    const before = await viewerText(pdf);
    expect(before).toContain(TYPED);
    expect(before).toContain(STALE_OCR_TEXT);
    const out = await stripInvisibleText(pdf);
    const after = await viewerText(out.bytes);
    expect(after).toContain(TYPED);
    expect(after).not.toMatch(/walrus|quixotic|9031/);
  });

  it("returns the very same bytes when there is no invisible text", async () => {
    const pdf = await withTyped(await blankScan());
    const out = await stripInvisibleText(pdf);
    expect(out.bytes).toBe(pdf);
    expect(out.pagesChanged).toBe(0);
  });

  it("drops the Do of OCRmyPDF's form layer, leaving the form itself as it was", async () => {
    const pdf = await withStaleOcrLayer(await blankScan(), "ocrmypdf");
    expect(await pageOps(pdf)).toContain("Do");
    const out = await stripInvisibleText(pdf);
    expect(await pageOps(out.bytes)).not.toContain("Do");
  });

  it("a form that also paints is copied without its invisible text; the original, which another page draws, is untouched", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const formBytes = `0 0 1 rg 10 10 100 100 re f BT /F1 14 Tf 3 Tr 40 60 Td ${hex(font.encodeText(STALE_OCR_TEXT).toString())} Tj ET`;
    const form = doc.context.register(
      // Stored ASCIIHex-encoded, so a copy that carried the original's
      // /Filter over its own Flate bytes would not decode.
      doc.context.stream(asciiHex(formBytes), {
        Type: "XObject",
        Subtype: "Form",
        Filter: "ASCIIHexDecode",
        BBox: [0, 0, 595, 842],
        Resources: { Font: { F1: font.ref } },
      }),
    );
    for (let i = 0; i < 2; i++) {
      const page = doc.addPage([595, 842]);
      const name = page.node.newXObject("Mixed", form);
      rawContent(doc, page, `q ${name.asString()} Do Q`);
    }
    const pdf = await doc.save({ useObjectStreams: false });
    expect(await viewerText(pdf)).toContain(STALE_OCR_TEXT);
    const out = await stripInvisibleText(pdf);
    expect(await viewerText(out.bytes)).not.toMatch(/walrus|quixotic|9031/);
    const loaded = await PDFDocument.load(out.bytes);
    // The original form's stream is byte-for-byte what it was.
    const original = loaded.context.lookup(form) as PDFRawStream;
    expect(latin1(decodePDFRawStream(original).decode())).toBe(formBytes);
    // Each page now draws a copy, and the copy still paints the square.
    for (const index of [0, 1]) {
      const page = loaded.getPage(index);
      const drawn = (await pageOps(out.bytes, index)).filter((o) => o === "Do");
      expect(drawn).toHaveLength(1);
      const xobjects = page.node
        .Resources()!
        .lookup(PDFName.of("XObject"), PDFDict);
      const copyName = xobjects
        .keys()
        .map((k) => k.asString())
        .find((k) => k.startsWith("/PdfxyzRedo"));
      expect(copyName).toBeDefined();
      const copy = loaded.context.lookup(
        xobjects.get(PDFName.of(copyName!.slice(1))),
      ) as PDFRawStream;
      const copyOps = ops(decodePDFRawStream(copy).decode());
      expect(copyOps).toEqual(["rg", "re", "f", "BT", "Tf", "Tr", "Td", "ET"]);
      expect(copy.dict.get(PDFName.of("Subtype"))).toBe(PDFName.of("Form"));
    }
  });

  it("a form drawn under 3 Tr with no Tr of its own is invisible, and dropped", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const form = doc.context.register(
      doc.context.stream(
        `BT /F1 14 Tf 40 60 Td ${hex(font.encodeText(STALE_OCR_TEXT).toString())} Tj ET`,
        {
          Type: "XObject",
          Subtype: "Form",
          BBox: [0, 0, 595, 842],
          Resources: { Font: { F1: font.ref } },
        },
      ),
    );
    const page = doc.addPage([595, 842]);
    const name = page.node.newXObject("Inherit", form);
    rawContent(doc, page, `q 3 Tr ${name.asString()} Do Q`);
    const pdf = await doc.save({ useObjectStreams: false });
    expect(await viewerText(pdf)).toContain(STALE_OCR_TEXT);
    const out = await stripInvisibleText(pdf);
    expect(await pageOps(out.bytes)).not.toContain("Do");
    expect(await viewerText(out.bytes)).not.toMatch(/walrus|quixotic|9031/);
  });

  it("a form with no resources of its own is judged with each caller's: one page's answer is not reused on another", async () => {
    const doc = await PDFDocument.create();
    const form = (body: string, extra: Record<string, unknown> = {}) =>
      doc.context.register(
        doc.context.stream(body, {
          Type: "XObject",
          Subtype: "Form",
          BBox: [0, 0, 595, 842],
          ...extra,
        }),
      );
    // The outer form names /Inner and has no /Resources: the page's decide.
    const outer = form("/Inner Do");
    const hidden = form("BT 3 Tr (x) Tj ET");
    const square = form("0 0 1 rg 10 10 100 100 re f");
    for (const inner of [hidden, square]) {
      const page = doc.addPage([595, 842]);
      const xobjects = doc.context.obj({ Outer: outer, Inner: inner });
      page.node.set(
        PDFName.of("Resources"),
        doc.context.obj({ XObject: xobjects }),
      );
      rawContent(doc, page, "/Outer Do");
    }
    const out = await stripInvisibleText(await doc.save());
    // Page 1's outer form paints only invisible text: dropped. Page 2's
    // paints a square: kept, whatever page 1 found.
    expect(await pageOps(out.bytes, 0)).not.toContain("Do");
    expect(await pageOps(out.bytes, 1)).toContain("Do");
  });

  it("a form that draws itself does not loop, and is kept", async () => {
    const doc = await PDFDocument.create();
    const ref = doc.context.nextRef();
    const xobjects = doc.context.obj({ Self: ref });
    doc.context.assign(
      ref,
      doc.context.stream("BT 3 Tr (x) Tj ET /Self Do", {
        Type: "XObject",
        Subtype: "Form",
        BBox: [0, 0, 10, 10],
        Resources: { XObject: xobjects },
      }),
    );
    const page = doc.addPage([100, 100]);
    const name = page.node.newXObject("Self", ref);
    rawContent(doc, page, `${name.asString()} Do`);
    const out = await stripInvisibleText(await doc.save());
    // The page keeps its Do (the cycle is treated as painting), but the
    // form is copied without its invisible text.
    expect(out.pagesChanged).toBe(1);
  });

  it("passes an encrypted PDF through untouched, so OCRmyPDF's own refusal still decides", async () => {
    const pdf = readRestrictedFixture(OPEN_PASSWORD_FIXTURE.file);
    const out = await stripInvisibleText(pdf);
    expect(out.untouched).toBe("unreadable");
    expect(out.bytes).toBe(pdf);
  });

  it("passes a signed PDF through untouched, even with a stale layer", async () => {
    const pdf = await withStaleOcrLayer(await blankScan(), "tesseract");
    const doc = await PDFDocument.load(pdf);
    doc.context.register(
      doc.context.obj({ Type: "Sig", ByteRange: [0, 10, 20, 30] }),
    );
    const signed = await doc.save({ useObjectStreams: false });
    const out = await stripInvisibleText(signed);
    expect(out.untouched).toBe("signed");
    expect(out.bytes).toBe(signed);
    // Positive control: the same file without the signature is stripped.
    expect((await stripInvisibleText(pdf)).pagesChanged).toBe(1);
  });

  it("passes bytes that are not a PDF through untouched", async () => {
    const junk = enc("not a pdf at all");
    const out = await stripInvisibleText(junk);
    expect(out.untouched).toBe("unreadable");
    expect(out.bytes).toBe(junk);
  });
});

/** `text` ASCIIHex-encoded, with its `>` end marker. */
function asciiHex(text: string): string {
  return `${[...enc(text)].map((b) => b.toString(16).padStart(2, "0")).join("")}>`;
}

/** A hex string operand from pdf-lib's encoded text. */
function hex(encoded: string): string {
  return encoded.startsWith("<") ? encoded : `<${encoded}>`;
}

/** Append `source` to the page as a content stream of its own. */
function rawContent(doc: PDFDocument, page: PDFPage, source: string): void {
  page.node.addContentStream(doc.context.register(doc.context.stream(source)));
}
