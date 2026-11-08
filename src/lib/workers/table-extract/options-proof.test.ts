// @vitest-environment node
// @native-canvas
/**
 * The wave-3 Extract Tables deployment verdicts (`./options-proof`), each
 * held to a HEALTH check, a POSITIVE control from the real engine over the
 * very fixture the deployment proof sends, and a NEGATIVE control that is the
 * image before the feature: `ocr` ignored, `combine` ignored, no
 * `results.tables`, `unprocessable_entity` for no tables, amounts as text.
 *
 * No poppler on a Windows dev box (Git ships Xpdf), so the layout here is
 * pdf.js's words (`pdfjsLayout`); the deployment proof is the run on the
 * worker's poppler, and the OCR cases' positive control runs the engine over
 * the TYPED pages — what a perfect OCR text layer would hold.
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { JobResults } from "@/lib/jobs/results";
import { buildOcrResultMeta } from "@/lib/jobs/ocr";
import { OFFICE_EXPORT_ERROR_CODES } from "@/lib/jobs/office-export-results";
import { matchesExpectedFailure } from "@/lib/probes/proof-outcome";
import { letterPdf } from "@/tests/pdf-office-fixtures";
import {
  numberCellsPdf,
  pdfjsLayout,
  repeatedHeaderPdf,
  scannedTablePdf,
  typedScanPages,
} from "@/tests/table-proof-fixtures";
import {
  createTableExtractProcessor,
  TABLE_OCR_MESSAGES,
} from "../processor/table-extract";
import { buildTablesZip, runTableExtract } from "./engine";
import {
  combinedHeaderVerdict,
  defaultsVerdict,
  NO_TABLES_FAILURE,
  ocrCombinedVerdict,
  ocrPerTableVerdict,
  OCR_TABLE_ROWS,
  parseCsvGrid,
  SCAN_WITHOUT_OCR_FAILURE,
  STATEMENT_BRANCHES,
  STATEMENT_PAGE_1,
  STATEMENT_PAGE_2,
} from "./options-proof";

const deps = { extractLayout: pdfjsLayout };
const OCR_RESULTS: JobResults = {
  ocr: buildOcrResultMeta({
    engine: "ocrmypdf",
    languages: ["eng"],
    outputMode: "searchable-pdf",
    producedSearchablePdf: true,
    producedTextSidecar: false,
  }),
};

/** The ZIP and record the real engine makes of `pdf`, as the processor files them. */
async function engineRun(
  pdf: Uint8Array,
  combine: boolean,
  extra: JobResults = {},
): Promise<{ zip: Uint8Array; results: JobResults }> {
  const run = await runTableExtract(pdf, deps, undefined, { combine });
  if (!run.ok) throw new Error(`${run.kind}: ${run.message}`);
  return { zip: run.output, results: { ...extra, tables: run.findings } };
}

