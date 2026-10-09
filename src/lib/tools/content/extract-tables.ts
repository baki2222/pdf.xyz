import type { ToolContent } from "./types";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { XLSX_NUMBER_EXAMPLES } from "@/lib/jobs/pdf-office-export";
import { getToolBySlug } from "@/lib/tools";
import { toolFileCeilingMb } from "@/lib/tools/file-ceilings";
import { MAX_SIGNIFICANT_DIGITS } from "@/lib/workers/ooxml/sheet-cells";
import { LONG_CELL_WORDS } from "@/lib/workers/pdf-text/flow";
import { tableExtractOutputName } from "@/lib/workers/processor/table-extract";

/*
 * Behaviour claims below were read from the implementation on 2026-09-27,
 * and RE-READ on 2026-10-06 after the engine was rewritten under this page:
 *  - src/components/tools/table-extract-worker-panel.tsx — one PDF per run,
 *    the "Add your PDF, or browse" drop zone with the "Selectable PDF" hint,
 *    the "Extract tables" button, the "Download <file>" button; the badge
 *    reads "Checking…", "Status unknown", "Not enabled" or "Secure worker",
 *    and only "Secure worker" shows a runner. The Dropzone's `refuse` runs
 *    `pickRefusal`, so a file over the tool's ceiling is refused WHEN PICKED
 *    and the button never enables; the busy label is `jobBusyLabel(phase,
 *    "Extracting tables…")` — "Uploading your file…", "Waiting for the
 *    worker…", "Extracting tables…", "Downloading the result…";
 *  - src/lib/workers/table-extract/engine.ts detectTablesOnPage (rewritten
 *    2026-09-27) — words joined into phrases (one cell each), columns from
 *    white-space gutters, a page cut into regions at large gaps and at
 *    one-phrase rows that are not cells (titles, captions, paragraph lines),
 *    each region its own table if `isTableGrid` passes it: two columns
 *    filled in 2+ rows, a column of values under LONG_CELL_WORDS words that
 *    is not mostly list items, no sentence wrapping between rows. Its known
 *    limits: side-by-side tables merge, a wrapped first-column cell ends its
 *    table, a centred note under a table can become its last row. Output:
 *    ZIP of table-N.csv (RFC-4180, no BOM) plus tables.xlsx with a sheet
 *    "Table N (pP)" per TABLE, cells through the shared writer
 *    (`../ooxml/sheet-cells`: numbers as numbers);
 *  - src/lib/workers/processor/table-extract.ts — the "-tables.zip" name.
 *
 * The claims are RUN by `worker-tool-answers.test.ts` ("no table page
 * describes the replaced comma split, text-only cells or whole-page grid")
 * against poppler's real words for a report page. HISTORY, kept: until
 * 2026-10-06 this page described the engine of before 2026-09-27 — the whole
 * page one grid built from word LEFT EDGES, kept when half its cells were
 * filled, at most one table per page, every cell text — and placed the size
 * refusal at the button press, before `pickRefusal` was wired. NOT verified
 * here: a real production job.
 */

const tool = getToolBySlug("extract-tables");
if (!tool) throw new Error("extract-tables content has no catalogue tool");
/** The figure the pick refusal quotes: `toolFileCeilingMb`, in whole MB. */
const CEILING_MB = toolFileCeilingMb(tool);
if (CEILING_MB === null)
  throw new Error(
    "extract-tables content states a file ceiling it cannot find",
  );
const LINK_MINUTES = DEFAULT_RETENTION.outputTtlMinutes;
/** The download name the worker gives a file called report.pdf. */
const EXAMPLE_ZIP = tableExtractOutputName("report.pdf", "zip");

