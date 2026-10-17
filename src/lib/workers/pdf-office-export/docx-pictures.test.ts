// @vitest-environment node
// @native-canvas
/**
 * PDF to Word keeps the pictures: every raster picture a page paints is in
 * the .docx, as that picture, at the size the page shows it, between the
 * text above it and the text below it.
 *
 * ── THE DEFECT (measured on production, 2026-10-17) ─────────────────────────
 *
 * The owner's 33-page tutorial (37 pictures: screenshots with captions)
 * through the live page's "Export DOCX" came back as a 12 KB .docx: 138
 * paragraphs, 32 page breaks, `word/media` empty, not one `<w:drawing>`. A
 * competitor's Word export kept the screenshots. The page said, truthfully,
 * that images were not carried; every check here read the text, and the text
 * was all there.
 *
 * ── HOW THESE ASK ───────────────────────────────────────────────────────────
 *
 * Each fixture is a generated PDF that records what it draws
 * (`@/tests/docx-picture-fixtures`), run through the engine with the
 * PRODUCTION deps builder (`pdfOfficeExportDeps`). Only `extractFlow` —
 * poppler's `-bbox-layout`, absent from CI's unit job and from this
 * repository's Windows host — is stood in for (`@/tests/poppler-flow-standin`,
 * in poppler's own frame); the page reader is the real one. The .docx is
 * judged by the picture instrument (`./docx-fidelity`), held to its own
 * controls in `docx-fidelity.test.ts`, and read back by `./docx-read`. The
 * same fixtures meet the REAL poppler inside the worker image:
 * `pnpm worker:docx-pictures-proof`.
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  boldItalicPdf,
  captionedPicturesPdf,
  coveredPicturePdf,
  exifJpegPdf,
  inlineImagesPdf,
  labelledCalloutPdf,
  manyPicturesPdf,
  noisePagesPdf,
  ocrdScanPdf,
  repeatedPicturesPdf,
  stencilPicturePdf,
  croppedPagePdf,
  DOCX_PICTURE_FIXTURES,
  scanBetweenPagesPdf,
  wideDrawingPdf,
  type DocxFixture,
} from "@/tests/docx-picture-fixtures";
import { encryptPdf } from "@/tests/encrypted-pdf";
import { flowStandIn } from "@/tests/poppler-flow-standin";
import {
  cellGridPdf,
  imageCaptionPdf,
  junkAfterEofPdf,
  repairStandIn,
  scannedPdf,
} from "@/tests/pptx-fidelity-fixtures";
import { getToolBySlug } from "@/lib/tools";
import { getToolContent } from "@/lib/tools/content";
import { pageFaq } from "@/lib/tools/page-copy";
import { compareDocxPictures } from "./docx-fidelity";
import { A4_PORTRAIT, docxPageOf } from "./docx-layout";
import { DOCX_PICTURE_OVERHEAD_BYTES, docxPackage } from "./docx-package";
import { handBuiltDocx } from "@/tests/docx-hand-built";
import { readJpegOrientation } from "@/lib/pdf/jpeg-orientation";
import { loadNodeCanvas } from "./pdfjs-node";
import { readDocxBody } from "./docx-read";
import {
  PDF_TO_WORD_TOOL,
  runPdfOfficeExport,
  type PdfOfficeExportDeps,
  type PdfOfficeExportRun,
} from "./engine";
import { pdfOfficeExportDeps } from "./native";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { JPEG_30X20 } from "@/tests/jpeg-fixtures";
import { drawRasterImage, embedRasterImage } from "@/lib/pdf/pdf-lib";
import { decodeBudgetPlan, scanPdfPages } from "./page-scan";
import { inventoryPages } from "./page-inventory";
import { encodePngImage } from "./png-encode";
import {
  MAX_BILEVEL_PICTURE_SIDE,
  MAX_DOCX_PICTURES,
  MAX_LAYERS_PER_PAGE,
} from "./picture-limits";

/** Production's deps, with poppler's reading order stood in for. */
function deps(extra: Partial<PdfOfficeExportDeps> = {}): PdfOfficeExportDeps {
  const native = pdfOfficeExportDeps();
  // Poppler's REAL refusals are not under test here: the stand-in refuses
  // the way the runner does (needs-password / unreadable).
  return {
    ...native,
    extractFlow: flowStandIn,
    repairPdf: undefined,
    ...extra,
  };
}

