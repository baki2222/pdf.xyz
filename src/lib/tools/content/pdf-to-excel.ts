import type { ToolContent } from "./types";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { WORKER_FILE_CEILING } from "@/lib/tools/file-ceilings";

/*
 * Behaviour claims below were read from the implementation on 2026-09-27 and
 * probed by running `runPdfOfficeExport("pdf-to-excel", …)` with a stub
 * extractor fed through the real `parseLayoutText`, then unzipping the XLSX:
 *  - src/components/tools/pdf-office-export-worker-panel.tsx — the "Add your
 *    PDF, or" drop zone with its "browse" link (one file, "Remove" to clear
 *    it), the "Export XLSX" button that reads "Exporting XLSX…" while busy,
 *    "Your XLSX file is ready." and "Download <name>" on success. The Download
 *    button saves bytes the page already fetched (`runSecurityJob` downloads
 *    the artifact BEFORE reporting success), so the button itself does not
 *    expire; only the server-side link does;
 *  - src/lib/workers/pdf-text/native.ts — text comes from poppler `pdftotext
 *    -layout`, padding KEPT for office export;
 *  - src/lib/pdf/text.ts joinPageTexts + engine.ts `lines()` — pages are
 *    joined and blank lines dropped, so no empty row separates pages; each
 *    line's indentation is trimmed; a page with no text adds no rows;
 *  - src/lib/workers/pdf-office-export/engine.ts `rows()` / `xlsx()` — every
 *    non-empty line is one row, split on a tab, a run of 2+ spaces, OR A
 *    COMMA (a single space never splits); empty pieces are dropped (probe:
 *    "Smith" + blank Amount + "12/03/2026" put the date under "Amount");
 *    every cell is an inline string; one sheet named "Extracted text"; column
 *    letters clamp at Z (probe: cells 26–28 of one row all written as "Z5").
 *    Probe output: "Doe, Jane   1,250.00" → "Doe" | "Jane" | "1" | "250.00".
 *    IF `rows()` CHANGES, the comma, empty-cell and column-Z sentences in the
 *    intro and FAQs below go stale with it.
 *  - src/lib/workers/processor/pdf-office-export.ts — exactly one input; the
 *    output keeps the PDF's name with its extension replaced by .xlsx; no text
 *    → "This PDF has no selectable text to export. Run OCR first, …".
 *  - Unlock PDF (catalog) needs the password that already opens the file.
 *  - src/lib/workers/table-extract/engine.ts (RE-READ 2026-09-27, not carried
 *    over): detectTablesOnPage clusters ALL of a page's positioned words into
 *    one grid and keeps it only if it is mostly filled, so it yields at most
 *    one table per page and a page mixing prose with a table can be dropped or
 *    get the prose inside the grid. The copy therefore does NOT say "prefer it
 *    when tables sit among prose" (an earlier draft did). Output is a ZIP of
 *    table-N.csv files plus tables.xlsx; its columnRef() goes past Z.
 *  - The size refusal happens when Export is pressed: runSecurityJob declares
 *    the byte count to POST /api/uploads, which validation.ts refuses above
 *    JOB_LIMITS.maxFileBytes before any upload. The Dropzone itself checks no
 *    size, so the copy does not place the refusal at the moment of picking.
 *
 * ⚠️ MEASURED 2026-09-27 IN MICROSOFT EXCEL 16.0 (Windows, COM
 * Workbooks.Open), not inferred: engine output with rows of 3 and of 26 cells
 * opened (sheet "Extracted text", values typed String); the same engine's
 * output with ONE row of 27 or of 30 cells was refused outright — the WHOLE
 * workbook, not just the row — because the clamp writes two or more <c r="Z…">
 * cells in one row. The copy says a single over-wide line makes Excel refuse
 * the file. No other spreadsheet app was tested and the copy does not claim
 * one. EXIT CONDITION (the property, not the mechanism): remove that sentence
 * when an engine-produced workbook containing a line with more than 26 cells
 * opens in real Excel — changing the clamp is the mechanism, not the proof.
 */

/** The per-file cap a worker-tier upload is refused above, in whole MB. */
const CEILING_MB = Math.round(WORKER_FILE_CEILING / (1024 * 1024));
const OUTPUT_TTL = DEFAULT_RETENTION.outputTtlMinutes;

