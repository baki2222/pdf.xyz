/**
 * "Recognise text in scans (OCR)" on PDF to Excel and PDF to PowerPoint, and
 * the OCR choices PDF to Word's switch now carries (audit 2026-11-06:
 * pdf-to-excel#2, pdf-to-powerpoint#4, pdf-to-word#3). ONE job through the
 * real registry: the OCR PDF processor first, then the export of its
 * searchable PDF — the chain PDF to Word has used since 2026-10-24, not a
 * second one. Played: OCRmyPDF (marked bytes), poppler's `-layout` text and
 * the page reader (words only in the bytes OCR produced). Each test reads
 * the file the job produced (the XLSX cells, the PPTX slide), not a return
 * value.
 */
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildOcrResultMeta, type OcrOptions } from "@/lib/jobs/ocr";
import { OFFICE_EXPORT_ERROR_CODES } from "@/lib/jobs/office-export-results";
import { OCR_REFUSAL_MESSAGES, OcrEngineRefusal } from "../ocr-engine-errors";
import type {
  PdfPageScan,
  PdfPageScanner,
} from "../pdf-office-export/page-scan";
import type {
  PdfFlowExtractor,
  PdfTextExtractor,
} from "../pdf-office-export/engine";
import { stubLine } from "@/tests/page-scan-stubs";
import { createProcessorRegistry, type OcrRunner } from "./index";

const enc = (s: string) => new TextEncoder().encode(s);
const SCAN = enc("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n% scan\n%%EOF\n");
const SEARCHABLE = enc(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n% ocr layer\n%%EOF\n",
);
const RECOGNISED = "Statement 2026-118 total 41.20";
const isSearchable = (bytes: Uint8Array) =>
  Buffer.from(bytes).equals(Buffer.from(SEARCHABLE));

/** poppler `-layout`, played: the scan has no text, OCR's output has the words. */
const extract: PdfTextExtractor = async (bytes) => {
  const text = isSearchable(bytes) ? RECOGNISED : "";
  return {
    pageCount: 1,
    pages: [{ pageNumber: 1, text, characterCount: text.length }],
    text,
    characterCount: text.length,
    hasText: text.length > 0,
  };
};
const extractFlow: PdfFlowExtractor = async (bytes) => ({
  pageCount: 1,
  pages: [
    {
      pageNumber: 1,
      paragraphs: isSearchable(bytes) ? [[RECOGNISED]] : [],
    },
  ],
});
/** The page reader: OCR's layer is invisible text over the page. */
const scanPages: PdfPageScanner = async (bytes) => {
  const line = stubLine(RECOGNISED, 0);
  const items = isSearchable(bytes)
    ? [{ ...line, runs: line.runs.map((r) => ({ ...r, invisible: true })) }]
    : [];
  const scan: PdfPageScan = {
    pageCount: 1,
    pages: [
      {
        pageNumber: 1,
        width: 720,
        height: 540,
        items,
        picturesTooLarge: 0,
        picturesUndecoded: 0,
        picturesUnverified: false,
        flattened: false,
      },
    ],
    undecodedImages: 0,
    tooLargeImages: 0,
  };
  return scan;
};

const ocrmypdf: OcrRunner = async ({ options }) => ({
  artifacts: [
    {
      filename: "scan-ocr.pdf",
      contentType: "application/pdf",
      bytes: SEARCHABLE,
    },
  ],
  meta: buildOcrResultMeta({
    engine: "ocrmypdf",
    languages: options.languages,
    outputMode: options.outputMode,
    producedSearchablePdf: true,
    producedTextSidecar: false,
    pageCount: 1,
  }),
});

type OfficeTool = "pdf-to-word" | "pdf-to-excel" | "pdf-to-powerpoint";

function registry(
  tool: OfficeTool,
  runner: OcrRunner = ocrmypdf,
  limits?: { maxInputBytes?: number },
) {
  const asked: OcrOptions[] = [];
  const reg = createProcessorRegistry({
    ocr: {
      runner: async (input) => {
        asked.push(input.options);
        return runner(input);
      },
      engines: { ocrmypdf: true, tesseract: true },
    },
    pdfOfficeExport: {
      extract,
      extractFlow,
      scanPages,
      ...(limits ? { limits } : {}),
    },
  });
  return { processor: reg.resolve(tool)!, asked };
}

const job = (tool: OfficeTool, options: Record<string, unknown>) => ({
  tool,
  options,
  inputs: [
    {
      fileId: "f",
      filename: "scan.pdf",
      contentType: "application/pdf",
      bytes: SCAN,
    },
  ],
});

