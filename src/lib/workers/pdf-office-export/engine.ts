import JSZip from "jszip";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import {
  measureOfficeExportPages,
  type OfficeExportResultMeta,
} from "@/lib/jobs/office-export-results";
import { isPdfOpenRefusal, PdfTextExecError } from "../pdf-text/errors";
import {
  flowPageText,
  type PdfFlowText,
  type PdfFlowTextPage,
} from "../pdf-text/flow";
import { pdfHasEncryptionDictionary } from "./encryption";

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
   * Excel's row splitting depends on exactly that padding. Word never falls
   * back to `extract`: without this it reports `unsupported`.
   */
  extractFlow?: PdfFlowExtractor;
  /**
   * Whether the document carries an encryption dictionary. Asked only after
   * the extractor refused to open it. Defaults to a pdf-lib parse.
   */
  isEncrypted?: (bytes: Uint8Array) => Promise<boolean>;
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

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
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
  const runs = cells
    .map((cell) => `<w:t xml:space="preserve">${esc(cell)}</w:t>`)
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

function rows(text: string): string[][] {
  return lines(text).map((l) =>
    l
      .split(/\t| {2,}|,/)
      .map((c) => c.trim())
      .filter(Boolean),
  );
}
async function xlsx(text: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Extracted text" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  const sheetData = rows(text)
    .map(
      (r, ri) =>
        `<row r="${ri + 1}">${r.map((c, ci) => `<c r="${String.fromCharCode(65 + Math.min(ci, 25))}${ri + 1}" t="inlineStr"><is><t>${esc(c)}</t></is></c>`).join("")}</row>`,
    )
    .join("");
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>`,
  );
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

async function pptx(pages: ExtractedPdfText["pages"]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${pages.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
  );
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>${pages.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join("")}</p:sldIdLst></p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${pages.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join("")}</Relationships>`,
  );
  for (const page of pages)
    zip.file(
      `ppt/slides/slide${page.pageNumber}.xml`,
      `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/><p:sp><p:nvSpPr/><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${lines(
        page.text,
      )
        .map((l) => `<a:p><a:r><a:t>${esc(l)}</a:t></a:r></a:p>`)
        .join("")}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    );
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
  if (error instanceof PdfTextExecError && error.outputTooLarge)
    return {
      ok: false,
      kind: "too_large",
      message: "The text extracted from this PDF exceeds the worker's limit.",
    };
  if (isPdfOpenRefusal(error)) {
    const isEncrypted = deps.isEncrypted ?? pdfHasEncryptionDictionary;
    const encrypted = await isEncrypted(input).catch(() => false);
    return encrypted
      ? {
          ok: false,
          kind: "password_protected",
          message:
            "This PDF is password-protected. Unlock it with Unlock PDF, then convert it.",
        }
      : {
          ok: false,
          kind: "unreadable",
          message:
            "This PDF could not be opened. It may be damaged; Repair PDF can often fix that.",
        };
  }
  return {
    ok: false,
    kind: "failed",
    message: "The PDF could not be exported to an Office file.",
  };
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

async function renderLayout(
  tool: typeof PDF_TO_EXCEL_TOOL | typeof PDF_TO_POWERPOINT_TOOL,
  input: Uint8Array,
  extract: PdfTextExtractor,
): Promise<Rendered | null> {
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
      output: await xlsx(extracted.text),
      filenameExt: "xlsx",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  return {
    ...base,
    output: await pptx(extracted.pages),
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
        : await renderLayout(tool, input, extract!);
    if (!rendered) return NO_TEXT;
    const maxOutput = deps.limits?.maxOutputBytes;
    if (maxOutput !== undefined && rendered.output.byteLength > maxOutput)
      return {
        ok: false,
        kind: "failed",
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
