import JSZip from "jszip";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { XLSX_SHEET_NAME } from "@/lib/jobs/pdf-office-export";
import {
  buildOfficeExportResultMeta,
  measureOfficeExportPages,
  type OfficeExportResultMeta,
} from "@/lib/jobs/office-export-results";
import { flowPageText, type PdfFlowText } from "../pdf-text/flow";
import {
  SheetStyles,
  STYLES_CONTENT_TYPE_OVERRIDE,
  stylesRelationship,
  worksheetXml,
  xmlEscape,
} from "../ooxml/sheet-cells";
import { deckFromScan } from "./deck-from-scan";
import { docxDocumentOf, scannedPictures } from "./docx-layout";
import { docxPackage } from "./docx-package";
import { readDocxBody } from "./docx-read";
import { classifyPdfTextFailure } from "./encryption";
import { layoutGrid } from "./layout-grid";
import {
  PageScanDecodeBudgetError,
  PageScanUnreadableError,
  PageScanTooLargeError,
  scannedPageText,
  type PdfPageScan,
  type PdfPageScanner,
} from "./page-scan";
import { inspectPptxPackage } from "./pptx-inspect";
import { pptxPackage, type PptxDeck } from "./pptx-package";

export const PDF_TO_WORD_TOOL = "pdf-to-word";
export const PDF_TO_EXCEL_TOOL = "pdf-to-excel";
export const PDF_TO_POWERPOINT_TOOL = "pdf-to-powerpoint";
export const PDF_OFFICE_EXPORT_TOOLS = [
  PDF_TO_WORD_TOOL,
  PDF_TO_EXCEL_TOOL,
  PDF_TO_POWERPOINT_TOOL,
] as const;
export type PdfOfficeExportTool = (typeof PDF_OFFICE_EXPORT_TOOLS)[number];
/**
 * The engine name that ships inside every PDF→Office job result.
 *
 * RENAMED 2026-08-11 from `pdfjs-office-openxml`, which named an extractor this
 * worker did not use: pdfjs's MAIN build is browser-only and throws under Node
 * before reading a byte, which is why `pdf-text/native` shells out to
 * `pdftotext`. Job records written before that date carry the old value.
 *
 * PDF to PowerPoint has read pages through pdfjs's LEGACY build since
 * 2026-10-10 (`./page-scan`), which runs under Node, and reports
 * {@link PDF_TO_POWERPOINT_ENGINE} instead; Word and Excel still report this.
 */
export const PDF_OFFICE_EXPORT_ENGINE = "pdftotext-office-openxml" as const;
/**
 * PDF to PowerPoint's engine since 2026-10-10: pdftotext opens the file first
 * (so a locked or damaged PDF is classified as it always was), then pdfjs
 * reads every page's pictures, text and drawing (`./page-scan`).
 */
export const PDF_TO_POWERPOINT_ENGINE = "pdfjs-pptx-faithful" as const;
/**
 * PDF to Word's engine since 2026-10-17: poppler's reading order for the
 * text (as before), and pdfjs's page reader for the pictures, placed among
 * the paragraphs (`./docx-layout`). Word reported
 * {@link PDF_OFFICE_EXPORT_ENGINE} until then, and wrote no picture.
 */
export const PDF_TO_WORD_ENGINE = "pdftotext-pdfjs-docx-pictures" as const;

