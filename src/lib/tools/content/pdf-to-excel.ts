import type { ToolContent } from "./types";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { MAX_LISTED_PAGES } from "@/lib/jobs/office-export-results";
import {
  XLSX_CELL_BREAK_PHRASE,
  XLSX_MERGE_CAVEAT,
  XLSX_NUMBER_EXAMPLES,
  XLSX_SHEET_NAME,
  XLSX_TEXT_EXAMPLE,
} from "@/lib/jobs/pdf-office-export";
import { getToolBySlug } from "@/lib/tools";
import { toolFileCeilingMb } from "@/lib/tools/file-ceilings";
import { MAX_SIGNIFICANT_DIGITS } from "@/lib/workers/ooxml/sheet-cells";

/*
 * Behaviour claims below were read from the implementation on 2026-09-27,
 * and RE-READ on 2026-10-06 after both engines this page describes were
 * rewritten under it:
 *  - src/components/tools/pdf-office-export-worker-panel.tsx — the "Add your
 *    PDF, or" drop zone with its "browse" link (one file, "Remove" to clear
 *    it); the Dropzone's `refuse` runs `pickRefusal`, so a file over the
 *    tool's ceiling is refused WHEN PICKED and Export never enables. The
 *    "Export XLSX" button's busy label is `jobBusyLabel(phase, "Exporting
 *    XLSX…")`: "Uploading your file…", "Waiting for the worker…", "Exporting
 *    XLSX…", "Downloading the result…". "Your XLSX file is ready." and
 *    "Download <name>" on success; the Download button saves bytes the page
 *    already fetched, so only the server-side link expires. A no-text
 *    failure links OCR PDF and a password failure Unlock PDF
 *    (`OfficeExportNextStep`, `ErrorNote`); a partly scanned PDF gets
 *    `OfficeExportCoverageNotice` ("Text found on X of Y pages", the pages
 *    with none, capped at MAX_LISTED_PAGES with a count of the rest).
 *  - src/lib/workers/pdf-text/native.ts — poppler `pdftotext -layout`.
 *  - src/lib/workers/pdf-office-export/layout-grid.ts (since wave-1 L03) —
 *    cells are runs split at tabs and 2+ spaces, NEVER at a comma, placed in
 *    the column they sit in, so an empty cell stays empty; its limits are
 *    XLSX_MERGE_CAVEAT. src/lib/workers/ooxml/sheet-cells.ts — an amount or
 *    a percentage is a numeric cell; dates, 1.250,00, bracketed negatives,
 *    leading-zero codes and more than MAX_SIGNIFICANT_DIGITS digits stay
 *    text; columns go past Z (columnRef).
 *  - src/lib/workers/table-extract/engine.ts — Extract Tables finds every
 *    table region on a page (several per page), for the comparison FAQ.
 *
 * The claims are RUN by `worker-tool-answers.test.ts` ("no table page
 * describes the replaced comma split, text-only cells or whole-page grid"),
 * which reads this page as served. HISTORY, kept: until 2026-10-06 this page
 * said a comma splits a cell, every value is text, a blank cell moves later
 * values left, and columns clamp at Z with Excel then refusing the workbook —
 * all true of the engine before L03 and false after it.
 *
 * MEASURED 2026-09-27 IN MICROSOFT EXCEL 16.0 (Windows, COM Workbooks.Open):
 * the clamp's duplicate Z refs made Excel refuse the WHOLE workbook. The exit
 * condition named the property — "an engine-produced workbook containing a
 * line with more than 26 cells opens in real Excel" — and it was met on
 * 2026-10-06: the engine's workbook with two 28-cell rows (refs to AB) opened
 * in Excel 16.0 through COM, sheet "Extracted text", AB1 = "h30", and the
 * amount 1,250.00 read back as a Double. The refusal sentence is gone; the
 * copy says only what the writer guarantees, and names no other app.
 */

const tool = getToolBySlug("pdf-to-excel");
if (!tool) throw new Error("pdf-to-excel content has no catalogue tool");
/** The figure the pick refusal quotes: `toolFileCeilingMb`, in whole MB. */
const CEILING_MB = toolFileCeilingMb(tool);
if (CEILING_MB === null)
  throw new Error("pdf-to-excel content states a file ceiling it cannot find");
const OUTPUT_TTL = DEFAULT_RETENTION.outputTtlMinutes;
/** "1,250.00, $4.20 or 15%" — the amounts the engine is run on. */
const AMOUNTS = `${XLSX_NUMBER_EXAMPLES.slice(0, -1).join(", ")} or ${XLSX_NUMBER_EXAMPLES[XLSX_NUMBER_EXAMPLES.length - 1]}`;

