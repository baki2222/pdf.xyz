import JSZip from "jszip";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import { XLSX_SHEET_NAME } from "@/lib/jobs/pdf-office-export";
import {
  measureOfficeExportPages,
  type OfficeExportResultMeta,
} from "@/lib/jobs/office-export-results";
import {
  flowPageText,
  type PdfFlowText,
  type PdfFlowTextPage,
} from "../pdf-text/flow";
import {
  SheetStyles,
  STYLES_CONTENT_TYPE_OVERRIDE,
  stylesRelationship,
  worksheetXml,
  xmlEscape,
} from "../ooxml/sheet-cells";
import { deckFromScan } from "./deck-from-scan";
import { classifyPdfTextFailure } from "./encryption";
import { layoutGrid } from "./layout-grid";
import {
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
   * PDF to PowerPoint's page reader: each page's pictures, positioned text and
   * other ink, in paint order (`./page-scan`). PowerPoint answers
   * `unsupported` without it: there is no text-only fallback, because a deck
   * with no pictures is the defect this replaced, not a lesser success.
   */
  scanPages?: PdfPageScanner;
  /**
   * The PowerPoint writer. Defaults to `./pptx-package`; injectable so a test
   * can hand the engine a writer that regressed and see what it delivers.
   */
  writePptx?: (deck: PptxDeck) => Promise<Uint8Array>;
  limits?: {
    maxInputBytes?: number;
    maxOutputBytes?: number;
    /** How long PDF to PowerPoint's page scan may run, in ms. */
    scanTimeoutMs?: number;
  };
}
export interface PdfOfficeExportMeta {
  engine: typeof PDF_OFFICE_EXPORT_ENGINE | typeof PDF_TO_POWERPOINT_ENGINE;
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

const WORD_MAIN_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const WORD_PAGE_BREAK = `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;

/** One paragraph: a prose cell, or a table row whose cells are tab-separated. */
function wordParagraph(cells: readonly string[]): string {
  // The shared escape, which also drops what XML 1.0 cannot carry. This file
  // used to keep its own copy that escaped markup but not those, so one stray
  // control character from pdftotext made the whole DOCX (and PPTX) part
  // malformed XML.
  const runs = cells
    .map((cell) => `<w:t xml:space="preserve">${xmlEscape(cell)}</w:t>`)
    .join("<w:tab/>");
  return `<w:p><w:r>${runs}</w:r></w:p>`;
}

/**
 * The DOCX body: each PDF page's paragraphs in reading order, with a page
 * break between pages that have any. Built from `extractFlow`, never from
 * `-layout` lines — see `../pdf-text/flow` for what those did to a two-column
 * page.
 */
function docxBody(pages: readonly PdfFlowTextPage[]): string {
  return pages
    .filter((page) => page.paragraphs.length > 0)
    .map((page) => page.paragraphs.map(wordParagraph).join(""))
    .join(WORD_PAGE_BREAK);
}

async function docx(pages: readonly PdfFlowTextPage[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${WORD_MAIN_NS}"><w:body>${docxBody(pages)}<w:sectPr/></w:body></w:document>`,
  );
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

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

async function renderWord(
  input: Uint8Array,
  extractFlow: PdfFlowExtractor,
): Promise<Rendered | null> {
  const flow = await extractFlow(input);
  // The same per-page text the DOCX is written from — measured, not
  // re-extracted, so the coverage notice cannot name a different page.
  const pageTexts = flow.pages.map((page) => ({
    pageNumber: page.pageNumber,
    text: flowPageText(page),
  }));
  if (pageTexts.every((page) => page.text.trim().length === 0)) return null;
  return {
    output: await docx(flow.pages),
    filenameExt: "docx",
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pageCount: flow.pageCount,
    characterCount: pageTexts.reduce((n, page) => n + page.text.length, 0),
    coverage: measureOfficeExportPages(flow.pageCount, pageTexts),
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
  const timeout = deps.limits?.scanTimeoutMs;
  const scan = await scanPages(input, {
    ...(timeout !== undefined ? { deadline: Date.now() + timeout } : {}),
    ...(deps.limits?.maxOutputBytes !== undefined
      ? { maxMediaBytes: deps.limits.maxOutputBytes }
      : {}),
  });
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
    coverage: {
      ...measureOfficeExportPages(scan.pageCount, pageTexts),
      picturePageCount: asPictures.length,
      pagesAsPictures: asPictures,
    },
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
      ? !extractFlow
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
        ? await renderWord(input, extractFlow!)
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
    return classifyFailure(error, input, deps);
  }
}