/** A ZIP of the given files, for shapes the engine no longer writes. */
async function zipOf(files: Record<string, string | Uint8Array>) {
  const zip = new JSZip();
  for (const [name, body] of Object.entries(files)) zip.file(name, body);
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

describe("the fixtures", () => {
  it("HEALTH: the scan is two pages with no selectable text, small enough to upload quickly", async () => {
    const scan = await scannedTablePdf();
    const layout = await pdfjsLayout(scan);
    expect(layout.pageCount).toBe(2);
    expect(layout.pages.flatMap((p) => p.items)).toEqual([]);
    expect(scan.byteLength).toBeLessThan(1_000_000);
    // …and its typed twin, OCR's stand-in, does carry the words.
    const typed = await pdfjsLayout(await typedScanPages());
    expect(typed.pages[0]!.items.map((i) => i.text)).toContain("Cheese");
  });

  it("the CSV reader: BOM dropped, quotes and embedded commas kept, CRLF", () => {
    const bom = String.fromCharCode(0xfeff);
    expect(parseCsvGrid(`${bom}a,"b,c"\r\n"say ""hi""",\r\n`)).toEqual([
      ["a", "b,c"],
      ['say "hi"', ""],
    ]);
    expect(parseCsvGrid("")).toEqual([]);
  });
});

describe("ocrCombinedVerdict — OCR on + Combine", () => {
  it("POSITIVE: the engine's combined ZIP of the scan's text, with OCR's block", async () => {
    const { zip, results } = await engineRun(
      await typedScanPages(),
      true,
      OCR_RESULTS,
    );
    const v = await ocrCombinedVerdict(zip, results);
    expect(v.detail).toMatch(/^OCR \(eng\)/);
    expect(v.ok).toBe(true);
  });

  it("NEGATIVE: the old image's layout — combine ignored", async () => {
    const { zip } = await engineRun(await typedScanPages(), false);
    const v = await ocrCombinedVerdict(zip, {});
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/expected \["tables.csv","tables.xlsx"\]/);
  });

  it("NEGATIVE: combined, but OCR never ran (a text PDF would look like this)", async () => {
    const { zip, results } = await engineRun(await typedScanPages(), true);
    const v = await ocrCombinedVerdict(zip, results);
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/OCR did not run/);
  });

  it("HEALTH: an empty ZIP, a non-ZIP, and a right-named ZIP with no rows all fail", async () => {
    expect((await ocrCombinedVerdict(await zipOf({}), OCR_RESULTS)).ok).toBe(
      false,
    );
    expect(
      (
        await ocrCombinedVerdict(
          new TextEncoder().encode("%PDF-1.7"),
          OCR_RESULTS,
        )
      ).ok,
    ).toBe(false);
    const { zip, results } = await engineRun(
      await typedScanPages(),
      true,
      OCR_RESULTS,
    );
    const loaded = await JSZip.loadAsync(zip);
    loaded.file("tables.csv", "");
    const hollow = new Uint8Array(
      await loaded.generateAsync({ type: "uint8array" }),
    );
    const v = await ocrCombinedVerdict(hollow, results);
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/tables.csv is empty/);
  });
});

describe("ocrPerTableVerdict — OCR on, Combine off, a page with no table", () => {
  it("POSITIVE: one table, from page 1 of 2, with OCR's block", async () => {
    const { zip, results } = await engineRun(
      await typedScanPages(),
      false,
      OCR_RESULTS,
    );
    const v = await ocrPerTableVerdict(zip, results);
    expect(v.detail).toMatch(/page 2 none/);
    expect(v.ok).toBe(true);
  });

  it("NEGATIVE: no tables block (the old image's record) and no OCR block", async () => {
    const { zip } = await engineRun(await typedScanPages(), false);
    const v = await ocrPerTableVerdict(zip, {});
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/no OCR block/);
    expect(v.detail).toMatch(/no tables block/);
  });

  it("NEGATIVE: a merged cell (OCR read two cells as one) is a missing row", async () => {
    const merged = OCR_TABLE_ROWS.map((r, i) =>
      i === 2 ? [`${r[0]} ${r[1]}`, r[2]!] : [...r],
    );
    const zip = await buildTablesZip([{ pageNumber: 1, rows: merged }]);
    const v = await ocrPerTableVerdict(zip, {
      ...OCR_RESULTS,
      tables: {
        tableCount: 1,
        pageCount: 2,
        tablePages: [1],
        tablePagesTruncated: false,
        combined: false,
      },
    });
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/lacks the scanned row/);
  });
});

describe("combinedHeaderVerdict — Combine on the five-page statement", () => {
  it("POSITIVE: the engine joins pages 1 and 2 and keeps page 4 apart", async () => {
    const { zip, results } = await engineRun(await repeatedHeaderPdf(), true);
    const v = await combinedHeaderVerdict(zip, results);
    expect(v.detail).toMatch(/pages 1, 2, 4 of 5/);
    expect(v.ok).toBe(true);
  });

  it("NEGATIVE: the old image — a CSV and a sheet per table, no tables block", async () => {
    const { zip } = await engineRun(await repeatedHeaderPdf(), false);
    const v = await combinedHeaderVerdict(zip, {});
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/table-1.csv/);
  });

  it("NEGATIVE: combined but NOT joined — the repeated header stays in", async () => {
    // The real writer, with page 2's table filed two pages on: not joined.
    const zip = await buildTablesZip(
      [
        { pageNumber: 1, rows: STATEMENT_PAGE_1.map((r) => [...r]) },
        { pageNumber: 3, rows: STATEMENT_PAGE_2.map((r) => [...r]) },
        { pageNumber: 4, rows: STATEMENT_BRANCHES.map((r) => [...r]) },
      ],
      { combine: true },
    );
    const v = await combinedHeaderVerdict(zip, {
      tables: {
        tableCount: 3,
        pageCount: 5,
        tablePages: [1, 2, 4],
        tablePagesTruncated: false,
        combined: true,
      },
    });
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/row 6: \["Ref","Payee","Paid"\]/);
  });

  it("NEGATIVE: the right ZIP under a record with the wrong pages", async () => {
    const { zip, results } = await engineRun(await repeatedHeaderPdf(), true);
    const v = await combinedHeaderVerdict(zip, {
      tables: { ...results.tables!, tablePages: [1, 3] },
    });
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(/tables on pages \[1,3\]/);
  });
});