async function word(
  pdf: Uint8Array,
  extra: Partial<PdfOfficeExportDeps> = {},
): Promise<Extract<PdfOfficeExportRun, { ok: true }>> {
  const run = await runPdfOfficeExport(PDF_TO_WORD_TOOL, pdf, deps(extra));
  if (!run.ok) throw new Error(`${run.kind}: ${run.message}`);
  return run;
}

/**
 * What a reader meets, page segment by page segment: each paragraph's text,
 * and each picture as `#n`, the source picture the instrument matched it to.
 */
async function sequenceOf(fixture: DocxFixture, docx: Uint8Array) {
  const report = await compareDocxPictures(fixture.pdf, docx);
  const nameOf = new Map<number, string>();
  report.pictures.forEach((p, i) => {
    if (p.docx !== null) nameOf.set(p.docx, `#${i + 1}`);
  });
  const body = await readDocxBody(docx);
  const segments: string[][] = [];
  body.paragraphs.forEach((p, i) => {
    const here = (segments[p.segment] ??= []);
    for (const pic of body.pictures.filter((q) => q.paragraph === i))
      here.push(nameOf.get(pic.index) ?? "#?");
    if (p.text.trim()) here.push(p.text);
  });
  return { report, segments: segments.filter((s) => s.length > 0) };
}