const content: ToolContent = {
  slug: "pdf-to-excel",

  seoTitle: "PDF to Excel: Convert PDF Text Lines to XLSX",

  metaDescription:
    "Export the text layer of a PDF to an XLSX sheet: one row per line, new cells at tabs, commas and wide gaps. A secure worker converts it, then deletes your PDF.",

  intro: [
    `PDF to Excel reads the selectable text of one PDF and writes it into a single worksheet, named "Extracted text", inside an XLSX workbook. The text is pulled with poppler's pdftotext in layout mode, which pads each line with spaces so a printed table row keeps gaps between its columns. Each non-empty line becomes one spreadsheet row, cut into cells wherever it has a tab, a comma, or a run of two or more spaces; a single space never starts a new cell. Pages follow one another with no blank row between them, so page headers, footers and page numbers printed as text end up among the data rows.`,
    `This is line splitting, not table detection. Ruling lines and cell borders are ignored, merged cells are not rebuilt, and every value is stored as text. The comma rule cuts both ways: comma-separated values split neatly, but an amount printed as 1,250.00 becomes two cells, and so does "Doe, Jane". For PDFs that hold real grids, Extract Tables places words by their position on the page instead of by the characters between them.`,
    `Poppler is a native program that a browser cannot run, so the export happens on pdf.xyz's secure worker and each run takes one PDF of at most ${CEILING_MB} MB, sent over TLS. The worker deletes your PDF when the export job finishes. Your workbook can be fetched from its link for ${OUTPUT_TTL} minutes, and once that link has expired a daily storage rule erases the stored XLSX.`,
  ],

  useCases: [
    {
      title: "Recovering a CSV that was printed to PDF",
      body: "Lines of comma-separated values come back as columns you can sort and filter. A value that itself contains a comma, such as a quoted address, is split too.",
    },
    {
      title: "Pulling a spaced-out listing into rows",
      body: "Parts lists, timetables and directories laid out with wide gaps between columns convert line for line, so you filter rows instead of retyping them. Money columns with thousands separators suit Extract Tables better.",
    },
    {
      title: "Taking a scanned sheet through OCR first",
      body: "A photographed or scanned page has no text to export. Run it through OCR PDF with the language the page is written in, choose a searchable PDF as the result, and bring that file here.",
    },
  ],

  steps: [
    {
      title: "Pick the PDF to convert",
      body: `While the worker is unavailable the panel offers "Notify me when this ships" in place of a drop box; once the badge reads "Secure worker", the box is there. Drag a PDF onto the box that reads "Add your PDF, or", or click browse in it. The chosen file's name replaces the box, with a Remove button beside it for undoing a wrong pick.`,
    },
    {
      title: "Press Export XLSX",
      body: `A PDF larger than ${CEILING_MB} MB is turned away at this point, before its bytes leave your device. Otherwise it is uploaded and the button reads "Exporting XLSX…" until the finished XLSX is sitting in the page, downloaded from the worker. A PDF with no selectable text stops here, with an error under the button asking you to run OCR first.`,
    },
    {
      title: "Save the workbook",
      body: 'When "Your XLSX file is ready." appears, press the button under it that starts with Download and ends with the file name: your PDF\'s name, with .xlsx in place of .pdf. The workbook is already held by the page, so the button saves it straight to your device.',
    },
    {
      title: "Tidy the sheet",
      body: "Convert number columns from text before summing, delete rows that came from page headers and footers, and check any row that had a blank field.",
    },
  ],

  faqs: [
    {
      q: "Will my table's rows and columns line up?",
      a: "Only when every row has a value in every column. A blank cell is not written as an empty cell, so the values after it move one column left and land under the wrong heading. A cell whose text wraps onto a second printed line gives you two rows, and two columns printed one space apart stay in a single cell.",
    },
    {
      q: "Why does SUM return zero on my numbers?",
      a: "Every cell is written as text, figures and dates included, so the spreadsheet treats them as labels until you convert the column to numbers.",
    },
    {
      q: "How is this different from Extract Tables?",
      a: "PDF to Excel converts every line and splits it at gaps and commas, with no idea where a table starts. Extract Tables lays each page's words into a grid by their position, skips any page whose grid is mostly empty, and hands back a ZIP holding a CSV per table and one workbook with a sheet for each. Because it goes by position, 1,250.00 stays in one cell and a blank field stays blank. It finds at most one table per page, so a page that mixes a table with paragraphs may be skipped or have the paragraphs in the grid.",
    },
    {
      q: "Does it work on scanned PDFs or password-protected files?",
      a: "A fully scanned PDF holds only pictures of its pages, so the job is refused with a message that there is no selectable text; run OCR PDF first. If only some pages are scans, the export succeeds and those pages add no rows, with nothing marking the gap. An open-password PDF fails with a general export error that does not mention the password, since this page has no password field; take it through Unlock PDF, which asks for that password, and convert the copy it returns.",
    },
    {
      q: "Are formatting, formulas and very wide rows kept?",
      a: "Fonts, colours, borders, images and cell sizes are not carried over, and a PDF holds no formulas to recover. Columns stop at Z: when one line splits into more cells than there are letters from A to Z, the extra cells are all written to column Z of that row, and desktop Microsoft Excel then refuses to open the whole workbook, not just that row. Lines of prose with many commas can trip this as easily as a wide table.",
    },
    {
      q: "Who holds my PDF and the workbook, and until when?",
      a: `Your PDF reaches pdf.xyz's secure worker over TLS and is deleted as soon as the export job is over. The link the XLSX is served from lasts ${OUTPUT_TTL} minutes; once it lapses, a daily storage rule clears the workbook from storage.`,
    },
  ],

  relatedGuides: ["how-to-make-a-scanned-pdf-searchable"],
};

export default content;