describe("defaultsVerdict — defaults on the number-cells PDF", () => {
  it("POSITIVE: two tables on pages 1 and 3, every cell typed", async () => {
    const { zip, results } = await engineRun(await numberCellsPdf(), false);
    const v = await defaultsVerdict(zip, results);
    expect(v.detail).toMatch(/pages 1, 3/);
    expect(v.ok).toBe(true);
  });

  it("NEGATIVE: the old image — the same ZIP with amounts as text and no tables block", async () => {
    const { zip } = await engineRun(await numberCellsPdf(), false);
    const loaded = await JSZip.loadAsync(zip);
    const book = await JSZip.loadAsync(
      await loaded.file("tables.xlsx")!.async("uint8array"),
    );
    // Every typed cell rewritten as the inline string its CSV holds.
    const csv = parseCsvGrid(await loaded.file("table-1.csv")!.async("string"));
    const sheet = csv
      .map(
        (row, r) =>
          `<row r="${r + 1}">${row
            .map(
              (text, c) =>
                `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${text.replace(/&/g, "&amp;")}</t></is></c>`,
            )
            .join("")}</row>`,
      )
      .join("");
    book.file(
      "xl/worksheets/sheet1.xml",
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`,
    );
    loaded.file(
      "tables.xlsx",
      await book.generateAsync({ type: "uint8array" }),
    );
    const old = new Uint8Array(
      await loaded.generateAsync({ type: "uint8array" }),
    );
    const v = await defaultsVerdict(old, {});
    expect(v.ok).toBe(false);
    expect(v.detail).toMatch(
      /Lakh: text "₹1,25,000.00", expected number "125000.00"/,
    );
  });

  it("NEGATIVE: Combine's layout is not the defaults' layout", async () => {
    const { zip, results } = await engineRun(await numberCellsPdf(), true);
    expect((await defaultsVerdict(zip, results)).ok).toBe(false);
  });
});

describe("the expected refusals", () => {
  const processor = createTableExtractProcessor(deps);
  const job = async (
    bytes: Uint8Array,
    options: Record<string, unknown> = {},
  ) => {
    const r = await processor.process({
      tool: "extract-tables",
      options,
      inputs: [
        {
          fileId: "f",
          filename: "a.pdf",
          contentType: "application/pdf",
          bytes,
        },
      ],
    });
    if (r.ok) throw new Error("the job completed");
    return { status: "failed", error: r.error };
  };

  it("NO_TABLES: the processor's refusal of prose matches; the old code does not", async () => {
    const refused = await job(await letterPdf());
    expect(matchesExpectedFailure(refused, NO_TABLES_FAILURE)).toBe(true);
    expect(
      matchesExpectedFailure(
        {
          ...refused,
          error: { ...refused.error, code: "unprocessable_entity" },
        },
        NO_TABLES_FAILURE,
      ),
    ).toBe(false);
    expect(
      matchesExpectedFailure({ status: "completed" }, NO_TABLES_FAILURE),
    ).toBe(false);
  });

  it("SCAN_WITHOUT_OCR: the scan with OCR off matches; the after-OCR copy does not", async () => {
    const refused = await job(await scannedTablePdf());
    expect(refused.error.code).toBe(OFFICE_EXPORT_ERROR_CODES.noText);
    expect(matchesExpectedFailure(refused, SCAN_WITHOUT_OCR_FAILURE)).toBe(
      true,
    );
    expect(
      matchesExpectedFailure(
        {
          ...refused,
          error: { ...refused.error, message: TABLE_OCR_MESSAGES.noText },
        },
        SCAN_WITHOUT_OCR_FAILURE,
      ),
    ).toBe(false);
  });
});
