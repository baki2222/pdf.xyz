import type { ToolContent } from "./types";
import { getToolBySlug } from "@/lib/tools";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { MAX_LISTED_PAGES } from "@/lib/jobs/office-export-results";
import { toolFileCeiling } from "@/lib/tools/file-ceilings";
import {
  modeHasBrowserPath,
  modeUploadsFiles,
} from "@/lib/tools/processing-split";

/*
 * Behaviour claims below were read from the implementation on 2026-09-27,
 * and RE-READ on 2026-10-07 after the wave-1 L03 merge replaced the engine
 * this page described:
 *  - src/components/tools/pdf-office-export-worker-panel.tsx — the status badge
 *    ("Secure worker" when the runner is shown), the one-file "Add your PDF, or
 *    browse" drop zone with a Remove button; the Dropzone's `refuse` runs
 *    `pickRefusal`, so a file over the tool's ceiling is refused WHEN PICKED.
 *    The "Export DOCX" button's busy label is `jobBusyLabel(phase, "Exporting
 *    DOCX…")`: "Uploading your file…", "Waiting for the worker…", "Exporting
 *    DOCX…", "Downloading the result…" (busy-label-claims.test.ts holds the
 *    step to all of them). "Your DOCX file is ready." and "Download <name>";
 *    the panel has ALREADY fetched the DOCX bytes before it shows that button,
 *    so the button keeps working past the worker's link TTL until the page is
 *    closed. A password failure links Unlock PDF and a no-text failure OCR PDF
 *    (`OfficeExportNextStep`); a partly scanned PDF gets
 *    `OfficeExportCoverageNotice`, naming the pages with no text, capped at
 *    MAX_LISTED_PAGES with a count of the rest;
 *  - src/app/api/uploads/route.ts + src/app/api/jobs/route.ts — rate-limited,
 *    but no sign-in check, which is what "no account" rests on;
 *  - src/lib/workers/pdf-office-export/engine.ts — Word reads `extractFlow`
 *    (poppler `pdftotext -bbox-layout`, through ../pdf-text/flow.ts) and never
 *    `-layout`: wrapped lines are joined into paragraphs, a two-column page is
 *    read a column at a time, a run of aligned short-cell rows becomes
 *    tab-separated cells (a table whose cells wrap is read column by column),
 *    and `docxBody` writes a Word page break between pages that have text. No
 *    styles, images, tables or hyperlinks. No selectable text in the WHOLE
 *    file → `no_text`; a locked PDF → `password_protected`, whose message
 *    names Unlock PDF;
 *  - src/lib/workers/processor/pdf-office-export.ts — exactly one PDF per job,
 *    output named after the input stem with `.docx`; `no_text`,
 *    `password_protected` and `unreadable` are NOT retryable, and the run's
 *    page coverage ships as `results.officeExport`.
 * HISTORY, kept: until 2026-10-07 this page said every line becomes its own
 * paragraph, a two-column article comes out a slice of each column per line,
 * page breaks are dropped, and a locked PDF is retried and then reported with
 * a general message — all true of the engine before L03 and a02c6a98, all
 * false after. `worker-tool-answers.test.ts` ("no PDF to Word surface
 * describes the replaced line-per-paragraph engine") now runs the engine
 * against each of those claims over what this page serves.
 * Every number is interpolated.
 */

const tool = getToolBySlug("pdf-to-word");
// The copy says the PDF is uploaded AND that nothing runs in the browser, so
// ask the one definition of what a processing mode means for both halves.
if (
  !tool ||
  !modeUploadsFiles(tool.processing) ||
  modeHasBrowserPath(tool.processing)
) {
  throw new Error(
    "pdf-to-word copy promises a worker-only upload, but the catalogue mode no longer means that",
  );
}
const ceiling = toolFileCeiling(tool);
if (ceiling.tier !== "worker") {
  throw new Error(
    `pdf-to-word content states the worker's upload cap, but the tool's ceiling tier is "${ceiling.tier}"`,
  );
}
/** The per-file cap this tool's upload is refused above, in whole MB. */
const CEILING_MB = Math.round(ceiling.bytes / (1024 * 1024));
const OUTPUT_TTL = DEFAULT_RETENTION.outputTtlMinutes;

