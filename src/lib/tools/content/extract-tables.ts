import type { ToolContent } from "./types";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { WORKER_FILE_CEILING } from "@/lib/tools/file-ceilings";
import { tableExtractOutputName } from "@/lib/workers/processor/table-extract";

/*
 * Behaviour claims below were read from the implementation on 2026-09-27:
 *  - src/components/tools/table-extract-worker-panel.tsx — one PDF per run,
 *    the "Add your PDF, or browse" drop zone with the "Selectable PDF" hint,
 *    the "Extract tables" button ("Extracting tables…" while busy), the
 *    "Download <file>" button; the badge reads "Checking…", "Status unknown",
 *    "Not enabled" or "Secure worker", and only "Secure worker" shows a runner;
 *  - src/lib/workers/pdf-text/parse.ts parseBboxLayout — every item is ONE
 *    word box from pdftotext -bbox-layout;
 *  - src/lib/workers/table-extract/engine.ts detectTablesOnPage — the WHOLE
 *    page is one grid: every word on it is clustered into rows by vertical
 *    position and columns by its LEFT edge, so titles and footnotes become
 *    rows, each word of a multi-word cell usually becomes its own column, two
 *    tables on one page merge into one grid, and a page with prose fails the
 *    fill test (>= half the cells filled, two rows and two columns with >= 2
 *    filled cells). These were checked by feeding synthetic word layouts
 *    through detectTablesOnPage itself, not by a production job. No merged
 *    cells, no cross-page stitching. Output: ZIP of table-N.csv (RFC-4180, no
 *    BOM) plus tables.xlsx with sheets "Table N (pP)", every cell inlineStr;
 *    failures: no selectable text (points at OCR PDF), no table found, too
 *    large;
 *  - src/lib/workers/processor/table-extract.ts — the "-tables.zip" name;
 *  - src/lib/workers/pdf-office-export/engine.ts rows()/xlsx() — PDF to Excel
 *    for the comparison FAQ: every text line into one sheet, split at tabs,
 *    runs of 2+ spaces or commas, XLSX only; empty pieces are dropped.
 *
 * Re-checked 2026-09-27 (adversarial pass): detectTablesOnPage was run on
 * synthetic word layouts — "1,250.00" stays one cell (pdftotext splits words
 * at spaces, not commas); "Quarterly results" as a heading became a row AND
 * opened an extra column; "12 March 2024" filled three columns; right-aligned
 * numbers of different widths landed in different columns; empty grid cells
 * are written as "". The size refusal is at POST /api/uploads, which
 * runSecurityJob calls with the declared byte count before any upload, i.e.
 * when Extract tables is pressed. runSecurityJob downloads the artifact
 * before reporting success, so the Download button saves bytes the page
 * already holds; only the server-side link expires. NOT verified: a real
 * production job, or that the running worker image carries this engine
 * (rule 5 — merging is not shipping for the worker).
 */

/** The per-file cap a worker-tier upload is refused above, in whole MB. */
const CEILING_MB = Math.round(WORKER_FILE_CEILING / (1024 * 1024));
const LINK_MINUTES = DEFAULT_RETENTION.outputTtlMinutes;
/** The download name the worker gives a file called report.pdf. */
const EXAMPLE_ZIP = tableExtractOutputName("report.pdf", "zip");