const content: ToolContent = {
  slug: "pdf-to-excel",

  seoTitle: "PDF to Excel: Convert PDF Text Lines to XLSX",

  metaDescription:
    "Export a PDF's text to an XLSX sheet: one row per line, each value in its column, amounts as numbers. A secure worker converts it, then deletes your PDF.",

  intro: [
    `PDF to Excel reads the selectable text of one PDF and writes it into a single worksheet, named "${XLSX_SHEET_NAME}", inside an XLSX workbook. The text is pulled with poppler's pdftotext in layout mode, which pads each line with spaces so a printed table row keeps gaps between its columns. Each non-empty line becomes one spreadsheet row, split into cells at ${XLSX_CELL_BREAK_PHRASE}; a single space or a comma never starts a new cell. Rows that line up are treated as one table, and each value goes in the column it sits in on the page, so an empty cell stays empty. Pages follow one another with no blank row between them, so page headers, footers and page numbers printed as text end up among the data rows.`,
    `This is layout placement, not table detection: ruling lines and cell borders are ignored and merged cells are not rebuilt. ${XLSX_MERGE_CAVEAT} An amount or a percentage such as ${AMOUNTS} is stored as a number a formula can add up, and the comma inside it never splits it; a date such as ${XLSX_TEXT_EXAMPLE}, a European-style 1.250,00, a negative in brackets and a code with leading zeros stay text. To pull individual tables out of a page, Extract Tables finds each table by where its words sit and exports it on its own.`,
    `Poppler is a native program that a browser cannot run, so the export happens on pdf.xyz's secure worker and each run takes one PDF of at most ${CEILING_MB} MB, sent over TLS. The worker deletes your PDF when the export job finishes. Your workbook can be fetched from its link for ${OUTPUT_TTL} minutes, and once that link has expired a daily storage rule erases the stored XLSX.`,
  ],

  useCases: [
    {
      title: "Getting a statement's amounts into a sheet you can total",
      body: `Amounts printed as ${AMOUNTS} arrive as numbers in the column they sat in on the page, so SUM adds them up without converting anything, and the comma in an amount never splits it.`,
    },
    {
      title: "Pulling a spaced-out listing into rows",
      body: "Parts lists, timetables and directories laid out with wide gaps between columns convert line for line, each value in the column it sits in, so you filter rows instead of retyping them.",
    },
    {
      title: "Taking a scanned sheet through OCR first",
      body: "A photographed or scanned page has no text to export. Run it through OCR PDF with the language the page is written in, choose a searchable PDF as the result, and bring that file here.",
    },
  ],

  steps: [
    {
      title: "Pick the PDF to convert",
      body: `The box is there from the start, but its Export button stays off while the worker is unavailable, and the panel offers "Notify me when this ships" instead; once the badge reads "Secure worker", the button works. Drag a PDF onto the box that reads "Add your PDF, or", or click browse in it. The chosen file's name replaces the box, with a Remove button beside it for undoing a wrong pick.`,
    },
    {
      title: "Press Export XLSX",
      body: `A PDF larger than ${CEILING_MB} MB is refused as soon as you pick it, before its bytes leave your device. Otherwise pressing Export XLSX uploads it: the button reads "Uploading your file…", then "Waiting for the worker…", "Exporting XLSX…" while the worker converts it, and "Downloading the result…" until the finished XLSX is sitting in the page. A PDF with no selectable text stops here, with an error asking you to run OCR first and a link to OCR PDF.`,
    },
    {
      title: "Save the workbook",
      body: 'When "Your XLSX file is ready." appears, press the button under it that starts with Download and ends with the file name: your PDF\'s name, with .xlsx in place of .pdf. The workbook is already held by the page, so the button saves it straight to your device.',
    },
    {
      title: "Tidy the sheet",
      body: "Check dates, codes and any other values that stayed text, delete rows that came from page headers and footers, and compare any merged columns against the PDF.",
    },
  ],

  faqs: [
    {
      q: "Will my table's rows and columns line up?",
      a: `Usually, when the rows line up on the page. Each value goes in the column it sits in, so a blank cell stays blank and the values after it stay under their own headings. A cell whose text wraps onto a second printed line gives you two rows, and two columns printed one space apart stay in a single cell. ${XLSX_MERGE_CAVEAT}`,
    },
    {
      q: "Will SUM work on my numbers?",
      a: `For amounts and percentages written like ${AMOUNTS}, yes: each is stored as a number. Dates such as ${XLSX_TEXT_EXAMPLE}, European-style 1.250,00, negatives in brackets, codes with leading zeros and numbers longer than ${MAX_SIGNIFICANT_DIGITS} significant digits stay text, so convert those columns before summing.`,
    },
    {
      q: "How is this different from Extract Tables?",
      a: "PDF to Excel puts every line of the PDF's text in one sheet and places each value in the column it sits in, so headings, paragraphs and footers come along with any tables. Extract Tables looks for tables by where the words sit, keeps only regions that read as a grid of values, and hands back a ZIP holding a CSV per table and one workbook with a sheet for each; a page can hold several tables. Choose it when you want the tables alone.",
    },
    {
      q: "Does it work on scanned PDFs or password-protected files?",
      a: `A fully scanned PDF holds only pictures of its pages, so the job is refused with a message that there is no selectable text and a link to OCR PDF. If only some pages are scans, the export succeeds, and the result says how many pages had text and names the ones that had none (up to ${MAX_LISTED_PAGES}, then a count of the rest), so you can run OCR PDF on them. A PDF that needs a password to open is refused with a message saying it is password-protected and a link to Unlock PDF, which asks for that password; convert the copy it returns.`,
    },
    {
      q: "Are formatting, formulas and very wide rows kept?",
      a: "Fonts, colours, borders, images and cell sizes are not carried over, and a PDF holds no formulas to recover; nothing in the sheet becomes a formula. Wide lines are not cut off: columns continue past Z to AA, AB and beyond.",
    },
    {
      q: "Who holds my PDF and the workbook, and until when?",
      a: `Your PDF reaches pdf.xyz's secure worker over TLS and is deleted as soon as the export job is over. The link the XLSX is served from lasts ${OUTPUT_TTL} minutes; once it lapses, a daily storage rule clears the workbook from storage.`,
    },
  ],

  relatedGuides: [
    "how-to-convert-pdf-to-excel",
    "how-to-make-a-scanned-pdf-searchable",
  ],
};

export default content;