const content: ToolContent = {
  slug: "pdf-to-word",

  seoTitle: "PDF to Word: Convert PDF Text to Editable DOCX",

  metaDescription: `Convert a PDF to editable Word DOCX: selectable text becomes paragraphs in reading order, wrapped lines joined. Scans need OCR first. Up to ${CEILING_MB} MB, no account.`,

  intro: [
    `PDF to Word lifts the text you could highlight in a PDF and writes it out as a .docx file that opens and edits in Word. It is a text conversion, not a page replica: lines the PDF wrapped are joined back into paragraphs in Word's default Normal style, and each PDF page that has text starts on a new Word page. Fonts, bold and italics, colours and images are not carried across.`,
    `The extractor follows the page's reading order: a page set in two columns is read one column at a time, and a table whose cells each fit on one line comes through one row per paragraph, with its cells separated by tabs rather than placed in Word table cells. If no page has selectable text, as with a scan that was never OCR'd, the job stops and asks you to run OCR first instead of handing you an empty document.`,
    `Conversion happens on a server, not in your browser. Your PDF travels over TLS to pdf.xyz's secure worker, where poppler's pdftotext reads the text layer. The worker deletes the uploaded PDF when the job finishes; the DOCX link expires after ${OUTPUT_TTL} minutes, and a daily storage rule then erases the stored copy. A run handles a single PDF, and uploads above ${CEILING_MB} MB are refused.`,
  ],

  useCases: [
    {
      title: "Reuse the wording of a report or policy",
      body: "When a few pages of an existing document belong in a new one, converting saves retyping. The text arrives as paragraphs in reading order, ready to restyle in your own template.",
    },
    {
      title: "Correct a letter or contract you only have as a PDF",
      body: "Fix a name, a date or a clause in the DOCX, then turn the finished file back into a PDF with Word to PDF. Check the result against the original, since the converted text starts out without the original's styling.",
    },
    {
      title: "Put text under Track Changes",
      body: "Comments on a PDF sit on top of the page. Once the text is in Word, Track Changes records each edit inside the sentences, so a redline can be accepted or rejected change by change.",
    },
    {
      title: "Recover text from a scan in two passes",
      body: "A scanned contract usually arrives as page pictures with no text layer, so on its own it is refused here. Pass it through OCR PDF, which keeps each page image and adds the recognised words beneath it, and bring the OCR'd copy back: those words then convert into Word.",
    },
  ],

  steps: [
    {
      title: "Add one PDF",
      body: "Once the status badge reads Secure worker, drop your file on the Add your PDF area or choose browse to pick it. The page holds one PDF at a time; press Remove to swap it for another.",
    },
    {
      title: "Press Export DOCX",
      body: `A PDF larger than ${CEILING_MB} MB is refused as soon as you pick it, before anything is uploaded. Otherwise your file goes up over TLS: the button reads "Uploading your file…", then "Waiting for the worker…" while the job is queued, "Exporting DOCX…" while the secure worker pulls out its selectable text, and "Downloading the result…" until the DOCX is in the page. The worker discards your upload once the job is done.`,
    },
    {
      title: "Download the Word file",
      body: `When "Your DOCX file is ready." appears, press the Download button beneath it, named after your file with a .docx extension. The page has already fetched the DOCX, but save it before closing the tab: the worker's own link stops working after ${OUTPUT_TTL} minutes.`,
    },
  ],

  faqs: [
    {
      q: "Will the Word file look like my PDF?",
      a: "No. The DOCX carries the words as plain paragraphs; fonts, sizes, colours, images and link targets stay behind. The original's indentation and spacing are not kept. Each PDF page that has text begins on a new Word page, and running headers and page numbers come through as ordinary paragraphs.",
    },
    {
      q: "Why was my PDF turned away as having nothing to export?",
      a: "Because no page gave up any selectable text. Most often every page is a picture, as with a scan or a phone photo saved as PDF; lettering converted to vector outlines has the same effect. The converter refuses rather than return an empty file. If you cannot highlight a word in your viewer, add a text layer with OCR PDF, then convert that result.",
    },
    {
      q: "What if only some of my pages are scans?",
      a: `The job still succeeds as long as one page has selectable text. The image-only pages add nothing to the DOCX and nothing inside the file marks where they were, but beside the download the panel says how many pages had text and names the ones that had none (up to ${MAX_LISTED_PAGES}, then a count of the rest). Run the whole file through OCR PDF and convert again to include them.`,
    },
    {
      q: "How are tables and multi-column pages handled?",
      a: "In reading order. A page set in two columns is read one column at a time. A table whose cells each fit on one line comes through as one paragraph per row, with its cells separated by tabs rather than placed in Word table cells; a table whose cells wrap onto a second line is read column by column instead. For real cells, use PDF to Excel or Extract Tables; for plain words with no upload at all, PDF to Text runs in your browser.",
    },
    {
      q: "Can I turn a PDF that has an open password into Word?",
      a: "Not directly. The worker cannot read text it cannot decrypt, so the job stops at once, without retrying, with a message that says the PDF is password-protected and a link to Unlock PDF. If you know the password, remove it with Unlock PDF and convert the decrypted copy. Unlock PDF cannot recover or bypass a password you do not have. A PDF that opens without a password and only restricts editing converts as it is.",
    },
    {
      q: "Is my PDF kept once the DOCX is made?",
      a: `No. The worker erases your uploaded PDF when the conversion ends. The DOCX stays retrievable for ${OUTPUT_TTL} minutes, then the link lapses and a daily storage rule wipes the leftover file. No sign-up is involved.`,
    },
  ],

  relatedGuides: [
    "how-to-convert-pdf-to-word",
    "how-to-make-a-scanned-pdf-searchable",
  ],
};

export default content;
