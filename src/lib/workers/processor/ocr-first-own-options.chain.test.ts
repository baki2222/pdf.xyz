/**
 * OCR first beside each tool's OWN option, in one job (integration of
 * feat/w3-l03-ocr-in-conversions with feat/w3-l10-tables, 2026-11-08).
 *
 * The two lanes each gave Extract Tables and PDF to Excel one option, and
 * each wrote "its one option" against the same options bag: l03 put OCR
 * first's `{ ocr, languages, … }` there, l10 put `{ combine }` (Extract
 * Tables) and `{ sheetPerPage }` (PDF to Excel). Both passed their own tests;
 * the composition is a job that asks for both, and nothing tested it. This
 * file drives that job through the real registry and reads the file it
 * wrote, so a resolution that kept one side's option and dropped the other's
 * goes red here.
 *
 * It also pins the ORDER: a malformed own option is refused before OCR runs,
 * so a bad bag never costs minutes of recognition first.
 */
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildOcrResultMeta, type OcrOptions } from "@/lib/jobs/ocr";
import {
  COMBINED_CSV_NAME,
  COMBINED_SHEET_NAME,
} from "@/lib/jobs/extract-tables-options";
import { pageSheetName } from "@/lib/jobs/pdf-to-excel-options";
import type { PdfLayout } from "../table-extract/engine";
import type {
  PdfFlowExtractor,
  PdfTextExtractor,
} from "../pdf-office-export/engine";
import type {
  PdfPageScan,
  PdfPageScanner,
} from "../pdf-office-export/page-scan";
import { createProcessorRegistry, type OcrRunner } from "./index";

const enc = (s: string) => new TextEncoder().encode(s);
const SCAN = enc("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n% scan\n%%EOF\n");
const SEARCHABLE = enc(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n% ocr layer\n%%EOF\n",
);
const isSearchable = (bytes: Uint8Array) =>
  Buffer.from(bytes).equals(Buffer.from(SEARCHABLE));
const RECOGNISED = ["Recognised-One", "Recognised-Two"];

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
    pageCount: 2,
  }),
});

/** poppler's positioned text, played: one table per page, only after OCR. */
async function extractLayout(bytes: Uint8Array): Promise<PdfLayout> {
  const page = (pageNumber: number, word: string) => ({
    pageNumber,
    width: 400,
    height: 300,
    items: isSearchable(bytes)
      ? [
          { text: "Name", x: 50, y: 100, width: 20, height: 10 },
          { text: "Age", x: 200, y: 100, width: 15, height: 10 },
          { text: word, x: 50, y: 80, width: 60, height: 10 },
          { text: "30", x: 200, y: 80, width: 10, height: 10 },
        ]
      : [],
  });
  return {
    pageCount: 2,
    pages: [page(1, RECOGNISED[0]!), page(2, RECOGNISED[1]!)],
  };
}

/** poppler `-layout`, played: two pages of words, only after OCR. */
const extract: PdfTextExtractor = async (bytes) => {
  const pages = RECOGNISED.map((word, i) => {
    const text = isSearchable(bytes) ? word : "";
    return { pageNumber: i + 1, text, characterCount: text.length };
  });
  const text = pages.map((p) => p.text).join("\f");
  return {
    pageCount: 2,
    pages,
    text,
    characterCount: text.replace(/\f/g, "").length,
    hasText: isSearchable(bytes),
  };
};
const extractFlow: PdfFlowExtractor = async (bytes) => ({
  pageCount: 2,
  pages: RECOGNISED.map((word, i) => ({
    pageNumber: i + 1,
    paragraphs: isSearchable(bytes) ? [[word]] : [],
  })),
});
const scanPages: PdfPageScanner = async () => {
  const scan: PdfPageScan = {
    pageCount: 2,
    pages: [1, 2].map((pageNumber) => ({
      pageNumber,
      width: 720,
      height: 540,
      items: [],
      picturesTooLarge: 0,
      picturesUndecoded: 0,
      picturesUnverified: false,
      flattened: false,
    })),
    undecodedImages: 0,
    tooLargeImages: 0,
  };
  return scan;
};

