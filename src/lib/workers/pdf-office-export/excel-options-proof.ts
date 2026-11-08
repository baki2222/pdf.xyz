/**
 * The deployment proofs' verdicts for PDF to Excel's wave-3 behaviour
 * (2026-11-08): "One sheet per page" (audit pdf-to-excel#3), OCR first in the
 * same job (#2), the number cells (#4), and the options bag refused BEFORE
 * OCR runs. Pure — JSZip and text only — so the unit tests and
 * `scripts/worker-prove-tools.ts` ask the same question of the same function.
 *
 * The image before the feature ignored `sheetPerPage` and `ocr`: it wrote one
 * sheet, "Extracted text", and failed a scan `pdf_no_text`. Both still hand
 * back a valid XLSX or a tidy refusal, so neither verdict asks "is it an
 * XLSX": they read the sheet NAMES, which page's words are on which sheet,
 * and the cell types.
 */
import type { JobResults } from "@/lib/jobs/results";
import {
  pageSheetName,
  parsePdfToExcelOptions,
} from "@/lib/jobs/pdf-to-excel-options";
import type { ExpectedFailure } from "@/lib/probes/proof-outcome";
import { numberCellProblems } from "../ooxml/number-cells-proof";
import {
  readWorkbookSheets,
  sheetValues,
  type WorkbookSheetRead,
} from "../ooxml/workbook-read";
import {
  CLOSING_ROWS,
  NUMBER_PDF_PAGES,
  OCR_PROSE_LINES,
  OCR_SCAN_PAGES,
  OCR_TABLE_ROWS,
} from "../table-extract/options-proof";

export type Verdict = { ok: boolean; detail: string };

const words = (texts: readonly string[]) =>
  texts.flatMap((t) =>
    t
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );

async function sheetsOf(
  bytes: Uint8Array,
): Promise<WorkbookSheetRead[] | { error: string }> {
  try {
    const sheets = await readWorkbookSheets(bytes);
    return sheets.length > 0 ? sheets : { error: "the workbook has no sheets" };
  } catch (error) {
    return {
      error: `the download is not a readable XLSX: ${(error as Error).message}`,
    };
  }
}

function namesProblem(
  sheets: readonly WorkbookSheetRead[],
  pages: number,
): string | null {
  const got = sheets.map((s) => s.name);
  const want = Array.from({ length: pages }, (_, i) => pageSheetName(i + 1));
  return got.length === want.length && got.every((n, i) => n === want[i])
    ? null
    : `the workbook's sheets are ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`;
}

const verdict = (problems: string[], pass: string): Verdict =>
  problems.length === 0
    ? { ok: true, detail: pass }
    : {
        ok: false,
        detail: `${problems.length} problem(s): ${problems.slice(0, 4).join("; ")}`,
      };

/**
 * One sheet per page on the three-page number PDF (page 2 blank): sheets
 * `Page 1`, `Page 2`, `Page 3`; page 2's sheet holds no cell; page 1's
 * cells are typed as `numberCellProblems` requires; page 3's closing row is
 * on page 3's sheet and not on page 1's.
 */
export async function sheetPerPageVerdict(bytes: Uint8Array): Promise<Verdict> {
  const sheets = await sheetsOf(bytes);
  if ("error" in sheets) return { ok: false, detail: sheets.error };
  const [p1, p2, p3] = sheets;
  const closing = CLOSING_ROWS[CLOSING_ROWS.length - 1]![0]!;
  const problems = [
    ...[namesProblem(sheets, NUMBER_PDF_PAGES)].filter(
      (p): p is string => p !== null,
    ),
    ...(p1 ? numberCellProblems(p1.sheet).map((p) => `Page 1: ${p}`) : []),
    ...(p1 && sheetValues(p1.sheet).includes(closing)
      ? [`Page 1 carries page 3's "${closing}" row`]
      : []),
    ...(p2 && sheetValues(p2.sheet).length > 0
      ? [`the blank page's sheet holds ${sheetValues(p2.sheet).length} cell(s)`]
      : []),
    ...(p3 && sheetValues(p3.sheet).includes(closing)
      ? []
      : [`page 3's sheet has no "${closing}" row`]),
  ];
  return verdict(
    problems,
    `sheets Page 1-3, Page 2 empty, the closing row on Page 3; Page 1 stores the lakh, negative and date cells as numbers, the slashed date and (3) as text`,
  );
}

/**
 * OCR on + one sheet per page, on the two-page scan: sheets `Page 1` and
 * `Page 2`; every word of the scanned table on Page 1 and none of the prose
 * page's; every word of the prose on Page 2; the record says OCR ran, in
 * English. (A scan has no text layer: without OCR the job fails `no_text`.)
 */
export async function ocrSheetPerPageVerdict(
  bytes: Uint8Array,
  results: JobResults | undefined,
): Promise<Verdict> {
  const sheets = await sheetsOf(bytes);
  if ("error" in sheets) return { ok: false, detail: sheets.error };
  const tableWords = words(OCR_TABLE_ROWS.flat());
  const proseWords = words(OCR_PROSE_LINES);
  const onPage = (i: number) =>
    new Set(words(sheets[i] ? sheetValues(sheets[i]!.sheet) : []));
  const p1 = onPage(0);
  const p2 = onPage(1);
  // The prose's own words: ones the table does not also print.
  const proseOnly = proseWords.filter((w) => !tableWords.includes(w));
  const langs = results?.ocr?.languages;
  const problems = [
    ...[namesProblem(sheets, OCR_SCAN_PAGES)].filter(
      (p): p is string => p !== null,
    ),
    ...tableWords
      .filter((w) => !p1.has(w))
      .map((w) => `Page 1 lacks the scanned word "${w}"`),
    ...proseOnly
      .filter((w) => p1.has(w))
      .map((w) => `Page 1 carries page 2's word "${w}"`),
    ...proseWords
      .filter((w) => !p2.has(w))
      .map((w) => `Page 2 lacks the scanned word "${w}"`),
    ...(!langs
      ? ["the job record carries no OCR block: OCR did not run in this job"]
      : langs.length === 1 && langs[0] === "eng"
        ? []
        : [`OCR ran in ${JSON.stringify(langs)}, the job asked for ["eng"]`]),
  ];
  return verdict(
    problems,
    `OCR (eng) then sheets Page 1 and Page 2, each holding its own page's ${tableWords.length} and ${proseWords.length} recognised words`,
  );
}

/**
 * The malformed bag: OCR on, with `sheetPerPage` a number. The worker parses
 * PDF to Excel's own option BEFORE OCR first, so the job fails at once with
 * the parser's own message. The proof's input is an ENCRYPTED PDF: had OCR
 * run first, the job would fail with OCR's refusal for a locked file instead
 * — the order is visible in the record, not only in a worker log.
 */
export const MALFORMED_BAG_OPTIONS = {
  ocr: true,
  languages: ["eng"],
  sheetPerPage: 1,
} as const;

function malformedMessage(): string {
  const parsed = parsePdfToExcelOptions({ ...MALFORMED_BAG_OPTIONS });
  if (parsed.ok) throw new Error("the parser accepts the malformed bag");
  return parsed.error.body.error.message;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What the job must fail with: the parser's own sentence, exactly. */
export const MALFORMED_BAG_FAILURE: ExpectedFailure = {
  code: "invalid_request",
  retryable: false,
  message: new RegExp(`^${escape(malformedMessage())}$`),
};
