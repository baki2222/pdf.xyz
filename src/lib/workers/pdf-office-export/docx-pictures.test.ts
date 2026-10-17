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
  ocrdScanPdf,
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
import { docxPackage } from "./docx-package";
import { readDocxBody } from "./docx-read";
import {
  PDF_TO_WORD_TOOL,
  runPdfOfficeExport,
  type PdfOfficeExportDeps,
  type PdfOfficeExportRun,
} from "./engine";
import { pdfOfficeExportDeps } from "./native";
import { PDFDocument } from "pdf-lib";
import { drawRasterImage, embedRasterImage } from "@/lib/pdf/pdf-lib";
import { scanPdfPages } from "./page-scan";
import { encodePngImage } from "./png-encode";
import {
  MAX_BILEVEL_PICTURE_SIDE,
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