function registry() {
  const asked: OcrOptions[] = [];
  const reg = createProcessorRegistry({
    ocr: {
      runner: async (input) => {
        asked.push(input.options);
        return ocrmypdf(input);
      },
      engines: { ocrmypdf: true, tesseract: true },
    },
    tableExtract: { extractLayout },
    pdfOfficeExport: { extract, extractFlow, scanPages },
  });
  return {
    resolve: (tool: string) => reg.resolve(tool)!,
    asked,
  };
}

const job = (tool: string, options: Record<string, unknown>) => ({
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

const OCR = { ocr: true, languages: ["eng"] } as const;

async function zipNames(bytes: Uint8Array): Promise<string[]> {
  return Object.keys((await JSZip.loadAsync(bytes)).files).sort();
}
async function sheetNames(xlsx: Uint8Array): Promise<string[]> {
  const book = await (
    await JSZip.loadAsync(xlsx)
  )
    .file("xl/workbook.xml")!
    .async("string");
  return [...book.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]!);
}

describe("Extract Tables: Combine tables into one sheet WITH OCR first", () => {
  it("control: OCR alone gives a CSV per table, not the combined one", async () => {
    const { resolve } = registry();
    const result = await resolve("extract-tables").process(
      job("extract-tables", { ...OCR }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const names = await zipNames(result.artifacts[0]!.bytes);
    expect(names.filter((n) => n.endsWith(".csv")).length).toBe(2);
    expect(names).not.toContain(COMBINED_CSV_NAME);
  });

  it("both: OCR ran, and the ZIP holds the one combined CSV with both recognised tables", async () => {
    const { resolve, asked } = registry();
    const result = await resolve("extract-tables").process(
      job("extract-tables", { ...OCR, combine: true }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(asked).toHaveLength(1);
    const zip = await JSZip.loadAsync(result.artifacts[0]!.bytes);
    const csvs = Object.keys(zip.files).filter((n) => n.endsWith(".csv"));
    expect(csvs).toEqual([COMBINED_CSV_NAME]);
    const csv = await zip.file(COMBINED_CSV_NAME)!.async("string");
    for (const word of RECOGNISED) expect(csv).toContain(word);
    const xlsx = Object.keys(zip.files).find((n) => n.endsWith(".xlsx"))!;
    expect(await sheetNames(await zip.file(xlsx)!.async("uint8array"))).toEqual(
      [COMBINED_SHEET_NAME],
    );
    // Both result blocks reach the card: what OCR did, and what was found.
    expect(result.meta?.ocrFirst).toBe(true);
    expect(result.meta?.combined).toBe(true);
    expect(result.results?.ocr?.languages).toEqual(["eng"]);
    expect(result.results?.tables?.tableCount).toBeGreaterThan(0);
  });

  it("a malformed combine is refused BEFORE OCR runs", async () => {
    const { resolve, asked } = registry();
    const result = await resolve("extract-tables").process(
      job("extract-tables", { ...OCR, combine: "yes" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_request");
    expect(asked).toEqual([]);
  });
});

describe("PDF to Excel: One sheet per page WITH OCR first", () => {
  it("control: OCR alone gives the one sheet", async () => {
    const { resolve } = registry();
    const result = await resolve("pdf-to-excel").process(
      job("pdf-to-excel", { ...OCR }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await sheetNames(result.artifacts[0]!.bytes)).toHaveLength(1);
  });

  it("both: OCR ran, and each recognised page is its own sheet", async () => {
    const { resolve, asked } = registry();
    const result = await resolve("pdf-to-excel").process(
      job("pdf-to-excel", { ...OCR, sheetPerPage: true }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(asked).toHaveLength(1);
    expect(await sheetNames(result.artifacts[0]!.bytes)).toEqual(
      [1, 2].map(pageSheetName),
    );
    expect(result.results?.ocr?.languages).toEqual(["eng"]);
  });

  it("a malformed sheetPerPage is refused BEFORE OCR runs", async () => {
    const { resolve, asked } = registry();
    const result = await resolve("pdf-to-excel").process(
      job("pdf-to-excel", { ...OCR, sheetPerPage: 1 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_request");
    expect(asked).toEqual([]);
  });
});