describe("PDF to Word keeps the pictures", () => {
  it.each(DOCX_PICTURE_FIXTURES.map((build) => [build.name, build] as const))(
    "%s: every picture, its pixels, its size, between the text around it",
    async (_, build) => {
      const fixture = await build();
      const run = await word(fixture.pdf);
      const { report, segments } = await sequenceOf(fixture, run.output);
      expect(report.sourcePictures).toBe(fixture.pictures.length);
      expect(report.pass, report.detail).toBe(true);
      expect(segments).toEqual(fixture.sequence);
    },
    120_000,
  );

  it("the owner's shape — a picture under a caption, a thumbnail, a clipped picture — passes the instrument", async () => {
    const fixture = await imageCaptionPdf();
    const run = await word(fixture.pdf);
    const report = await compareDocxPictures(fixture.pdf, run.output);
    expect(report.sourcePictures).toBe(3);
    expect(report.pass, report.detail).toBe(true);
  }, 60_000);

  it("a plain JPEG goes in byte for byte; a PNG stays a PNG", async () => {
    const fixture = await captionedPicturesPdf();
    const run = await word(fixture.pdf);
    const body = await readDocxBody(run.output);
    const same = (a: Uint8Array, b: Uint8Array) =>
      a.length === b.length && a.every((v, i) => v === b[i]);
    const jpeg = fixture.pictures.find((p) => p.source === "jpeg")!.jpeg!;
    expect(body.pictures.some((p) => p.bytes && same(p.bytes, jpeg))).toBe(
      true,
    );
    expect(body.pictures.filter((p) => p.part?.endsWith(".png"))).toHaveLength(
      2,
    );
  }, 60_000);

  it("the .docx page is the PDF's first page, and a picture wider than its text is scaled to the text width, aspect kept", async () => {
    const fixture = await wideDrawingPdf();
    const run = await word(fixture.pdf);
    const body = await readDocxBody(run.output);
    expect(body.page.declared).toBe(true);
    expect([body.page.width, body.page.height]).toEqual([612, 792]);
    const [pic] = body.pictures;
    const shown = fixture.pictures[0]!.shown;
    expect(pic!.width).toBeCloseTo(body.page.textWidth, 0);
    expect(pic!.width / pic!.height).toBeCloseTo(shown.width / shown.height, 2);
    // Over the 64 MP ceiling, and carried: scaled to the bilevel side limit.
    const media = await JSZip.loadAsync(run.output);
    expect(pic!.part).toMatch(/\.png$/);
    const png = await media.file(pic!.part!)!.async("uint8array");
    const width = new DataView(png.buffer, png.byteOffset).getUint32(16);
    expect(width).toBe(MAX_BILEVEL_PICTURE_SIDE);
  }, 120_000);

  it("a landscape first page gives an A4 upright Word page, as the page says, and its pictures fit that page's text", async () => {
    // Measured in Word 16 on the owner's 4:3 sample (docx-layout.ts): 84
    // Word pages on its own landscape page, 33 on a portrait one.
    const fixture = await imageCaptionPdf();
    const body = await readDocxBody((await word(fixture.pdf)).output);
    expect([body.page.width, body.page.height]).toEqual([
      A4_PORTRAIT.width,
      A4_PORTRAIT.height,
    ]);
    const widest = Math.max(...body.pictures.map((p) => p.width));
    // The 480-pt photo is wider than A4's 451-pt text: fitted to it.
    expect(widest).toBeCloseTo(body.page.textWidth, 0);
    // The page says exactly this, in the intro the tool page renders.
    expect(getToolContent("pdf-to-word")!.intro.join(" ")).toMatch(
      /\bsize of the PDF's first page, or A4 upright when that page is landscape\b/,
    );
    // And the portrait case keeps the PDF's own page (the other test above).
    expect(docxPageOf(612, 792)).toMatchObject({ width: 612, height: 792 });
  }, 60_000);

  it("a first page larger (or smaller) than Word allows keeps its shape: scaled to Word's limits, not clamped side by side", () => {
    // The review of 2026-10-17: an A0 page came out a 22-inch SQUARE.
    const a0 = docxPageOf(2384, 3370);
    expect(a0.height).toBeCloseTo(1584, 6);
    expect(a0.width / a0.height).toBeCloseTo(2384 / 3370, 6);
    const strip = docxPageOf(100, 5000);
    expect(strip.width).toBeCloseTo(31.68, 6);
    expect(strip.height).toBeCloseTo(1584, 6);
    const stamp = docxPageOf(3, 6);
    expect(stamp.width).toBeCloseTo(7.2, 6);
    expect(stamp.height).toBeCloseTo(14.4, 6);
    // Inside the limits, the page is the PDF's own.
    expect(docxPageOf(842, 1191)).toMatchObject({ width: 842, height: 1191 });
    expect(getToolContent("pdf-to-word")!.intro.join(" ")).toMatch(
      /\bscaled to fit, its shape kept, when it is larger than Word allows\b/,
    );
  });

  it("a paragraph set wholly in bold or italics keeps it; a bold word inside a sentence does not make the sentence bold", async () => {
    const { pdf, paragraph } = await boldItalicPdf();
    const xml = await (
      await JSZip.loadAsync((await word(pdf)).output)
    )
      .file("word/document.xml")!
      .async("string");
    const of = (text: string) => {
      const p = (xml.match(/<w:p>[\s\S]*?<\/w:p>/g) ?? []).filter((q) =>
        q.includes(text),
      );
      // Health: each paragraph is found once, so "no <w:b/>" is about it.
      expect(p, text).toHaveLength(1);
      return p[0]!;
    };
    expect(of(paragraph.bold)).toContain("<w:rPr><w:b/></w:rPr>");
    expect(of(paragraph.italic)).toContain("<w:rPr><w:i/></w:rPr>");
    expect(of(paragraph.mixed)).not.toContain("<w:rPr>");
    expect(of(paragraph.regular)).not.toContain("<w:rPr>");
  }, 60_000);

  it("after OCR, a scan comes through as its picture followed by its words — as the page tells the reader", async () => {
    const fixture = await ocrdScanPdf();
    const { report, segments } = await sequenceOf(
      fixture,
      (await word(fixture.pdf)).output,
    );
    expect(report.pass, report.detail).toBe(true);
    expect(segments).toEqual([["#1", ...fixture.sequence[0]!.slice(1)]]);
    // The page's own words for this, wherever it serves them: the use case
    // and the derived scanned-PDF answer. Held to the run above.
    const tool = getToolBySlug("pdf-to-word")!;
    const served = [
      ...getToolContent("pdf-to-word")!.useCases.map((u) => u.body),
      ...pageFaq(tool).map((f) => f.answer),
    ].filter((t) => /\bOCR\b/.test(t) && /\bfollowed by its words\b/.test(t));
    expect(served.length).toBeGreaterThanOrEqual(2);
    for (const t of served)
      expect(t).toMatch(
        /\bscan then comes through as a picture, followed by its words\b/,
      );
  }, 60_000);

  it("a page whose drawing PowerPoint would flatten into one picture keeps its own picture in Word", async () => {
    // Past MAX_LAYERS_PER_PAGE layers PowerPoint draws a page as ONE picture
    // (`flattened`); that picture is a drawing layer, which Word does not
    // carry, so a Word reading that flattened would lose the page's own
    // pictures with it. Found by the mutation check of 2026-10-17, which
    // turned `picturesOnly` off for flattening and stayed green.
    const grid = await cellGridPdf(MAX_LAYERS_PER_PAGE + 1);
    const doc = await PDFDocument.load(grid.pdf);
    const page = doc.getPage(0);
    const badge = encodePngImage(
      30,
      30,
      "rgb8",
      new Uint8Array(30 * 30 * 3).fill(90),
    );
    await drawRasterImage(page, await embedRasterImage(doc, badge, "png"), {
      x: 5,
      y: page.getHeight() - 35,
      width: 30,
      height: 30,
    });
    const pdf = await doc.save();
    // Health: PowerPoint's reading of this page IS flattened.
    expect((await scanPdfPages(pdf)).pages[0]!.flattened).toBe(true);
    const report = await compareDocxPictures(pdf, (await word(pdf)).output);
    expect(report.sourcePictures).toBe(1);
    expect(report.pass, report.detail).toBe(true);
  }, 60_000);

  it("a page that is only a scan comes through as its picture, on its own page, and the result says its words are not text", async () => {
    const fixture = await scanBetweenPagesPdf();
    const run = await word(fixture.pdf);
    expect(run.coverage).toMatchObject({
      pageCount: 3,
      textPageCount: 2,
      pagesWithoutText: [2],
      picturePageCount: 1,
      pagesAsPictures: [2],
      picturesNotCarried: 0,
    });
  }, 60_000);

  it("a PDF with no selectable text at all is still refused, pointing to OCR — a document of page pictures has nothing to edit", async () => {
    const run = await runPdfOfficeExport(
      PDF_TO_WORD_TOOL,
      (await scannedPdf()).pdf,
      deps(),
    );
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.kind).toBe("no_text");
    expect(run.message).toMatch(/OCR/);
  }, 60_000);

  it("a PDF that opens without a password keeps its pictures, in both encrypted layouts; one that needs a password is refused as locked", async () => {
    const fixture = await captionedPicturesPdf();
    for (const objectStreams of [false, true]) {
      const locked = await encryptPdf(fixture.pdf, {
        userPassword: "",
        ownerPassword: "owner",
        objectStreams,
      });
      const report = await compareDocxPictures(
        fixture.pdf,
        (await word(locked)).output,
      );
      expect(
        report.pass,
        `objectStreams ${objectStreams}: ${report.detail}`,
      ).toBe(true);
    }
    const needsPassword = await encryptPdf(fixture.pdf, {
      userPassword: "open",
      ownerPassword: "owner",
    });
    const refused = await runPdfOfficeExport(
      PDF_TO_WORD_TOOL,
      needsPassword,
      deps(),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.kind).toBe("password_protected");
  }, 120_000);

  it("a PDF the page reader cannot read ahead is rebuilt first and converted with its pictures; with nothing to rebuild it, it is refused", async () => {
    const fixture = await captionedPicturesPdf();
    const damaged = junkAfterEofPdf(fixture.pdf);
    const rebuilt = await word(damaged, { repairPdf: repairStandIn });
    expect(rebuilt.coverage.repairedBeforeConversion).toBe(true);
    const report = await compareDocxPictures(fixture.pdf, rebuilt.output);
    expect(report.pass, report.detail).toBe(true);
    const refused = await runPdfOfficeExport(PDF_TO_WORD_TOOL, damaged, deps());
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.kind).toBe("unreadable");
      expect(refused.message).toMatch(/Repair PDF/);
    }
  }, 120_000);

  it("without the page reader, Word answers unsupported: a text-only .docx is the defect, not a fallback", async () => {
    const fixture = await croppedPagePdf();
    const run = await runPdfOfficeExport(PDF_TO_WORD_TOOL, fixture.pdf, {
      extractFlow: flowStandIn,
    });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.kind).toBe("unsupported");
  }, 60_000);
});

