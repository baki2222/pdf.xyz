// @vitest-environment node
/**
 * The wave-3 PDF to Excel deployment verdicts (`./excel-options-proof`).
 * POSITIVE: the real engine's workbook of the proof's pages. NEGATIVE: the
 * image before the feature — one "Extracted text" sheet, no OCR block — and
 * the defects each option could ship (a blank page dropped, words on the
 * wrong page). HEALTH: a non-XLSX fails. And the ordering the malformed-bag
 * proof reads at the wire: the parser refuses before OCR is asked anything.
 *
 * The extractor is played (poppler's `-layout` text, laid out as it prints a
 * label flush left and an amount flush right); the deployment proof runs the
 * worker's poppler on the real PDF.
 */
import { describe, expect, it, vi } from "vitest";
import { buildOcrResultMeta } from "@/lib/jobs/ocr";
import type { JobResults } from "@/lib/jobs/results";
import { matchesExpectedFailure } from "@/lib/probes/proof-outcome";
import { NUMBER_CELL_ROWS } from "../ooxml/number-cells-proof";
import { OCR_REFUSAL_MESSAGES } from "../ocr-engine-errors";
import { createPdfOfficeExportProcessor } from "../processor/pdf-office-export";
import type { Processor } from "../processor/types";
import {
  CLOSING_ROWS,
  OCR_PROSE_LINES,
  OCR_TABLE_ROWS,
} from "../table-extract/options-proof";
import { runPdfOfficeExport, type PdfTextExtractor } from "./engine";
import {
  MALFORMED_BAG_FAILURE,
  MALFORMED_BAG_OPTIONS,
  ocrSheetPerPageVerdict,
  sheetPerPageVerdict,
} from "./excel-options-proof";

const PDF = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");
const lines = (rows: readonly (readonly string[])[]) =>
  rows
    .map((r) => r.map((c, i) => (i === 0 ? c.padEnd(24) : c)).join("    "))
    .join("\n");

/** Poppler's `-layout` text, played, one string per page. */
function played(pages: readonly string[]): PdfTextExtractor {
  return async () => ({
    pageCount: pages.length,
    pages: pages.map((text, i) => ({
      pageNumber: i + 1,
      text,
      characterCount: text.length,
    })),
    text: pages.join("\n\f"),
    characterCount: pages.join("").length,
    hasText: true,
  });
}

const NUMBER_PAGES = [lines(NUMBER_CELL_ROWS), "", lines(CLOSING_ROWS)];
const SCAN_PAGES = [lines(OCR_TABLE_ROWS), OCR_PROSE_LINES.join("\n")];
const OCR_RESULTS: JobResults = {
  ocr: buildOcrResultMeta({
    engine: "ocrmypdf",
    languages: ["eng"],
    outputMode: "searchable-pdf",
    producedSearchablePdf: true,
    producedTextSidecar: false,
  }),
};

async function workbook(pages: readonly string[], sheetPerPage: boolean) {
  const run = await runPdfOfficeExport(
    "pdf-to-excel",
    PDF,
    { extract: played(pages) },
    undefined,
    { sheetPerPage },
  );
  if (!run.ok) throw new Error(`${run.kind}: ${run.message}`);
  return run.output;
}

describe("sheetPerPageVerdict — one sheet per page, a blank page, the number cells", () => {
  it("POSITIVE: the engine's workbook of the three pages", async () => {
    const v = await sheetPerPageVerdict(await workbook(NUMBER_PAGES, true));
    expect(v.detail).toMatch(/^sheets Page 1-3/);
    expect(v.ok).toBe(true);
  });

  it("NEGATIVE: the old image — the option ignored, one 'Extracted text' sheet", async () => {
    const v = await sheetPerPageVerdict(await workbook(NUMBER_PAGES, false));
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(
      /\["Extracted text"\], expected \["Page 1","Page 2","Page 3"\]/,
    );
    expect(v.detail).toMatch(/Page 1 carries page 3's "Closing" row/);
  });

  it("NEGATIVE: a blank page dropped — page 3's rows land on the second sheet", async () => {
    const v = await sheetPerPageVerdict(
      await workbook([NUMBER_PAGES[0]!, NUMBER_PAGES[2]!], true),
    );
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/the blank page's sheet holds/);
  });

  it("HEALTH: a download that is not an XLSX fails", async () => {
    const v = await sheetPerPageVerdict(new TextEncoder().encode("PK nope"));
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/not a readable XLSX/);
  });
});