/** Every XML part under `prefix`, tags stripped: what the file carries. */
async function partsText(bytes: Uint8Array, prefix: string): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter(
    (n) => n.startsWith(prefix) && n.endsWith(".xml"),
  );
  // Health check: an empty set would make every "not.toContain" vacuous.
  expect(names.length).toBeGreaterThan(0);
  const xml = await Promise.all(names.map((n) => zip.file(n)!.async("string")));
  return xml
    .join(" ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

const SEARCHABLE_REQUEST: OcrOptions = {
  languages: ["eng"],
  outputMode: "searchable-pdf",
  redoOcr: false,
  deskew: false,
  rotatePages: false,
};

describe("PDF to Excel, OCR first — one job (audit pdf-to-excel#2)", () => {
  it("control: without OCR a scan is still refused for having no text, and OCR never runs", async () => {
    const { processor, asked } = registry("pdf-to-excel");
    const result = await processor.process(job("pdf-to-excel", {}));
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.code).toBe(OFFICE_EXPORT_ERROR_CODES.noText);
    expect(asked).toEqual([]);
  });

  it("with OCR on, the recognised words are cells of the XLSX, and OCR got the chosen languages", async () => {
    const { processor, asked } = registry("pdf-to-excel");
    const result = await processor.process(
      job("pdf-to-excel", { ocr: true, languages: ["eng"] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(asked).toEqual([SEARCHABLE_REQUEST]);
    expect(result.artifacts[0]!.filename).toBe("scan.xlsx");
    expect(await partsText(result.artifacts[0]!.bytes, "xl/")).toContain(
      RECOGNISED,
    );
    expect(result.results?.ocr?.languages).toEqual(["eng"]);
    expect(result.meta?.ocrFirst).toBe(true);
  });

  it("OCR that recognised nothing names a spreadsheet, not a Word document, and not 'run OCR first'", async () => {
    const { processor } = registry("pdf-to-excel", async (input) => {
      const out = await ocrmypdf(input);
      return { ...out, artifacts: [{ ...out.artifacts[0]!, bytes: SCAN }] };
    });
    const result = await processor.process(job("pdf-to-excel", { ocr: true }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(OFFICE_EXPORT_ERROR_CODES.noText);
    expect(result.error.message).toMatch(/spreadsheet/);
    expect(result.error.message).not.toMatch(/Word|Run OCR first/);
  });

  it("OCR's 'already has a text layer' refusal names this panel's switch, not OCR PDF's", async () => {
    const { processor } = registry("pdf-to-excel", async () => {
      throw new OcrEngineRefusal("prior-text");
    });
    const result = await processor.process(job("pdf-to-excel", { ocr: true }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).not.toBe(OCR_REFUSAL_MESSAGES["prior-text"]);
    expect(result.error.message).toMatch(/Recognise text in scans/);
  });

  it("an upload over the ceiling is refused before OCR, naming PDF to Excel", async () => {
    let ran = false;
    const { processor } = registry(
      "pdf-to-excel",
      async (input) => {
        ran = true;
        return ocrmypdf(input);
      },
      { maxInputBytes: SCAN.byteLength - 1 },
    );
    const result = await processor.process(job("pdf-to-excel", { ocr: true }));
    expect(ran).toBe(false);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("payload_too_large");
    expect(result.error.message).toMatch(/PDF to Excel/);
    expect(result.error.message).not.toMatch(/PDF to Word/);
  });

  it("a right-to-left language is refused for Excel as for Word, before OCR runs", async () => {
    const { processor, asked } = registry("pdf-to-excel");
    const result = await processor.process(
      job("pdf-to-excel", { ocr: true, languages: ["ara"] }),
    );
    expect(result.ok).toBe(false);
    expect(asked).toEqual([]);
    if (result.ok) return;
    expect(result.error.message).toMatch(/Right-to-left/);
    expect(result.error.message).not.toMatch(/PDF to Word/);
  });

  it("an invalid option is refused before anything runs", async () => {
    const { processor, asked } = registry("pdf-to-excel");
    const result = await processor.process(job("pdf-to-excel", { ocr: "yes" }));
    expect(result.ok).toBe(false);
    expect(asked).toEqual([]);
    if (!result.ok)
      expect(result.error.code).not.toBe(OFFICE_EXPORT_ERROR_CODES.noText);
  });
});