/**
 * The engine reads its own .docx back before delivery (`undeliverableDocx`):
 * a writer that regressed — a picture whose part is missing, a picture
 * left out of the body, a page break lost — is refused as the engine's
 * own fault, never delivered.
 */
describe("PDF to Word does not deliver a .docx that lost what it planned", () => {
  const regressed =
    (edit: (zip: JSZip, xml: string) => Promise<string>) =>
    async (doc: Parameters<typeof docxPackage>[0]) => {
      const written = await docxPackage(doc);
      const zip = await JSZip.loadAsync(written.bytes);
      const xml = await zip.file("word/document.xml")!.async("string");
      zip.file("word/document.xml", await edit(zip, xml));
      return {
        ...written,
        bytes: new Uint8Array(await zip.generateAsync({ type: "uint8array" })),
      };
    };

  it("POSITIVE CONTROL: the real writer's .docx is delivered", async () => {
    const run = await runPdfOfficeExport(
      PDF_TO_WORD_TOOL,
      (await captionedPicturesPdf()).pdf,
      deps({ writeDocx: regressed(async (_, xml) => xml) }),
    );
    expect(run.ok).toBe(true);
  }, 60_000);

  it.each([
    [
      "a picture's media part missing",
      async (zip: JSZip, xml: string) => {
        zip.remove("word/media/image1.png");
        return xml;
      },
      /a picture without its image/,
    ],
    [
      "a picture left out of the body",
      async (_: JSZip, xml: string) =>
        xml.replace(
          /<w:p><w:r><w:drawing>[\s\S]*?<\/w:drawing><\/w:r><\/w:p>/,
          "",
        ),
      /2 of 3 pictures/,
    ],
    [
      "a page break lost",
      async (_: JSZip, xml: string) =>
        xml.replace('<w:p><w:r><w:br w:type="page"/></w:r></w:p>', ""),
      /0 of 1 page breaks/,
    ],
  ] as const)(
    "%s is refused as incomplete",
    async (_, edit, why) => {
      const run = await runPdfOfficeExport(
        PDF_TO_WORD_TOOL,
        (await captionedPicturesPdf()).pdf,
        deps({ writeDocx: regressed(edit) }),
      );
      expect(run.ok).toBe(false);
      if (run.ok) return;
      expect(run.kind).toBe("incomplete_output");
      expect(run.message).toMatch(why);
    },
    60_000,
  );
});

