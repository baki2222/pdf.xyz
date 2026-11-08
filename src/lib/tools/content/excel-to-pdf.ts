import type { ToolContent } from "./types";
import { getToolBySlug } from "@/lib/tools";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { toolFileCeiling } from "@/lib/tools/file-ceilings";
import { officePdfOutputName } from "@/lib/workers/processor/office-conversion";
import { resolveNativeOfficeConversionConfig } from "@/lib/workers/office-conversion/native-config";
import {
  DOCUMENT_WORDS,
  EXCEL_TO_PDF_TOOL,
  ODF_PASSWORD_REMOVAL,
} from "@/lib/workers/office-conversion/engine";
import {
  FIT_COLUMNS_TO_WIDTH_LABEL,
  ONE_PAGE_PER_SHEET_LABEL,
  ORIENTATION_CHOICE_WORDS,
  ORIENTATION_LABEL,
} from "@/lib/workers/office-conversion/sheet-layout";

/*
 * Behaviour claims below were read from the code on 2026-09-27:
 *  - panel: src/components/tools/office-conversion-worker-panel.tsx — ONE file
 *    (`multiple={false}`) through a drop zone titled "Add your workbook, or"
 *    + "browse", a "Remove" button to clear it, a "Convert to PDF" button
 *    (busy label below), then "Your PDF is ready." and a
 *    "Download <name>" button. Layout options since 2026-11-08 (audit
 *    excel-to-pdf#1, office-conversion/sheet-layout.ts), Excel's page only:
 *    the "Put each sheet on one page" checkbox (LibreOffice's
 *    SinglePageSheets), and, for an .xlsx only and hidden while that box is
 *    ticked, an "Orientation" select and a "Fit all columns on the page
 *    width" checkbox, which the worker writes into each worksheet's page
 *    setup before LibreOffice opens it (office-conversion/xlsx-page-setup.ts,
 *    proven on the production image 2026-11-07: 40 columns by 400 rows went
 *    from 32 A4 pages with the last column on 8, to 4 A4 landscape pages
 *    with it on all 4). No sheet picker, no password field. The uploader is mounted only when the badge reads "Secure worker".
 *  - download: runSecurityJob (pdf-security-client.ts) fetches the artifact
 *    BEFORE reporting success, and the Download button saves those in-memory
 *    bytes (`downloadBytes`). So the outputTtlMinutes expiry is the worker copy's
 *    link, not the button's; step 3 says exactly that.
 *  - type refusal: the picker's `accept` (acceptFor in the panel) offers only
 *    .xls/.xlsx/.csv/.ods (.ods since 2026-11-04, when the engine began
 *    taking it; an .ods must also carry the OpenDocument spreadsheet
 *    `mimetype`, `input-content.ts`, or it is refused before LibreOffice);
 *    a dragged file bypasses that, but the Dropzone's
 *    `refuse` runs `pickRefusal` → `toolTakesFile`, which refuses .xlsm
 *    at the drop ("isn't a file Excel to PDF takes"), before it is read —
 *    probed 2026-10-07 with an empty and with the real macro-enabled MIME
 *    type. The FAQ said "refused when you press Convert to PDF" until then.
 *  - formulas: the page says only that the PDF is a static printout of what
 *    cells display. Whether LibreOffice uses cached values or recalculates on
 *    load has NOT been checked by a real job, so no sentence depends on it.
 *  - engine: src/lib/workers/office-conversion/{engine,native}.ts —
 *    `soffice --headless --convert-to pdf` with NO filter or page-setup
 *    options, unless the checkbox is ticked: then the target is
 *    `pdf:calc_pdf_Export:{"SinglePageSheets":...true}` (native.ts
 *    `pdfConvertTarget`), LibreOffice's "Whole sheet export", whose
 *    documented behaviour (paper size and print ranges ignored, hidden
 *    sheets included, one page per sheet sized to fit) is what the page says. Output must pass `looksLikePdf`, which checks a `%PDF-` header
 *    and a `%%EOF` marker ONLY — it cannot tell a blank or partial rendering
 *    from a good one, so the page claims the check, not "a complete PDF".
 *  - failures: WAS (until a02c6a98 in code, 2026-10-07 on this page) "a
 *    LibreOffice error or timeout is `internal_error`, retryable, and the
 *    executor REQUEUES it". Now engine.ts maps a timeout to `timeout`, a bad
 *    exit / no output / output failing `looksLikePdf` to `unreadable`, and an
 *    encrypted OOXML package to `password_protected`, and
 *    processor/office-conversion.ts `jobError` makes all three
 *    `unprocessable_entity`, retryable:false — they fail once. Only `failed`
 *    (not a LibreOfficeRunError: spawn/IO error, an unrequested kill) stays a
 *    retryable `internal_error`. When the browser stops polling,
 *    `WorkerJobStatus` shows a still-running note with Keep waiting, which
 *    resumes the SAME job (it used to say Convert to PDF "starts a fresh
 *    job", which uploads again). too_large is non-retryable.
 *  - busy label: `jobBusyLabel(job.phase, "Converting to PDF…")` — Uploading
 *    your file…, Waiting for the worker…, Converting to PDF…, Downloading the
 *    result…, with a Cancel button below while busy. Step 2 said "Converting
 *    PDF…" for the whole round trip until 2026-10-07.
 *  - size: ONE figure, `toolFileCeiling` — the smaller of the upload gate and
 *    the converter's input cap (OFFICE_CONVERSION_DEFAULT_MAX_INPUT_BYTES;
 *    PDFXYZ_OFFICE_CONVERSION_MAX_INPUT_BYTES can only RAISE the engine's cap,
 *    `Math.max(env, default)`, and nothing in front of the engine lets a
 *    bigger file through). It is enforced at the pick (`pickRefusal`, before
 *    the file is read), by runSecurityJob before any request, and by
 *    /api/uploads (`workerFileCeilingBytes`); engine.ts's too_large is the
 *    last of four. This bullet said "enforced by engine.ts AFTER upload"
 *    until 2026-10-07, and the FAQ "a bigger one is still uploaded". Until
 *    2026-09-27 this FAQ stated the gate as "the upload itself is turned
 *    away above" beside the cap, and the derived FAQ answered "Up to 100 MB", which was false.
 *  - timeout: native-config.ts default (_TIMEOUT_MS), stated as a default.
 *  - output name: processor/office-conversion.ts `officePdfOutputName`.
 *  - retention: src/app/privacy/page.tsx ("typically survive a few hours").
 *
 * NOT stated, because no real job has checked it: whether every sheet is
 * exported, whether print areas are honoured, how charts render, what an
 * encrypted workbook does on the worker, and which CSV delimiter is assumed
 * (the CSV use case says the page has no such option, which is true).
 *
 * The CSV ENCODING is stated, since 2026-11-07: a CSV whose bytes are UTF-8
 * is imported as UTF-8 and any other is left to LibreOffice's Western
 * default (office-conversion/native.ts `csvImportFilter`). Production's
 * "excel-to-pdf (csv)" proof found UTF-8 "Zürich" printed as mojibake before
 * that; `pnpm worker:office-input-proof` now converts one CSV of each
 * encoding in the image (`src/tests/csv-charset-fixtures.ts`).
 */

