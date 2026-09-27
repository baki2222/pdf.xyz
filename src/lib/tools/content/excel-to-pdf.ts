import type { ToolContent } from "./types";
import { getToolBySlug } from "@/lib/tools";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { WORKER_FILE_CEILING } from "@/lib/tools/file-ceilings";
import { officePdfOutputName } from "@/lib/workers/processor/office-conversion";
import { resolveNativeOfficeConversionConfig } from "@/lib/workers/office-conversion/native-config";

/*
 * Behaviour claims below were read from the code on 2026-09-27:
 *  - panel: src/components/tools/office-conversion-worker-panel.tsx — ONE file
 *    (`multiple={false}`) through a drop zone titled "Add your document, or"
 *    + "browse", a "Remove" button to clear it, a "Convert to PDF" button
 *    ("Converting PDF…" while busy), then "Your PDF is ready." and a
 *    "Download <name>" button. No layout options, no sheet picker, no password
 *    field. The uploader is mounted only when the badge reads "Secure worker".
 *  - download: runSecurityJob (pdf-security-client.ts) fetches the artifact
 *    BEFORE reporting success, and the Download button saves those in-memory
 *    bytes (`downloadBytes`). So the outputTtlMinutes expiry is the worker copy's
 *    link, not the button's; step 3 says exactly that.
 *  - type refusal: the picker's `accept` (acceptFor in the panel) offers only
 *    .xls/.xlsx/.csv; a dragged file bypasses that, and declaredContentTypeFor
 *    (mime-by-format.ts) returns null for .xlsm/.ods/.numbers, so runSecurityJob
 *    refuses those on Convert to PDF, before /api/uploads is called. Other
 *    catalogue formats are refused by /api/uploads before any bytes move.
 *  - formulas: the page says only that the PDF is a static printout of what
 *    cells display. Whether LibreOffice uses cached values or recalculates on
 *    load has NOT been checked by a real job, so no sentence depends on it.
 *  - engine: src/lib/workers/office-conversion/{engine,native}.ts —
 *    `soffice --headless --convert-to pdf` with NO filter or page-setup
 *    options. Output must pass `looksLikePdf`, which checks a `%PDF-` header
 *    and a `%%EOF` marker ONLY — it cannot tell a blank or partial rendering
 *    from a good one, so the page claims the check, not "a complete PDF".
 *  - failures: a LibreOffice error or timeout is `internal_error`,
 *    retryable, and the executor REQUEUES it (dispatchFailure) until
 *    maxAttempts — it does not fail on the first attempt. The browser stops
 *    polling after DEFAULT_MAX_POLL_ATTEMPTS and says so. too_large is
 *    non-retryable and checked before conversion.
 *  - converter input cap and timeout: native-config.ts defaults, overridable on
 *    the worker (PDFXYZ_OFFICE_CONVERSION_MAX_INPUT_BYTES / _TIMEOUT_MS); the
 *    production env was not read, so both are stated as defaults. The cap is
 *    enforced by engine.ts AFTER upload (too_large, non-retryable).
 *  - output name: processor/office-conversion.ts `officePdfOutputName`.
 *  - retention: src/app/privacy/page.tsx ("typically survive a few hours").
 *
 * NOT stated, because no real job has checked it: whether every sheet is
 * exported, whether print areas are honoured, how charts render, what an
 * encrypted workbook does on the worker, and which CSV delimiter/encoding is
 * assumed (the CSV use case says the page has no such option, which is true).
 * The worker proof harness only asserts that an XLSX and a CSV come back as
 * a PDF.
 */

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
const CEILING_MB = Math.round(WORKER_FILE_CEILING / MB);
const CONVERTER_DEFAULT_MB = Math.round(officeDefaults.maxInputBytes / MB);
const TIMEOUT_DEFAULT_SECONDS = Math.round(officeDefaults.timeoutMs / 1000);
const LINK_MINUTES = DEFAULT_RETENTION.outputTtlMinutes;
const EXAMPLE_IN = "Q3 budget.xlsx";
const EXAMPLE_OUT = officePdfOutputName(EXAMPLE_IN);

/**
 * Only describe a second, lower gate when the default actually is lower. The
 * worker can override the default (PDFXYZ_OFFICE_CONVERSION_MAX_INPUT_BYTES),
 * so the copy says "by default" and never presents it as the live figure.
 */
const converterCap =
  CONVERTER_DEFAULT_MB < CEILING_MB
    ? ` The LibreOffice converter has a lower input cap of its own, ${CONVERTER_DEFAULT_MB} MB unless the worker is configured otherwise; a bigger file is still uploaded, then turned away with a size error before any conversion starts, so nothing half-rendered comes back.`
    : "";

