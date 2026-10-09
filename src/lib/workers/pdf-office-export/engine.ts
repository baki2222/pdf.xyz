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
import { classifyPdfTextFailure } from "./encryption";
import { layoutGrid } from "./layout-grid";
import { inspectPptxPackage } from "./pptx-inspect";
import { pptxPackage, type PptxSlide } from "./pptx-package";

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
 * worker does not use and cannot use — pdfjs is browser-only and throws under
 * Node before reading a byte, which is why `pdf-text/native` shells out to
 * `pdftotext` instead. Job records written before that date carry the old value.
 */
export const PDF_OFFICE_EXPORT_ENGINE = "pdftotext-office-openxml" as const;

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
   * The PowerPoint writer. Defaults to `./pptx-package`; injectable so a test
   * can hand the engine a writer that regressed and see what it delivers.
   */
  writePptx?: (slides: readonly PptxSlide[]) => Promise<Uint8Array>;
  limits?: { maxInputBytes?: number; maxOutputBytes?: number };
}
export interface PdfOfficeExportMeta {
  engine: typeof PDF_OFFICE_EXPORT_ENGINE;
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

function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

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

/**
 * The PPTX: one slide per page, the page's non-blank `-layout` lines as
 * paragraphs — a textless page still gets its slide, so slide N is page N.
 * The package itself, and why every part in it is there, is `./pptx-package`;
 * what it must pass before anyone downloads it is `undeliverablePptx` below.
 */
function pptx(
  pages: ExtractedPdfText["pages"],
  write: NonNullable<PdfOfficeExportDeps["writePptx"]> = pptxPackage,
): Promise<Uint8Array> {
  return write(
    pages.map((page) => ({
      name: `Page ${page.pageNumber}`,
      lines: lines(page.text),
    })),
  );
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
 * per page. A pass is necessary, not sufficient: PowerPoint itself is the only
 * instrument for "it opens" (`scripts/prove-pptx-opens.ts`).
 */
async function undeliverablePptx(
  output: Uint8Array,
  slides: number,
): Promise<Failure | null> {
  const { problems, counts } = await inspectPptxPackage(output);
  if (problems.length === 0 && counts.slides === slides) return null;
  const failed = [...new Set(problems.map((p) => p.check))];
  return {
    ok: false,
    kind: "incomplete_output",
    message: `The PowerPoint file came out incomplete, so it was not delivered. This is a fault in pdf.xyz, not in your PDF. (${
      failed.length > 0
        ? `failed: ${failed.slice(0, 4).join(", ")}`
        : `${counts.slides} of ${slides} slides`
    })`,
  };
}

async function renderLayout(
  tool: typeof PDF_TO_EXCEL_TOOL | typeof PDF_TO_POWERPOINT_TOOL,
  input: Uint8Array,
  extract: PdfTextExtractor,
  writePptx: PdfOfficeExportDeps["writePptx"],
): Promise<Rendered | Failure | null> {
  const extracted = await extract(input);
  if (!extracted.hasText || extracted.text.trim().length === 0) return null;
  const base = {
    pageCount: extracted.pageCount,
    characterCount: extracted.characterCount,
    coverage: measureOfficeExportPages(extracted.pageCount, extracted.pages),
  };
  if (tool === PDF_TO_EXCEL_TOOL)
    return {
      ...base,
      output: await xlsx(extracted.pages),
      filenameExt: "xlsx",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  const output = await pptx(extracted.pages, writePptx);
  const refused = await undeliverablePptx(output, extracted.pages.length);
  if (refused) return refused;
  return {
    ...base,
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
  const { extract, extractFlow } = deps;
  if (tool === PDF_TO_WORD_TOOL ? !extractFlow : !extract) return UNSUPPORTED;
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
        : await renderLayout(tool, input, extract!, deps.writePptx);
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
        engine: PDF_OFFICE_EXPORT_ENGINE,
        tool,
        pageCount: rendered.pageCount,
        inputBytes: input.byteLength,
        outputBytes: rendered.output.byteLength,
        characterCount: rendered.characterCount,
      },
      coverage: rendered.coverage,
    };
  } catch (error) {
    return classifyFailure(error, input, deps);
  }
}