export type PdfTextExtractor = (bytes: Uint8Array) => Promise<ExtractedPdfText>;
/** Reading-order paragraphs, for PDF to Word. See `../pdf-text/flow`. */
export type PdfFlowExtractor = (bytes: Uint8Array) => Promise<PdfFlowText>;
export interface PdfOfficeExportDeps {
  /** The page's visual arrangement (`-layout`) — Excel and PowerPoint. */
  extract?: PdfTextExtractor;
  /**
   * Reading order (`-bbox-layout` flows and blocks) — Word. Separate because
   * `-layout` glues a two-column page's columns together line by line, and
   * Excel's column placement depends on exactly that padding. Word never falls
   * back to `extract`: without this it reports `unsupported`.
   */
  extractFlow?: PdfFlowExtractor;
  /**
   * Whether the document carries an encryption dictionary. Asked only after
   * the extractor refused to open it. Defaults to a pdf-lib parse.
   */
  isEncrypted?: (bytes: Uint8Array) => Promise<boolean>;
  /**
   * The page reader: each page's pictures, positioned text and other ink, in
   * paint order (`./page-scan`). PowerPoint reads all of it; Word, since
   * 2026-10-17, its pictures (`picturesOnly`). Both answer `unsupported`
   * without it: there is no text-only fallback, because a deck or a document
   * with no pictures is the defect this replaced, not a lesser success.
   */
  scanPages?: PdfPageScanner;
  /**
   * The worker's Repair PDF engine (qpdf's rewrite, `../pdf-structure`), as
   * PDF to PowerPoint and PDF to Word use it: the rebuilt PDF, or null when it could not be
   * rebuilt. Asked only for a file the page reader cannot read ahead
   * (`PageScanUnreadableError`); absent where qpdf is, and then such a file
   * is refused.
   */
  repairPdf?: (bytes: Uint8Array) => Promise<Uint8Array | null>;
  /**
   * The PowerPoint writer. Defaults to `./pptx-package`; injectable so a test
   * can hand the engine a writer that regressed and see what it delivers.
   */
  writePptx?: (deck: PptxDeck) => Promise<Uint8Array>;
  limits?: {
    maxInputBytes?: number;
    maxOutputBytes?: number;
    /** How long the page scan (PowerPoint, Word) may run, in ms. */
    scanTimeoutMs?: number;
  };
}
export interface PdfOfficeExportMeta {
  engine:
    | typeof PDF_OFFICE_EXPORT_ENGINE
    | typeof PDF_TO_POWERPOINT_ENGINE
    | typeof PDF_TO_WORD_ENGINE;
  tool: PdfOfficeExportTool;
  pageCount: number;
  inputBytes: number;
  outputBytes: number;
  characterCount: number;
}
export type PdfOfficeExportFailureKind =
  | "unsupported"
  | "no_text"
  | "too_large"
  /** Needs a password to open — the same answer on every retry. */
  | "password_protected"
  /** Refused by the extractor and not encrypted: damaged, or not a PDF. */
  | "unreadable"
  /**
   * The file this engine wrote failed its own inspection before delivery.
   * Our defect, not the PDF's, and the same on every attempt.
   */
  | "incomplete_output"
  /** Anything that might not happen again: a timeout, a spawn failure. */
  | "failed";
export type PdfOfficeExportRun =
  | {
      ok: true;
      output: Uint8Array;
      filenameExt: "docx" | "xlsx" | "pptx";
      contentType: string;
      meta: PdfOfficeExportMeta;
      /** Which pages had text to export, measured from what was written. */
      coverage: OfficeExportResultMeta;
    }
  | {
      ok: false;
      kind: PdfOfficeExportFailureKind;
      limitBytes?: number;
      message: string;
    };
type Failure = Extract<PdfOfficeExportRun, { ok: false }>;

/**
 * The XLSX: every page's `-layout` lines placed into columns by position
 * (`./layout-grid`), one sheet row per non-blank line, pages in order. Cells
 * go through the shared writer, so a value is a number when its whole text is
 * one and a column past Z is AA — see `../ooxml/sheet-cells`.
 */
