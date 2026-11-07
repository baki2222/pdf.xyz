/**
 * PDF to Excel's "One sheet per page" (audit pdf-to-excel#3, 2026-11-08),
 * read back from the .xlsx a user downloads, through a reader that shares
 * nothing with the writer. Until then every page went into one sheet with no
 * boundary between pages.
 */
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { XLSX_SHEET_NAME } from "@/lib/jobs/pdf-office-export";
import {
  pageSheetName,
  SHEET_PER_PAGE_HINT,
  SHEET_PER_PAGE_LABEL,
} from "@/lib/jobs/pdf-to-excel-options";
import pdfToExcelContent from "@/lib/tools/content/pdf-to-excel";
import { readXlsxSheet } from "../ooxml/sheet-read";
import { createPdfOfficeExportProcessor } from "../processor/pdf-office-export";
import { runPdfOfficeExport, type PdfTextExtractor } from "./engine";

const PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n",
);
const extract: PdfTextExtractor = vi.fn(async () => ({
  pageCount: 3,
  pages: [
    { pageNumber: 1, text: "Name     Amount\nAlice    10", characterCount: 20 },
    { pageNumber: 2, text: "", characterCount: 0 },
    { pageNumber: 3, text: "Bob      1,250.00", characterCount: 17 },
  ],
  text: "Name     Amount\nAlice    10\n\n\nBob      1,250.00",
  characterCount: 37,
  hasText: true,
}));

async function sheetNames(xlsx: Uint8Array): Promise<string[]> {
  const book = await (
    await JSZip.loadAsync(xlsx)
  )
    .file("xl/workbook.xml")!
    .async("string");
  return [...book.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]!);
}
const values = (sheet: Awaited<ReturnType<typeof readXlsxSheet>>) =>
  sheet.rows.map((r) => r.cells.map((c) => c.value));

describe("PDF to Excel — one sheet per page", () => {
  it("HEALTH: off, the same PDF is the one sheet, every page in it", async () => {
    const run = await runPdfOfficeExport("pdf-to-excel", PDF, { extract });
    if (!run.ok) throw new Error(run.kind);
    expect(await sheetNames(run.output)).toEqual([XLSX_SHEET_NAME]);
    expect(values(await readXlsxSheet(run.output))).toEqual([
      ["Name", "Amount"],
      ["Alice", "10"],
      ["Bob", "1250.00"],
    ]);
  });

  it("on, each page is its own sheet, named by its page, an empty page an empty sheet", async () => {
    const run = await runPdfOfficeExport(
      "pdf-to-excel",
      PDF,
      { extract },
      undefined,
      { sheetPerPage: true },
    );
    if (!run.ok) throw new Error(run.kind);
    expect(await sheetNames(run.output)).toEqual([1, 2, 3].map(pageSheetName));
    expect(values(await readXlsxSheet(run.output))).toEqual([
      ["Name", "Amount"],
      ["Alice", "10"],
    ]);
    expect(
      values(await readXlsxSheet(run.output, "xl/worksheets/sheet2.xml")),
    ).toEqual([]);
    const third = await readXlsxSheet(run.output, "xl/worksheets/sheet3.xml");
    expect(third.rows[0]!.cells[1]).toMatchObject({
      type: "number",
      value: "1250.00",
    });
  });

  it("the processor reads the option off the job, and refuses a non-boolean", async () => {
    const processor = createPdfOfficeExportProcessor({
      extract,
      extractFlow: vi.fn(),
      scanPages: vi.fn(),
    });
    const job = (options: Record<string, unknown>) =>
      processor.process({
        tool: "pdf-to-excel",
        options,
        inputs: [
          {
            fileId: "f",
            filename: "r.pdf",
            contentType: "application/pdf",
            bytes: PDF,
          },
        ],
      });
    const on = await job({ sheetPerPage: true });
    if (!on.ok) throw new Error(on.error.message);
    expect(await sheetNames(on.artifacts[0]!.bytes)).toHaveLength(3);
    const off = await job({});
    if (!off.ok) throw new Error(off.error.message);
    expect(await sheetNames(off.artifacts[0]!.bytes)).toEqual([
      XLSX_SHEET_NAME,
    ]);
    const bad = await job({ sheetPerPage: 1 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("invalid_request");
  });

  it("the page names the option and its sheets from the same constants", () => {
    const page = JSON.stringify(pdfToExcelContent);
    expect(page).toContain(SHEET_PER_PAGE_LABEL);
    expect(page).toContain(pageSheetName(1));
    expect(SHEET_PER_PAGE_HINT).toContain(pageSheetName(2));
  });
});