/**
 * The review of 2026-10-17, as tests of what the .docx holds: nothing the
 * page hides, every picture pdf.js draws in one merged op, stencils, and a
 * JPEG that cannot be turned by a reader that honours EXIF.
 */
describe("PDF to Word keeps what the page shows, and only that", () => {
  /** Pixels of exactly the hidden magenta in every picture of a .docx. */
  async function magentaPixels(docx: Uint8Array): Promise<number> {
    const canvas = loadNodeCanvas();
    let n = 0;
    for (const p of (await readDocxBody(docx)).pictures) {
      if (!p.bytes) continue;
      const img = await canvas.loadImage(p.bytes);
      const c = canvas.createCanvas(img.width, img.height);
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, img.width, img.height).data;
      for (let i = 0; i < d.length; i += 4)
        if (d[i]! > 200 && d[i + 1]! < 60 && d[i + 2]! > 200) n++;
    }
    return n;
  }

  it("PRIVACY: a box painted over a screenshot is burned into it — none of the 4,000 hidden magenta pixels reach the .docx", async () => {
    const fixture = await coveredPicturePdf();
    // Health: the fixture really hides 4,000 magenta pixels in its raster.
    expect(
      await magentaPixels(
        await handBuiltDocx({
          page: fixture.firstPage,
          pages: [[{ picture: 0 }]],
          pictures: [
            { ...fixture.pictures[0]!.file!, width: 300, height: 200 },
          ],
        }),
      ),
    ).toBe(4000);
    const run = await word(fixture.pdf);
    expect(await magentaPixels(run.output)).toBe(0);
    const report = await compareDocxPictures(fixture.pdf, run.output);
    expect(report.pass, report.detail).toBe(true);
    expect(report.coveredCells).toBeGreaterThan(0);
    expect(report.survivingCells).toBe(0);
  }, 60_000);

  it("a picture drawn four times in a row comes through four times, at both sizes; twelve small inline pictures come through twelve times; nothing is quietly lost", async () => {
    for (const build of [repeatedPicturesPdf, inlineImagesPdf]) {
      const fixture = await build();
      const run = await word(fixture.pdf);
      const report = await compareDocxPictures(fixture.pdf, run.output);
      expect(report.matched, `${fixture.name}: ${report.detail}`).toBe(
        fixture.pictures.length,
      );
      expect(report.pass, report.detail).toBe(true);
      expect(run.coverage.picturesNotCarried).toBe(0);
    }
  }, 60_000);

  it("a label the page writes on a callout is painted into it; the callout's clear margin stays clear, and no covered pixel survives", async () => {
    const fixture = await labelledCalloutPdf();
    const run = await word(fixture.pdf);
    const report = await compareDocxPictures(fixture.pdf, run.output);
    expect(report.pass, report.detail).toBe(true);
    expect(report.pictures[1]!.covered!.cells).toBeGreaterThan(10);
    expect(report.survivingCells).toBe(0);
    // The callout as delivered: the label's black is in it (the callout's
    // own pixels have none), and nothing of the dark screenshot is.
    const media = (await readDocxBody(run.output)).pictures[
      report.pictures[1]!.docx!
    ]!.bytes!;
    const canvas = loadNodeCanvas();
    const img = await canvas.loadImage(media);
    const c = canvas.createCanvas(img.width, img.height);
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height).data;
    let black = 0;
    let darkInMargin = 0;
    const m = (6 * img.width) / 160;
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        const i = (y * img.width + x) * 4;
        const dark = d[i + 3]! > 128 && d[i]! < 60 && d[i + 1]! < 60;
        const margin =
          x < m - 1 || y < m - 1 || x > img.width - m || y > img.height - m;
        if (dark && !margin) black++;
        if (d[i + 3]! > 8 && margin && x > 2 && y > 2) darkInMargin++;
      }
    expect(black).toBeGreaterThan(100);
    expect(darkInMargin).toBe(0);
  }, 60_000);

  it("a frame drawn AROUND a JPEG — its box over the picture, its ink not — leaves the JPEG byte for byte: only ink that shows over a picture is painted in", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("A framed photograph", { x: 72, y: 720, size: 14, font });
    await drawRasterImage(
      page,
      await embedRasterImage(doc, JPEG_30X20, "jpg"),
      {
        x: 100,
        y: 450,
        width: 150,
        height: 100,
      },
    );
    // Drawn after the picture: a ring 12 pt outside it, whose bounding box
    // holds the picture whole.
    page.drawRectangle({
      x: 88,
      y: 438,
      width: 174,
      height: 124,
      borderWidth: 3,
      borderColor: rgb(0.8, 0.1, 0.1),
    });
    const run = await word(await doc.save());
    const [pic] = (await readDocxBody(run.output)).pictures;
    // Health: the frame's box overlaps the picture, so the probe ran.
    expect(pic!.bytes!.length).toBe(JPEG_30X20.length);
    expect([...pic!.bytes!].every((v, i) => v === JPEG_30X20[i])).toBe(true);
  }, 60_000);

  it("a stencil picture comes through as a picture, in its colour", async () => {
    const fixture = await stencilPicturePdf();
    const run = await word(fixture.pdf);
    const report = await compareDocxPictures(fixture.pdf, run.output);
    expect(report.sourcePictures).toBe(1);
    expect(report.pass, report.detail).toBe(true);
  }, 60_000);

  it("a JPEG with an EXIF orientation goes in with the tag neutralised, its pixels otherwise byte for byte", async () => {
    const fixture = await exifJpegPdf();
    const run = await word(fixture.pdf);
    const [pic] = (await readDocxBody(run.output)).pictures;
    expect(pic!.part).toMatch(/\.jpeg$/);
    // Health: the source really carries orientation 6.
    expect(readJpegOrientation(fixture.pictures[0]!.jpeg!)).toBe(6);
    expect(readJpegOrientation(pic!.bytes!)).toBe(1);
    expect(pic!.bytes!.length).toBe(fixture.pictures[0]!.jpeg!.length);
    expect(
      [...pic!.bytes!].filter((v, i) => v !== fixture.pictures[0]!.jpeg![i])
        .length,
    ).toBeLessThanOrEqual(2);
    expect((await compareDocxPictures(fixture.pdf, run.output)).pass).toBe(
      true,
    );
  }, 60_000);
});