const content: ToolContent = {
  slug: "extract-tables",

  seoTitle: "Extract Tables from PDF to Excel and CSV",

  metaDescription:
    "Turns each grid-like page of a text-based PDF into its own CSV file and Excel sheet, placing words by position on the page. Scanned PDFs need OCR PDF first.",

  intro: [
    "Copying a table out of a PDF usually pastes as one long column, or as rows glued together with spaces. Extract Tables reads the position of every word on a page, puts words that sit on the same line into one row and words whose left edges line up into one column, and keeps the page only if the result looks like a grid: at least two rows and two columns with two or more filled cells each, and at least half of all cells filled.",
    "The whole page is treated as a single grid, so a heading or footnote becomes an extra row, its words can open extra columns, and two tables on one page come out as one. It works best on pages that hold little besides the table.",
    `Word positions come from the native pdftotext engine, so your PDF is uploaded over TLS to pdf.xyz's secure worker rather than read in the browser. The input is deleted when the job finishes, the link the ZIP is served from expires after ${LINK_MINUTES} minutes, and a daily storage rule erases the stored copy once that link has lapsed. A PDF above ${CEILING_MB} MB is refused before any of it is uploaded, and each run takes one PDF.`,
  ],

  useCases: [
    {
      title: "Grids of figures exported from software",
      body: "Results tables, timetables and lab logs exported by software put one number or code in each cell at fixed positions, which is the layout the detector handles most cleanly.",
    },
    {
      title: "Getting a table into pandas, R or a database",
      body: "Each detected grid is saved as its own RFC-4180 CSV file, so a script can read table-1.csv directly instead of parsing an Excel workbook.",
    },
    {
      title: "Long reports with one table per page",
      body: "A multi-page appendix yields one numbered CSV and one sheet per qualifying page, and each sheet name carries the page number, so every result can be traced back to where it came from.",
    },
  ],

  steps: [
    {
      title: "Add the PDF",
      body: "Drop one PDF onto the area that reads Add your PDF, or browse, or click browse to pick it. As its Selectable PDF hint says, the file needs real text rather than a scanned image. The area appears only while the status badge reads Secure worker, and a Remove button beside the chosen file's name clears a wrong pick.",
    },
    {
      title: "Press Extract tables",
      body: `Table detection takes no options, so this button is the only control. Pressing it first asks for an upload slot, and a file over ${CEILING_MB} MB is refused then, with nothing sent. Anything smaller goes over TLS to the secure worker while the label reads Extracting tables…, which stays until the ZIP has come back to your browser. A scan with no text, or a file where no page forms a grid, shows an error beneath the button in place of a result.`,
    },
    {
      title: "Download the ZIP",
      body: `The button under the ready message reads Download followed by the output name, so report.pdf comes back as ${EXAMPLE_ZIP}. Your browser fetched the ZIP before showing that button, so clicking it writes the file to disk without another trip to the server. Inside are table-1.csv, table-2.csv and so on, plus tables.xlsx with sheets named like Table 1 (p3).`,
    },
    {
      title: "Check each sheet against its page",
      body: "Compare each sheet with the page named in its tab, delete rows that came from headings or notes, and rejoin words split across columns.",
    },
  ],

  faqs: [
    {
      q: "How is this different from PDF to Excel?",
      a: "PDF to Excel returns a single XLSX with every line of text in one sheet, cut into cells at tabs, commas and gaps of two or more spaces, so a multi-word description stays in one cell but 1,250.00 splits in two and a blank field shifts later values left. Extract Tables places each word by position, so 1,250.00 stays whole and an empty cell stays empty, but a description spreads over several columns; it also skips pages that do not form a grid and gives each qualifying page its own sheet and CSV.",
    },
    {
      q: "Can it read tables in a scanned PDF?",
      a: "No. A scan is a picture of a page with no words to position, so a fully scanned file stops with a message telling you to run OCR PDF first. Add a text layer there, then bring the searchable PDF back. In a file that mixes scanned and text pages, the scanned pages simply produce nothing.",
    },
    {
      q: "Why are words from one cell spread over several columns?",
      a: "Columns are built from the left edge of each individual word. The month in a date written as day, month and year, or the second word of a product name, starts at its own position, so it usually opens a column of its own. Right-aligned numbers of different lengths can split the same way, and merged header cells are not reconstructed.",
    },
    {
      q: "Why did a page with an obvious table return nothing?",
      a: "Every word on the page goes into the grid, not just the table. Paragraphs, address blocks and long captions add many sparsely filled rows and columns, and once fewer than half of all cells hold text the page is rejected. If no page in the file passes, the job ends with the message that no table-like structure was detected.",
    },
    {
      q: "What happens to a table that runs over several pages?",
      a: "Each page is analysed on its own, so a table spanning three pages comes out as up to three CSV files and three sheets, one for each page that passes the grid test, and a header row the PDF repeats on each page is repeated in each sheet too. Stack the sheets and delete the repeats to rebuild it.",
    },
    {
      q: "Why does Excel treat my numbers as text?",
      a: "Every cell in tables.xlsx is stored as a text string, so currency symbols, thousands separators and leading zeros survive, but nothing can be summed until you convert it, for example with Excel's Convert to Number. The CSV files have no byte-order mark, so if accented characters look wrong after a double-click, open them through Excel's text import.",
    },
  ],

  relatedGuides: ["how-to-make-a-scanned-pdf-searchable"],
};

export default content;