const content: ToolContent = {
  slug: "extract-tables",

  seoTitle: "Extract Tables from PDF to Excel and CSV",

  metaDescription:
    "Extract tables from a text-based PDF to CSV and Excel: each table found, even several on one page, gets its own CSV and sheet. Scanned PDFs need OCR PDF first.",

  intro: [
    `Copying a table out of a PDF usually pastes as one long column, or as rows glued together with spaces. Extract Tables reads the position of every word on a page, puts words on the same line into one row, joins words set a normal space apart into one cell, and finds columns from the white-space gutters that run down the rows. It keeps a block as a table only when at least two columns each hold something in two or more rows, one column holds short values of fewer than ${LONG_CELL_WORDS} words each (and is not mostly bullet items), and no sentence wraps from one row into the next.`,
    "Titles, captions, paragraph lines and footnotes end a table rather than joining it, so a page can yield several tables, each saved as its own CSV and sheet. A one-line subheading set in a table's first column also ends it, so a sectioned table can come back as several. Three layouts still trip it up: two tables side by side on the same rows come out as one wide table, a cell that wraps in the first column ends its table, and a centred one-line note directly under a table can be taken as its last row.",
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
      body: "A multi-page appendix yields one numbered CSV and one sheet per table found, and each sheet name carries the page number, so every result can be traced back to where it came from.",
    },
  ],

  steps: [
    {
      title: "Add the PDF",
      body: "Drop one PDF onto the area that reads Add your PDF, or browse, or click browse to pick it. As its Selectable PDF hint says, the file needs real text rather than a scanned image. The area appears only while the status badge reads Secure worker, and a Remove button beside the chosen file's name clears a wrong pick.",
    },
    {
      title: "Press Extract tables",
      body: `Table detection takes no options, so this button is the only control. A file over ${CEILING_MB} MB is refused as soon as you pick it, before anything is read or sent. While the job runs, the button reads Uploading your file…, Waiting for the worker…, Extracting tables… and Downloading the result… in turn, and it stays busy until the ZIP has come back to your browser. A scan with no text, or a file in which no table is detected, shows an error beneath the button in place of a result.`,
    },
    {
      title: "Download the ZIP",
      body: `The button under the ready message reads Download followed by the output name, so report.pdf comes back as ${EXAMPLE_ZIP}. Your browser fetched the ZIP before showing that button, so clicking it writes the file to disk without another trip to the server. Inside are table-1.csv, table-2.csv and so on, plus tables.xlsx with sheets named like Table 1 (p3).`,
    },
    {
      title: "Check each sheet against its page",
      body: "Compare each sheet with the page named in its tab. Check that a note printed directly under a table was not taken as its last row, that a cell wrapping in the first column did not end its table early, and that two tables side by side were not read as one wide table.",
    },
  ],

  faqs: [
    {
      q: "How is this different from PDF to Excel?",
      a: "PDF to Excel returns a single XLSX with every line of the PDF's text in one sheet, each value placed in the column its position puts it in, so it suits getting all of the text into a grid. Extract Tables looks only for table-shaped blocks, leaves out the titles, captions and prose around them, and gives each table it finds its own sheet and CSV file. Both keep 1,250.00 whole and leave an empty cell empty.",
    },
    {
      q: "What if only some pages of my PDF are scans?",
      a: "The pages with text are read as usual, and the scanned pages simply produce nothing. A file with no text on any page stops with a message telling you to run OCR PDF first; add a text layer there, then bring the searchable PDF back.",
    },
    {
      q: "Why did two columns come out as one?",
      a: "Columns are found from the white space that runs down the rows. When a long cell in some row fills the gap between two columns, there is no gap left and those two columns are read as one for that table. A heading spanning two columns over the rows beneath it is allowed for. Two tables side by side on the same rows also read as one wide table. Multi-word cells such as North America or 12 March 2024 stay in one cell, right-aligned amounts stay in one column, and merged header cells are not reconstructed.",
    },
    {
      q: "Why did a page with an obvious table return nothing?",
      a: `A block counts as a table only when at least two columns each hold something in two or more rows, one column holds short values of fewer than ${LONG_CELL_WORDS} words each (and is not mostly bullet items), and no sentence wraps from one row into the next. Two columns of prose, side-by-side bulleted lists and letterhead lines fail those tests on purpose. A table in which every column holds longer text can fail them too, as can one cut into single rows by one-line subheadings. If nothing in the file passes, the job ends with the message that no table-like structure was detected.`,
    },
    {
      q: "What happens to a table that runs over several pages?",
      a: "Each page is analysed on its own, so a table spanning three pages comes out as separate CSV files and sheets, at least one for each page whose part of it is detected as a table, and a header row the PDF repeats on each page is repeated in each sheet too. Stack the sheets and delete the repeats to rebuild it.",
    },
    {
      q: "Does Excel see my numbers as numbers?",
      a: `Yes, when a cell holds exactly one number. Values such as ${XLSX_NUMBER_EXAMPLES.join(", ")} or -4 are stored in tables.xlsx as numbers with a matching format, so they can be summed straight away. A code with a leading zero such as 00123, a number of more than ${MAX_SIGNIFICANT_DIGITS} significant digits, a European 1.250,00, a date or a bracketed negative stays text exactly as printed. The CSV files have no byte-order mark, so if accented characters look wrong after a double-click, open them through Excel's text import.`,
    },
  ],

  relatedGuides: ["how-to-make-a-scanned-pdf-searchable"],
};

export default content;