/**
 * The review of 2026-10-17, BLOCKING 4. A large, picture-heavy PDF was
 * refused WHOLE — "The exported Office file exceeds the worker size limit."
 * for a 68.9 MB, 20-page photo PDF; "pictures are too large in total" for a
 * 350-page colour scan — where the text-only engine of the week before had
 * converted both. And a 205 KB PDF of tiny pictures became a 22.3 MB .docx
 * of 20,000 media parts. Each budget is now a place to stop carrying
 * pictures, never a refusal: the text, the pictures that fit, and a count of
 * the rest, by page.
 */
describe("PDF to Word delivers the text and the pictures that fit, and counts the rest", () => {
  /** Every heading in the document, and the pages whose picture is in it. */
  async function delivered(run: { output: Uint8Array }) {
    const body = await readDocxBody(run.output);
    return {
      text: body.paragraphs.map((p) => p.text).join("\n"),
      pictures: body.pictures.length,
      // One picture per page in these fixtures: its page is its segment + 1.
      pages: body.pictures.map((p) => p.segment + 1),
    };
  }
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, k) => from + k);

  it("past the output size: the file is under the limit, every heading is in it, and the pictures left out are counted by page", async () => {
    const { pdf, headings } = await noisePagesPdf(6);
    const limit = 350_000;
    const run = await word(pdf, { limits: { maxOutputBytes: limit } });
    expect(run.output.byteLength).toBeLessThanOrEqual(limit);
    const got = await delivered(run);
    for (const h of headings) expect(got.text).toContain(h);
    // Health: some fit and some do not, so both halves are exercised.
    expect(got.pictures).toBeGreaterThan(0);
    expect(got.pictures).toBeLessThan(6);
    expect(run.coverage.picturesOverBudget).toBe(6 - got.pictures);
    expect(run.coverage.picturesNotCarried).toBe(6 - got.pictures);
    expect(run.coverage.pagesMissingPictures).toEqual(
      range(1, 6).filter((n) => !got.pages.includes(n)),
    );
  }, 120_000);

  it("past the document's decode budget: the pages past it carry no picture and are counted; nothing is refused", async () => {
    const { pdf, headings } = await noisePagesPdf(6);
    const inventory = (await inventoryPages(pdf))!;
    const plan = decodeBudgetPlan(inventory);
    // Derived, not typed: exactly the first two pages' decoding fits.
    const budget = plan.pages[0]!.bytes + plan.pages[1]!.bytes;
    expect(budget).toBeLessThan(plan.bytes);
    const run = await word(pdf, { limits: { decodeBudgetBytes: budget } });
    const got = await delivered(run);
    for (const h of headings) expect(got.text).toContain(h);
    expect(got.pages).toEqual([1, 2]);
    expect(run.coverage.picturesOverBudget).toBe(4);
    expect(run.coverage.pagesMissingPictures).toEqual([3, 4, 5, 6]);
  }, 120_000);

  it("past the deadline: the text, and every picture not reached counted — not a timeout to retry", async () => {
    const { pdf, headings } = await noisePagesPdf(3);
    const run = await word(pdf, { limits: { scanTimeoutMs: -1_000 } });
    const got = await delivered(run);
    for (const h of headings) expect(got.text).toContain(h);
    expect(got.pictures).toBe(0);
    expect(run.coverage.picturesOverBudget).toBe(3);
    expect(run.coverage.pagesMissingPictures).toEqual([1, 2, 3]);
  }, 120_000);

  it("past the picture count: the first pictures in the document, and the rest counted", async () => {
    const fixture = await repeatedPicturesPdf();
    const run = await word(fixture.pdf, { limits: { maxPictures: 3 } });
    expect((await readDocxBody(run.output)).pictures).toHaveLength(3);
    expect(run.coverage.picturesOverBudget).toBe(5);
    expect(run.coverage.picturesNotCarried).toBe(5);
  }, 120_000);

  it("each picture adds at most DOCX_PICTURE_OVERHEAD_BYTES to the file besides its media — measured on the real writer, the worst case: every picture on a page of its own", async () => {
    // A second, independent bound on the budget's own constant: the writer
    // the engine delivers with, over hundreds of pictures (ids and part
    // names grow with the count, so few pictures would understate it).
    const N = 600;
    const tiny = (k: number) =>
      encodePngImage(1, 1, "rgb8", new Uint8Array([k & 255, k >> 8, 7]));
    const page = { width: 612, height: 792, margin: 72 };
    const text = { kind: "text" as const, cells: ["A line of text."] };
    const pictures = Array.from({ length: N }, (_, k) => tiny(k));
    const without = await docxPackage({
      page,
      pages: [[text], ...pictures.map(() => [])],
    });
    const withPictures = await docxPackage({
      page,
      pages: [
        [text],
        ...pictures.map((bytes, k) => [
          {
            kind: "picture" as const,
            media: {
              key: `k${k}`,
              bytes,
              ext: "png" as const,
              pixelWidth: 1,
              pixelHeight: 1,
              passthrough: false,
            },
            width: 400.123,
            height: 300.456,
            crop: { left: 0.1234, top: 0.2345, right: 0.0123, bottom: 0.3456 },
            rotation: 0,
            flipH: false,
            flipV: false,
          },
        ]),
      ],
    });
    // Health: every picture was written, each on its own page.
    expect(withPictures.plan.pictures).toBe(N);
    expect(withPictures.plan.pageBreaks).toBe(N);
    const media = pictures.reduce((n, b) => n + b.byteLength, 0);
    const perPicture =
      (withPictures.bytes.byteLength - without.bytes.byteLength - media) / N;
    expect(perPicture).toBeLessThanOrEqual(DOCX_PICTURE_OVERHEAD_BYTES);
    // …and not so loose that the budget wastes a third of itself.
    expect(perPicture).toBeGreaterThan(DOCX_PICTURE_OVERHEAD_BYTES * 0.6);
  }, 120_000);

  it(`a small PDF of more than ${MAX_DOCX_PICTURES.toLocaleString("en-US")} pictures carries ${MAX_DOCX_PICTURES.toLocaleString("en-US")}, in order, and counts the rest — the default cap, wired`, async () => {
    const extra = 30;
    const pdf = await manyPicturesPdf(MAX_DOCX_PICTURES + extra);
    // Health: a small PDF.
    expect(pdf.byteLength).toBeLessThan(400_000);
    const run = await word(pdf);
    const body = await readDocxBody(run.output);
    expect(body.pictures).toHaveLength(MAX_DOCX_PICTURES);
    expect(run.coverage.picturesOverBudget).toBe(extra);
    expect(run.coverage.pagesMissingPictures).toEqual([1]);
  }, 300_000);

  it("the size budget charges each picture its place in the file, not only its media: many tiny pictures stop where the FILE is full", async () => {
    const pdf = await manyPicturesPdf(300);
    const textOnly = (await word(pdf, { limits: { maxPictures: 0 } })).output
      .byteLength;
    // Room for about half of them, counting each picture's XML and entries.
    const limit = textOnly + 150 * DOCX_PICTURE_OVERHEAD_BYTES;
    const run = await word(pdf, { limits: { maxOutputBytes: limit } });
    expect(run.output.byteLength).toBeLessThanOrEqual(limit);
    const carried = (await readDocxBody(run.output)).pictures.length;
    // Health: by media alone (under 100 bytes each) all 300 would fit.
    expect(carried).toBeGreaterThan(100);
    expect(carried).toBeLessThan(300);
    expect(run.coverage.picturesOverBudget).toBe(300 - carried);
  }, 120_000);

  it("a writer whose file comes out over the limit anyway gets the text-only document, every picture counted — not a refusal", async () => {
    const { pdf, headings } = await noisePagesPdf(2, 40, 30);
    const limit = 200_000;
    const run = await word(pdf, {
      limits: { maxOutputBytes: limit },
      // Adds a part the size of the limit to any file with a picture in it.
      writeDocx: async (doc) => {
        const written = await docxPackage(doc);
        if (written.plan.pictures === 0) return written;
        const zip = await JSZip.loadAsync(written.bytes);
        zip.file("word/padding.bin", new Uint8Array(limit));
        return {
          bytes: new Uint8Array(
            await zip.generateAsync({ type: "uint8array" }),
          ),
          plan: written.plan,
        };
      },
    });
    expect(run.output.byteLength).toBeLessThanOrEqual(limit);
    const got = await delivered(run);
    for (const h of headings) expect(got.text).toContain(h);
    expect(got.pictures).toBe(0);
    expect(run.coverage.picturesOverBudget).toBe(2);
  }, 120_000);
});