const content: ToolContent = {
  slug: "excel-to-pdf",

  seoTitle: `Excel to PDF Converter: ${formatsAnd} to PDF`,

  metaDescription: `Convert one ${formatsOr} spreadsheet to PDF with LibreOffice on a secure worker. The workbook is deleted when the job ends; the PDF link lasts ${LINK_MINUTES} min.`,

  intro: [
    `Excel to PDF turns one spreadsheet into a PDF that anyone can open, print or file without owning Excel. Add one ${formatsOr} file, press Convert to PDF, and LibreOffice, the open-source office suite, opens it on pdf.xyz's secure worker and exports it with its own PDF writer. Output that lacks a PDF's opening signature or end-of-file marker is discarded, and the panel shows an error instead of a download.`,
    `This page has no layout controls: pdf.xyz hands LibreOffice your file and no conversion settings at all, so orientation, scaling and where wide columns break across pages are left to whatever page setup the workbook carries and to LibreOffice's defaults. A CSV carries no page setup, so it always gets the defaults. If a wide sheet has to fit, the file is the only place to say so: set orientation and fit-to-width scaling in your spreadsheet app and save before you upload. The result is a printout, not a working spreadsheet: a formula cell shows the figure it displayed when LibreOffice opened the file, and nothing in the PDF recalculates if the source numbers change later.`,
    `None of the conversion happens on your computer. The spreadsheet travels over TLS to pdf.xyz's secure worker, is kept only for its job (through an automatic retry, if a temporary error triggers one), and is deleted as soon as that job ends, whether it succeeded or failed. The converted PDF stays downloadable from the worker for ${LINK_MINUTES} minutes, and this page fetches it the moment it is ready; after that window, a storage rule that runs once a day erases the stored PDF.`,
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
      body: "Bank, CRM and analytics exports arrive as raw delimited text. Converting paginates them with plain default formatting, since a CSV stores none. There is no delimiter or character-set option, so check the columns split as expected.",
    },
    {
      title: "Try an old .xls from a colleague",
      body: "Legacy Excel 97–2003 .xls workbooks go through the same LibreOffice conversion as .xlsx, so you do not need Excel on this machine to get a PDF of an archived file.",
    },
  ],

  steps: [
    {
      title: "Add your spreadsheet",
      body: `Click the dashed area marked "Add your document, or browse" to pick one ${formatsOr} file, or drag the file onto it. Its name then appears in place of that area, and Remove clears it if you chose the wrong one. The area is shown only while the panel's badge says "Secure worker".`,
    },
    {
      title: "Start the conversion",
      body: `With the file in place, go straight to Convert to PDF; nothing needs setting beforehand. The button reads "Converting PDF…" while the spreadsheet uploads, LibreOffice renders it and the finished PDF comes back.`,
    },
    {
      title: "Save the converted PDF",
      body: `By the time "Your PDF is ready." appears the PDF is already in this tab, and the Download button saves it under your spreadsheet's name, so ${EXAMPLE_IN} comes back as ${EXAMPLE_OUT}. Saving uses the copy held in this tab, not the worker's, whose own download address stops answering ${LINK_MINUTES} minutes after the job.`,
    },
  ],

  faqs: [
    {
      q: "Can I choose which sheets end up in the PDF?",
      a: "Not here: the whole workbook goes to LibreOffice with no sheet picker. To send one sheet, copy it into a new workbook and convert that.",
    },
    {
      q: "Why are my columns split across pages, or the text tiny?",
      a: "The converter gets your file and no layout settings. In Excel or LibreOffice Calc, set landscape and fit-all-columns-on-one-page scaling, save, and convert again. A CSV cannot store page setup, so save it as .xlsx first.",
    },
    {
      q: "What happens to formulas and macros?",
      a: `Formulas are not carried into the PDF as formulas; each cell is printed as the result it shows. This tool takes only ${formatsAnd}, so a macro-enabled .xlsm is not accepted: the file picker is set to offer only those types, and an .xlsm dragged onto the panel is refused when you press Convert to PDF, before anything uploads. Save a copy as .xlsx and convert that.`,
    },
    {
      q: "Can it convert a password-protected workbook?",
      a: "This page never passes a password to LibreOffice, so it offers no way to open a workbook that asks for one. Clear the open password in your spreadsheet app, save a copy, and convert the copy.",
    },
    {
      q: "How large can the file be, and what if it fails?",
      a: `The upload itself is turned away above ${CEILING_MB} MB per file.${converterCap} If LibreOffice errors, or runs past its time limit (${TIMEOUT_DEFAULT_SECONDS} seconds by default), the worker retries a limited number of times and returns no file if all attempts fail. If the page stops waiting, it says so, and Convert to PDF starts a fresh job.`,
    },
    {
      q: "Is my spreadsheet stored?",
      a: `Only for the job. The workbook itself is removed from the worker at the end of the job, whether it converted or not. The PDF made from it has a ${LINK_MINUTES}-minute download window, and because the storage rule that erases it runs daily, the stored PDF typically survives a few hours past that.`,
    },
  ],

  relatedGuides: [],
};

export default content;