async function xlsx(pages: ExtractedPdfText["pages"]): Promise<Uint8Array> {
  const rows = pages.flatMap((page) => layoutGrid(page.text));
  const styles = new SheetStyles();
  const sheet = worksheetXml(rows, styles);
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>${STYLES_CONTENT_TYPE_OVERRIDE}</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>${stylesRelationship("rId2")}</Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(XLSX_SHEET_NAME)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file("xl/worksheets/sheet1.xml", sheet);
  zip.file("xl/styles.xml", styles.xml());
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

const UNSUPPORTED: Failure = {
  ok: false,
  kind: "unsupported",
  message:
    "PDF to Office export requires the PDF text extractor, which is not available in this environment.",
};
/**
 * A PDF the page reader cannot read ahead (`PageScanUnreadableError`) is not
 * scanned: until 2026-10-11 it was, with no decode bound. These are what the
 * user reads instead. Deterministic, so `unreadable`: the panel links Repair
 * PDF by that code (`OFFICE_EXPORT_NEXT_STEPS`).
 */
const DAMAGED: Failure = {
  ok: false,
  kind: "unreadable",
  message:
    "This PDF looks damaged: its structure could not be read, so it was not converted. Repair PDF can often rebuild it; then convert the repaired file.",
};
const DAMAGED_NOT_REBUILT: Failure = {
  ok: false,
  kind: "unreadable",
  message:
    "This PDF looks damaged: its structure could not be read, and rebuilding it the way Repair PDF does did not make it readable, so it was not converted.",
};

const NO_TEXT: Failure = {
  ok: false,
  kind: "no_text",
  message:
    "This PDF has no selectable text to export. Run OCR first, then try again.",
};

/**
 * Classify a thrown extraction failure.
 *
 * Every failure here used to become one retryable `failed`, so a locked PDF —
 * which fails identically on every attempt — was requeued with backoff and
 * then reported as "could not be exported", naming neither the lock nor the
 * tool that removes it. The two deterministic answers are checked first: an
 * output ceiling, and the extractor refusing the document. Only a refusal
 * asks whether the file is encrypted, because an owner-password PDF is
 * encrypted AND opens — it never reaches this branch, and a pre-check on
 * `/Encrypt` would have started refusing it.
 */
async function classifyFailure(
  error: unknown,
  input: Uint8Array,
  deps: PdfOfficeExportDeps,
): Promise<Failure> {
  switch (await classifyPdfTextFailure(error, input, deps.isEncrypted)) {
    case "too_large":
      return {
        ok: false,
        kind: "too_large",
        message: "The text extracted from this PDF exceeds the worker's limit.",
      };
    case "password_protected":
      return {
        ok: false,
        kind: "password_protected",
        message:
          "This PDF is password-protected. Unlock it with Unlock PDF, then convert it.",
      };
    case "unreadable":
      return {
        ok: false,
        kind: "unreadable",
        message:
          "This PDF could not be opened. It may be damaged; Repair PDF can often fix that.",
      };
    default:
      return {
        ok: false,
        kind: "failed",
        message: "The PDF could not be exported to an Office file.",
      };
  }
}

interface Rendered {
  output: Uint8Array;
  filenameExt: "docx" | "xlsx" | "pptx";
  contentType: string;
  pageCount: number;
  characterCount: number;
  coverage: OfficeExportResultMeta;
}

/**
 * The scan, with the rebuild a file the page reader cannot read ahead gets:
 * rebuilt the way Repair PDF does and the rebuilt copy scanned, bounded like
 * any other; with nothing to rebuild it, or a rebuild still unreadable,
 * refused — never scanned without a bound. Shared by PowerPoint and Word.
 */
async function scanOrRebuild(
  input: Uint8Array,
  scanPages: PdfPageScanner,
  deps: PdfOfficeExportDeps,
  options: Parameters<PdfPageScanner>[1],
): Promise<{ scan: PdfPageScan; rebuilt: Uint8Array | null } | Failure> {
  try {
    return { scan: await scanPages(input, options), rebuilt: null };
  } catch (error) {
    if (!(error instanceof PageScanUnreadableError)) throw error;
    if (!deps.repairPdf) return DAMAGED;
    const rebuilt = await deps.repairPdf(input).catch(() => null);
    if (!rebuilt) return DAMAGED_NOT_REBUILT;
    try {
      return { scan: await scanPages(rebuilt, options), rebuilt };
    } catch (again) {
      if (again instanceof PageScanUnreadableError) return DAMAGED_NOT_REBUILT;
      throw again;
    }
  }
}

/** The scan's options from the engine's limits. */
function scanOptions(deps: PdfOfficeExportDeps) {
  const timeout = deps.limits?.scanTimeoutMs;
  return {
    ...(timeout !== undefined ? { deadline: Date.now() + timeout } : {}),
    ...(deps.limits?.maxOutputBytes !== undefined
      ? { maxMediaBytes: deps.limits.maxOutputBytes }
      : {}),
  };
}

/**
 * The .docx, inspected before anyone downloads it: read back by
 * `./docx-read` (which shares nothing with the writer), it must hold every
 * picture the document was planned with, each showing a media part that is
 * in the package, and one page break between each pair of pages written.
 * PowerPoint's deck gets the same treatment (`undeliverablePptx`). A pass is
 * necessary, not sufficient: Word itself is the instrument for "it opens"
 * (`scripts/prove-docx-opens.ts`).
 */
async function undeliverableDocx(
  output: Uint8Array,
  plan: { pictures: number; pageBreaks: number },
): Promise<Failure | null> {
  let problem: string | null = null;
  try {
    const body = await readDocxBody(output);
    const breaks = body.paragraphs.length
      ? body.paragraphs[body.paragraphs.length - 1]!.segment
      : 0;
    if (body.pictures.length !== plan.pictures)
      problem = `${body.pictures.length} of ${plan.pictures} pictures`;
    else if (
      body.pictures.some((p) => !p.bytes || p.width <= 0 || p.height <= 0)
    )
      problem = "a picture without its image";
    else if (breaks !== plan.pageBreaks)
      problem = `${breaks} of ${plan.pageBreaks} page breaks`;
  } catch {
    problem = "unreadable package";
  }
  return problem
    ? {
        ok: false,
        kind: "incomplete_output",
        message: `The Word file came out incomplete, so it was not delivered. This is a fault in pdf.xyz, not in your PDF. (${problem})`,
      }
    : null;
}

/**
 * The DOCX, since 2026-10-17: every page's paragraphs in poppler's reading
 * order (`../pdf-text/flow`), as before, and every raster picture the page
 * reader finds (`./page-scan`, pictures only) placed among them
 * (`./docx-layout`) at the size the page shows it, fitted to the text area.
 * Until then Word wrote the text alone, and the owner's 33-page tutorial came
 * back with none of its 37 pictures.
 *
 * A PDF with no selectable text at all is still refused (`no_text`, pointing
 * to OCR PDF), though its pages are pictures it could now carry: a Word
 * document of page pictures has nothing in it to edit, and it would arrive
 * under "Your DOCX file is ready." OCR PDF first gives the words AND keeps
 * the scan, which then comes through as a picture. A page without text in a
 * PDF that has some carries its pictures, and the result names it.
 */
async function renderWord(
  input: Uint8Array,
  extractFlow: PdfFlowExtractor,
  scanPages: PdfPageScanner,
  deps: PdfOfficeExportDeps,
): Promise<Rendered | Failure | null> {
  let flow = await extractFlow(input);
  const hasText = (f: PdfFlowText) =>
    f.pages.some((page) => flowPageText(page).trim().length > 0);
  if (!hasText(flow)) return null;
  const scanned = await scanOrRebuild(input, scanPages, deps, {
    ...scanOptions(deps),
    picturesOnly: true,
  });
  if ("ok" in scanned) return scanned;
  const { scan, rebuilt } = scanned;
  // The rebuilt copy is what the pictures came from, so the text does too.
  if (rebuilt) flow = await extractFlow(rebuilt);
  const doc = docxDocumentOf(flow, scan);
  const { bytes: output, plan } = await docxPackage(doc);
  const refused = await undeliverableDocx(output, plan);
  if (refused) return refused;
  const pageCount = doc.pages.length;
  // The same per-page text the DOCX is written from — measured, not
  // re-extracted, so the coverage notice cannot name a different page.
  const pageTexts = flow.pages.map((page) => ({
    pageNumber: page.pageNumber,
    text: flowPageText(page),
  }));
  const withText = new Set(
    pageTexts.filter((p) => p.text.trim()).map((p) => p.pageNumber),
  );
  const asPictures = scan.pages
    .filter((p) => !withText.has(p.pageNumber) && scannedPictures(p).length > 0)
    .map((p) => p.pageNumber);
  const lost = losses(scan);
  return {
    output,
    filenameExt: "docx",
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pageCount,
    characterCount: pageTexts.reduce((n, page) => n + page.text.length, 0),
    coverage: buildOfficeExportResultMeta({
      ...measureOfficeExportPages(pageCount, pageTexts),
      picturePageCount: asPictures.length,
      pagesAsPictures: asPictures,
      picturesNotCarried: lost.picturesNotCarried,
      picturesTooLarge: lost.picturesTooLarge,
      pagesMissingPictures: lost.pagesMissingPictures,
      ...(rebuilt ? { repairedBeforeConversion: true as const } : {}),
    }),
  };
}

/**
 * The deck, inspected before anyone downloads it.
 *
 * Every deck this tool shipped until 2026-09-27 was refused by PowerPoint, and
 * both checks that passed it ran somewhere other than here: a unit test on
 * `main` and a deployment proof after the fact. This runs `./pptx-inspect` —
 * the same inspector the worker's start-up probe runs, which needs nothing the
 * image lacks — over the bytes about to be delivered, and requires one slide
 * per page and every picture the deck was planned with (each one a `p:pic`
 * whose blip resolves to an image part). A pass is necessary, not sufficient:
 * PowerPoint itself is the only instrument for "it opens"
 * (`scripts/prove-pptx-opens.ts`).
 */
async function undeliverablePptx(
  output: Uint8Array,
  slides: number,
  pictures: number,
): Promise<Failure | null> {
  const { problems, counts } = await inspectPptxPackage(output);
  if (
    problems.length === 0 &&
    counts.slides === slides &&
    counts.pictures === pictures
  )
    return null;
  const failed = [...new Set(problems.map((p) => p.check))];
  return {
    ok: false,
    kind: "incomplete_output",
    message: `The PowerPoint file came out incomplete, so it was not delivered. This is a fault in pdf.xyz, not in your PDF. (${
      failed.length > 0
        ? `failed: ${failed.slice(0, 4).join(", ")}`
        : counts.slides !== slides
          ? `${counts.slides} of ${slides} slides`
          : `${counts.pictures} of ${pictures} pictures`
    })`,
  };
}

async function renderExcel(
  input: Uint8Array,
  extract: PdfTextExtractor,
): Promise<Rendered | null> {
  const extracted = await extract(input);
  if (!extracted.hasText || extracted.text.trim().length === 0) return null;
  return {
    pageCount: extracted.pageCount,
    characterCount: extracted.characterCount,
    coverage: measureOfficeExportPages(extracted.pageCount, extracted.pages),
    output: await xlsx(extracted.pages),
    filenameExt: "xlsx",
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

/**
 * Which slides carry their page only as pictures: no text was found on the
 * page, and something was drawn on it. Measured from the scan the deck was
 * written from, never re-extracted.
 */
function picturePages(scan: PdfPageScan): number[] {
  return scan.pages
    .filter(
      (page) =>
        page.items.length > 0 && page.items.every((i) => i.kind === "picture"),
    )
    .map((page) => page.pageNumber);
}

/**
 * What the slides do NOT carry that their pages paint, and which slides are
 * empty because their page is — from the same scan the deck was written
 * from. Until 2026-10-11 a picture the scan could not carry (too large for
 * the worker's memory, or undecodable) left no trace: its page read as
 * having "nothing on it", a sentence the panel said about a page that held a
 * full-page scan.
 */
function losses(scan: PdfPageScan) {
  const lost = (p: PdfPageScan["pages"][number]) =>
    p.picturesTooLarge + p.picturesUndecoded;
  const missing = scan.pages.filter((p) => lost(p) > 0);
  const flattened = scan.pages.filter((p) => p.flattened);
  return {
    picturesNotCarried: scan.pages.reduce((n, p) => n + lost(p), 0),
    picturesTooLarge: scan.pages.reduce((n, p) => n + p.picturesTooLarge, 0),
    pagesMissingPictures: missing.map((p) => p.pageNumber),
    // Never a page pdf.js may have removed a picture from unseen
    // (`picturesUnverified`): "nothing on it" is a claim the scan must have
    // seen, and until 2026-10-11 it was said of a page holding a full-page
    // scan.
    emptySlideCount: scan.pages.filter(
      (p) => p.items.length === 0 && lost(p) === 0 && !p.picturesUnverified,
    ).length,
    flattenedPageCount: flattened.length,
    pagesFlattened: flattened.map((p) => p.pageNumber),
  };
}

/**
 * The PPTX, since 2026-10-10: every page read by `./page-scan` and laid out
 * by `./deck-from-scan` — pictures where the page paints them, text in boxes
 * at its position, the rest of the ink as transparent pictures, in paint
 * order. pdftotext still runs FIRST: a locked or damaged PDF is refused, and
 * classified, exactly as Word and Excel refuse it. A PDF with no text at all
 * is NOT refused here, unlike those two: its slides carry its pages as
 * pictures, and the result says which pages hold no editable text.
 */
async function renderPowerPoint(
  input: Uint8Array,
  extract: PdfTextExtractor,
  scanPages: PdfPageScanner,
  deps: PdfOfficeExportDeps,
): Promise<Rendered | Failure> {
  await extract(input);
  // A file the page reader cannot read ahead is rebuilt first, the way
  // Repair PDF does, and the rebuilt copy scanned — bounded, like any other.
  // With nothing to rebuild it, or a rebuild the reader still cannot read,
  // it is refused: never scanned without a bound.
  const scanned = await scanOrRebuild(
    input,
    scanPages,
    deps,
    scanOptions(deps),
  );
  if ("ok" in scanned) return scanned;
  const { scan } = scanned;
  const repaired = scanned.rebuilt !== null;
  const deck = deckFromScan(scan);
  const output = await (deps.writePptx ?? pptxPackage)(deck);
  const planned = deck.slides.reduce(
    (n, slide) => n + slide.shapes.filter((s) => s.kind === "picture").length,
    0,
  );
  const refused = await undeliverablePptx(output, scan.pageCount, planned);
  if (refused) return refused;
  const pageTexts = scan.pages.map((page) => ({
    pageNumber: page.pageNumber,
    text: scannedPageText(page),
  }));
  const asPictures = picturePages(scan);
  return {
    pageCount: scan.pageCount,
    characterCount: pageTexts.reduce(
      (n, page) => n + page.text.replace(/\n/g, "").length,
      0,
    ),
    coverage: buildOfficeExportResultMeta({
      ...measureOfficeExportPages(scan.pageCount, pageTexts),
      picturePageCount: asPictures.length,
      pagesAsPictures: asPictures,
      ...losses(scan),
      ...(repaired ? { repairedBeforeConversion: true } : {}),
    }),
    output,
    filenameExt: "pptx",
    contentType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
}

export async function runPdfOfficeExport(
  tool: PdfOfficeExportTool,
  input: Uint8Array,
  deps: PdfOfficeExportDeps,
): Promise<PdfOfficeExportRun> {
  const { extract, extractFlow, scanPages } = deps;
  if (
    tool === PDF_TO_WORD_TOOL
      ? !extractFlow || !scanPages
      : !extract || (tool === PDF_TO_POWERPOINT_TOOL && !scanPages)
  )
    return UNSUPPORTED;
  const maxInput = deps.limits?.maxInputBytes;
  if (maxInput !== undefined && input.byteLength > maxInput)
    return {
      ok: false,
      kind: "too_large",
      limitBytes: maxInput,
      message: "The PDF input exceeds the worker's size limit.",
    };
  try {
    const rendered =
      tool === PDF_TO_WORD_TOOL
        ? await renderWord(input, extractFlow!, scanPages!, deps)
        : tool === PDF_TO_EXCEL_TOOL
          ? await renderExcel(input, extract!)
          : await renderPowerPoint(input, extract!, scanPages!, deps);
    if (!rendered) return NO_TEXT;
    if ("ok" in rendered) return rendered;
    const maxOutput = deps.limits?.maxOutputBytes;
    if (maxOutput !== undefined && rendered.output.byteLength > maxOutput)
      // Deterministic: the same PDF renders the same file on every attempt,
      // so this was a retryable `failed` that could only fail again.
      return {
        ok: false,
        kind: "too_large",
        limitBytes: maxOutput,
        message: "The exported Office file exceeds the worker size limit.",
      };
    return {
      ok: true,
      output: rendered.output,
      filenameExt: rendered.filenameExt,
      contentType: rendered.contentType,
      meta: {
        engine:
          tool === PDF_TO_POWERPOINT_TOOL
            ? PDF_TO_POWERPOINT_ENGINE
            : tool === PDF_TO_WORD_TOOL
              ? PDF_TO_WORD_ENGINE
              : PDF_OFFICE_EXPORT_ENGINE,
        tool,
        pageCount: rendered.pageCount,
        inputBytes: input.byteLength,
        outputBytes: rendered.output.byteLength,
        characterCount: rendered.characterCount,
      },
      coverage: rendered.coverage,
    };
  } catch (error) {
    if (error instanceof PageScanTooLargeError)
      return {
        ok: false,
        kind: "too_large",
        limitBytes: error.limitBytes,
        message: "The exported Office file exceeds the worker size limit.",
      };
    if (error instanceof PageScanDecodeBudgetError)
      return {
        ok: false,
        kind: "too_large",
        limitBytes: error.limitBytes,
        message:
          "This PDF's pictures are too large in total for the worker to convert. Split it into smaller PDFs, or compress its images, then try again.",
      };
    return classifyFailure(error, input, deps);
  }
}