describe("ocrSheetPerPageVerdict — OCR on + one sheet per page", () => {
  it("POSITIVE: OCR's words, one page per sheet, with OCR's block", async () => {
    const v = await ocrSheetPerPageVerdict(
      await workbook(SCAN_PAGES, true),
      OCR_RESULTS,
    );
    expect(v.ok).toBe(true);
  });

  it("NEGATIVE: no OCR block — the record of a job that never recognised anything", async () => {
    const v = await ocrSheetPerPageVerdict(
      await workbook(SCAN_PAGES, true),
      {},
    );
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/OCR did not run/);
  });

  it("NEGATIVE: one sheet with both pages (the option ignored)", async () => {
    const v = await ocrSheetPerPageVerdict(
      await workbook(SCAN_PAGES, false),
      OCR_RESULTS,
    );
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/Page 1 carries page 2's word/);
  });

  it("NEGATIVE: the pages swapped", async () => {
    const v = await ocrSheetPerPageVerdict(
      await workbook([...SCAN_PAGES].reverse(), true),
      OCR_RESULTS,
    );
    expect(v.ok).toBe(false);
  });
});

describe("the malformed bag — refused before OCR first", () => {
  const ocrCalls = vi.fn();
  /** An OCR processor that would refuse the locked proof input. */
  const ocr: Processor = {
    id: "ocr",
    tools: ["ocr-pdf"],
    supports: () => true,
    capability: () => ({
      id: "ocr",
      tools: ["ocr-pdf"],
      ready: true,
      detail: "",
    }),
    process: async () => {
      ocrCalls();
      return {
        ok: false,
        error: {
          code: "unprocessable_entity",
          message: OCR_REFUSAL_MESSAGES.encrypted,
          retryable: false,
        },
      };
    },
  };
  const processor = createPdfOfficeExportProcessor(
    { extract: played(NUMBER_PAGES), extractFlow: vi.fn(), scanPages: vi.fn() },
    { ocr },
  );
  const job = async (options: Record<string, unknown>) => {
    const r = await processor.process({
      tool: "pdf-to-excel",
      options,
      inputs: [
        {
          fileId: "f",
          filename: "locked.pdf",
          contentType: "application/pdf",
          bytes: PDF,
        },
      ],
    });
    if (r.ok) throw new Error("the job completed");
    return { status: "failed", error: r.error };
  };

  it("POSITIVE: the bag is refused with the parser's sentence, and OCR is never asked", async () => {
    ocrCalls.mockClear();
    const refused = await job({ ...MALFORMED_BAG_OPTIONS });
    expect(matchesExpectedFailure(refused, MALFORMED_BAG_FAILURE)).toBe(true);
    expect(ocrCalls).not.toHaveBeenCalled();
  });

  it("NEGATIVE: OCR first — the job ends on OCR's refusal of the locked file", async () => {
    ocrCalls.mockClear();
    // The same input with a well-formed bag reaches OCR, and the record
    // shows it: this is what a worker that ran OCR before parsing returns.
    const reachedOcr = await job({ ocr: true, languages: ["eng"] });
    expect(ocrCalls).toHaveBeenCalledTimes(1);
    expect(matchesExpectedFailure(reachedOcr, MALFORMED_BAG_FAILURE)).toBe(
      false,
    );
    expect(
      matchesExpectedFailure({ status: "completed" }, MALFORMED_BAG_FAILURE),
    ).toBe(false);
  });
});