/** Where Excel removes a password: the words the engine's refusal uses. */
const EXCEL_WORDS = DOCUMENT_WORDS[EXCEL_TO_PDF_TOOL];
const tool = getToolBySlug("excel-to-pdf");
const accepted = tool?.accept ?? [];

function listOf(items: readonly string[], joiner: string): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${joiner} ${items[items.length - 1]}`;
}

const MB = 1024 * 1024;
const officeDefaults = resolveNativeOfficeConversionConfig({});
const formatsAnd = listOf(accepted, "and");
const formatsOr = listOf(accepted, "or");
const CEILING = tool ? toolFileCeiling(tool) : null;
const CEILING_MB = Math.round((CEILING?.bytes ?? 0) / MB);
const TIMEOUT_DEFAULT_SECONDS = Math.round(officeDefaults.timeoutMs / 1000);
const LINK_MINUTES = DEFAULT_RETENTION.outputTtlMinutes;
const EXAMPLE_IN = "Q3 budget.xlsx";
const EXAMPLE_OUT = officePdfOutputName(EXAMPLE_IN);

/**
 * Who refuses above the ceiling. The panel's Dropzone runs `pickRefusal` →
 * `fileOverCeilingMessage` on every drop and browse pick, at the figure
 * `toolFileCeiling` states, and `/api/uploads` refuses at the same
 * `workerFileCeilingBytes`. WAS, until 2026-10-07: "unless the worker is
 * configured otherwise; a bigger one is still uploaded, then turned away" —
 * both false since 8b5a8c59/f537ab23 (refused at the pick) and since the
 * env override became `Math.max(env, default)` (it can only raise the
 * engine's cap, which no gate in front of it lets a file reach).
 */
const sizeRefusal =
  CEILING?.tier === "worker" && CEILING.engine
    ? `The LibreOffice converter takes a spreadsheet of up to ${CEILING_MB} MB. A bigger file is refused as soon as you add it, before it is read or uploaded, with a message naming that limit, and the upload service refuses it at the same figure, so nothing half-rendered ever comes back.`
    : `Files of up to ${CEILING_MB} MB are accepted.`;

const content: ToolContent = {
  slug: "excel-to-pdf",

  // Was "Excel to PDF Converter: …" until ODS made the list four long and
  // the title 53 characters, past the 50 a result shows.
  seoTitle: `Excel to PDF: Convert ${formatsAnd}`,

  metaDescription: `Convert one ${formatsOr} spreadsheet to PDF with LibreOffice on a secure server. The workbook is deleted when the job ends; the PDF link lasts ${LINK_MINUTES} min.`,

  intro: [
    `Excel to PDF turns one spreadsheet into a PDF that anyone can open, print or file without owning Excel. Add one ${formatsOr} file, press Convert to PDF, and LibreOffice, the open-source office suite, opens it on pdf.xyz's secure server and exports it with its own PDF writer. Output that lacks a PDF's opening signature or end-of-file marker is discarded, and the panel shows an error instead of a download.`,
    `Left as it is, the layout comes from the page setup the workbook carries and LibreOffice's defaults: orientation, scaling and where wide columns break across pages. A CSV carries no page setup, so it gets the defaults. For an .xlsx file you can override two of those settings: choose ${ORIENTATION_CHOICE_WORDS} under ${ORIENTATION_LABEL}, and tick ${FIT_COLUMNS_TO_WIDTH_LABEL} to scale each sheet down until every column fits across the page, with rows carrying on to further pages. Both are written into the workbook's own page setup before LibreOffice opens it; an .xls, .csv or .ods keeps the setup saved in it. Or tick ${ONE_PAGE_PER_SHEET_LABEL} and nothing is split: each sheet becomes a single page as large as its content, whatever its paper size and print area say, hidden sheets included. The result is a printout, not a working spreadsheet: a formula cell shows the figure it displayed when LibreOffice opened the file, and nothing in the PDF recalculates if the source numbers change later.`,
    `None of the conversion happens on your computer. The spreadsheet travels over TLS to pdf.xyz's secure server, is kept only for its job (through an automatic retry, if a temporary error triggers one), and is deleted as soon as that job ends, whether it succeeded or failed. The converted PDF stays downloadable from our server for ${LINK_MINUTES} minutes, and this page fetches it the moment it is ready; after that window, a storage rule that runs once a day erases the stored PDF.`,
  ],

  useCases: [
    {
      title: "Send figures to someone who does not use Excel",
      body: "A budget, quote or timesheet becomes pages that open in any PDF viewer, where nobody can overtype a cell by accident.",
    },
    {
      title: "Upload a spreadsheet where only PDF is allowed",
      body: "Grant, expense and tender portals often refuse workbook files; attach the PDF instead.",
    },
    {
      title: "Freeze a month-end report",
      body: "Later edits to the workbook do not flow into the PDF, which suits an audit folder or a board pack.",
    },
    {
      title: "Make a CSV export readable",
      body: "Bank, CRM and analytics exports arrive as raw delimited text. Converting paginates them with plain default formatting, since a CSV stores none. A CSV saved as UTF-8, with or without a byte-order mark, keeps letters such as ü and é; one saved in another encoding is read as Western European text. There is no delimiter option, so check the columns split as expected.",
    },
    {
      title: "Try an old .xls from a colleague",
      body: "Legacy Excel 97–2003 .xls workbooks go through the same LibreOffice conversion as .xlsx, so you do not need Excel on this machine to get a PDF of an archived file.",
    },
  ],

  steps: [
    {
      title: "Add your spreadsheet",
      body: `Click the dashed area marked "Add your ${EXCEL_WORDS.noun}, or browse" to pick one ${formatsOr} file, or drag the file onto it. Its name then appears in place of that area, and Remove clears it if you chose the wrong one. The area takes a file at once; Convert to PDF works only while the panel's badge says "Secure server".`,
    },
    {
      title: "Start the conversion",
      body: `With the file in place, change the layout only if you need to: for an .xlsx, pick ${ORIENTATION_CHOICE_WORDS} under ${ORIENTATION_LABEL} and tick ${FIT_COLUMNS_TO_WIDTH_LABEL} so every column fits across the page; for any spreadsheet, tick ${ONE_PAGE_PER_SHEET_LABEL} to make each sheet a single page instead. Then press Convert to PDF. The button shows where the job is: "Uploading your file…", then "Waiting for our server…" while it is queued, "Converting to PDF…" while LibreOffice renders it, and "Downloading the result…" as the finished PDF comes back. A Cancel button below it stops the job while it runs.`,
    },
    {
      title: "Save the converted PDF",
      body: `By the time "Your PDF is ready." appears the PDF is already in this tab, and the Download button saves it under your spreadsheet's name, so ${EXAMPLE_IN} comes back as ${EXAMPLE_OUT}. Saving uses the copy held in this tab, not our server's, whose own download address stops answering ${LINK_MINUTES} minutes after the job.`,
    },
  ],

  faqs: [
    {
      q: "Can I choose which sheets end up in the PDF?",
      a: "Not here: the whole workbook goes to LibreOffice with no sheet picker. To send one sheet, copy it into a new workbook and convert that.",
    },
    {
      q: "Why are my columns split across pages, or the text tiny?",
      a: `Unless you change the layout, the converter follows the page setup saved in your file. For an .xlsx, tick ${FIT_COLUMNS_TO_WIDTH_LABEL}, with Landscape under ${ORIENTATION_LABEL} if the sheet is wide: each sheet is scaled down until every column fits across the page, and rows carry on to further pages. Or tick ${ONE_PAGE_PER_SHEET_LABEL}, and each sheet comes out as one page sized to fit everything on it; a long sheet makes a long page, and print areas are ignored. A CSV, .xls or .ods cannot take the orientation or fit setting here, so save it as .xlsx first if you need them.`,
    },
    {
      q: "What happens to formulas and macros?",
      a: `Formulas are not carried into the PDF as formulas; each cell is printed as the result it shows. This tool takes only ${formatsAnd}, so a macro-enabled .xlsm is not accepted: the file picker is set to offer only those types, and an .xlsm dragged onto the panel is refused as soon as you drop it, before it is read or uploaded. Save a copy as .xlsx and convert that.`,
    },
    {
      q: "Can it convert a password-protected workbook?",
      a: `This page never passes a password to LibreOffice, so it offers no way to open a workbook that asks for one. A locked .xlsx or .ods is recognised before LibreOffice runs, and the message says where the password comes off: ${EXCEL_WORDS.app}'s ${EXCEL_WORDS.protect}, or ${ODF_PASSWORD_REMOVAL.app}'s ${ODF_PASSWORD_REMOVAL.steps}. Convert the unlocked copy.`,
    },
    {
      q: "How large can the file be, and what if it fails?",
      a: `${sizeRefusal} If LibreOffice cannot open the workbook, or the conversion runs past its time limit (${TIMEOUT_DEFAULT_SECONDS} seconds by default), the job fails once with a message saying why and returns no file. The same file would fail the same way, so it is not retried; only a temporary fault on our secure server itself is retried automatically. If the page stops waiting before the job ends, it says the job may still be running and offers Keep waiting, which goes back to that same job rather than starting a new one.`,
    },
    {
      q: "Is my spreadsheet stored?",
      a: `Only for the job. The workbook itself is removed from our server at the end of the job, whether it converted or not. The PDF made from it has a ${LINK_MINUTES}-minute download window, and because the storage rule that erases it runs daily, the stored PDF typically survives a few hours past that.`,
    },
  ],

  relatedGuides: ["how-to-convert-word-to-pdf", "how-to-convert-pdf-to-excel"],
};

export default content;
