import type { ToolContent } from "./types";
import { getToolBySlug } from "@/lib/tools";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { MAX_LISTED_PAGES } from "@/lib/jobs/office-export-results";
import { WORD_OCR_LABEL } from "@/lib/jobs/pdf-office-export";
import { describeOcrLanguage, RTL_OCR_LANGUAGES } from "@/lib/jobs/ocr";
import { toolFileCeiling } from "@/lib/tools/file-ceilings";
import {
  MAX_BILEVEL_PICTURE_SIDE,
  MAX_DOCX_PICTURES,
  MAX_PICTURE_SIDE,
} from "@/lib/workers/pdf-office-export/picture-limits";
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
 *  - CHANGED 2026-10-17, when production returned the owner's 33-page
 *    tutorial (37 pictures) as a .docx with none: engine.ts `renderWord` now
 *    also runs the page reader (page-scan.ts, `picturesOnly`), and
 *    docx-layout.ts + docx-package.ts put every raster picture it finds
 *    between the paragraphs printed above and below it (poppler's reading
 *    order is not moved), INLINE, at the size the page shows it, scaled down
 *    (aspect kept) only to fit the text area of a Word page that is the
 *    PDF's first page, or A4 portrait when that page is landscape, with an
 *    inch of margin (docx-layout.ts `docxPageOf`); a plain JPEG of at most
 *    MAX_PICTURE_SIDE px on its longer side byte for byte, others re-encoded
 *    (PNG, or JPEG for a photograph), the long side capped at that
 *    (MAX_BILEVEL_PICTURE_SIDE for a bilevel scan); an upright rectangular
 *    clip is a crop Word can undo. NOT carried: vector drawing (lines, boxes,
 *    charts), stencil masks, repeated or grouped tiles, fonts, sizes,
 *    colours, tables as tables, positions. A picture too large or
 *    undecodable is left out and named in the note, except on a page the
 *    reader cannot read ahead (`picturesUnverified`). A PDF with NO text is
 *    still refused (`no_text`); a scanned page in a PDF that has text comes
 *    through as its picture, and the note names it. A PDF the reader cannot
 *    read ahead is rebuilt first (Repair PDF's engine) or refused. Until
 *    A paragraph EVERY visible run of which is bold (italic) in the page
 *    reader's fonts is written bold (italic), docx-layout.ts
 *    `paragraphStyle`; a bold word inside a sentence is not. Until
 *    this date the page said "Fonts, bold and italics, colours and images
 *    are not carried across", "fonts, sizes, colours, images and link
 *    targets stay behind", and that image-only pages "add nothing to the
 *    DOCX": all true then, all false of this engine for pictures. The
 *    claims are held to it in claims-vs-capability.test.ts ("PDF to Word:
 *    the page says pictures are left out exactly when the .docx carries
 *    none") and docx-pictures.test.ts. They are true of a DOWNLOAD only
 *    while production runs an image carrying this engine (the worker image
 *    is published separately, and merging is not shipping); the live answer
 *    is the heartbeat's `docxPictures` (scripts/worker-daemon.ts), which runs
 *    the probe PDF's picture through the running image's own extractor and
 *    reader, and `worker:prove-tools`'s pdf-to-word verdict.
 *  - CHANGED 2026-10-24: the panel draws a “Recognise text in scans (OCR)”
 *    checkbox (WORD_OCR_LABEL) and, when on, OCR PDF's language picker
 *    (ocr-language-picker.tsx). The job then carries `{ ocr: true,
 *    languages }` (parsePdfToWordOptions in jobs/ocr.ts) and the processor
 *    runs the registry's OCR processor first — searchable-PDF output, OCR
 *    PDF's own language and refusal checks — and converts what it returns,
 *    in ONE job (processor/pdf-office-export.ts). Until then the page said
 *    "Scans need OCR first" and sent readers to OCR PDF for two passes.
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
    `pdf-to-word content states our server's upload cap, but the tool's ceiling tier is "${ceiling.tier}"`,
  );
}
/** The per-file cap this tool's upload is refused above, in whole MB. */
const CEILING_MB = Math.round(ceiling.bytes / (1024 * 1024));
const OUTPUT_TTL = DEFAULT_RETENTION.outputTtlMinutes;
/**
 * The right-to-left languages the OCR option withholds (2026-10-25; the
 * in-image proof read their words back out of a DOCX and found them out of
 * order — `PDF_TO_WORD_OCR_LANGUAGE_CODES` in jobs/ocr.ts).
 */
const RTL_WORD_SENTENCE = `${new Intl.ListFormat("en", { type: "conjunction" }).format(RTL_OCR_LANGUAGES.map(describeOcrLanguage))} are not offered for it: written right to left, their recognised words come out of the conversion out of order. OCR PDF reads them in order.`;
const PICTURE_PX = MAX_PICTURE_SIDE.toLocaleString("en-US");
const BILEVEL_PX = MAX_BILEVEL_PICTURE_SIDE.toLocaleString("en-US");
const MAX_PICTURES = MAX_DOCX_PICTURES.toLocaleString("en-US");
/** Where the note can miss a picture: a page the reader cannot read ahead. */
const UNNOTED =
  "except on a page our server cannot read before it is drawn, as in a damaged PDF, where a picture can be left out with no note";

const content: ToolContent = {
  slug: "pdf-to-word",

  seoTitle: "PDF to Word: Editable DOCX With Its Pictures",

  metaDescription: `Convert a PDF to editable Word DOCX: text as paragraphs in reading order, each picture between them at its size. OCR for scans. Up to ${CEILING_MB} MB, no account.`,

  intro: [
    `PDF to Word lifts the text you could highlight in a PDF, and the photos, screenshots and scans on its pages, into a .docx file that opens and edits in Word. It is not a page replica: lines the PDF wrapped are joined back into paragraphs in Word's default Normal style, each picture sits on a line of its own between the paragraphs printed above and below it, and each PDF page with text or a picture starts on a new Word page. The Word page is the size of the PDF's first page, or A4 upright when that page is landscape, such as a slide (scaled to fit, its shape kept, when it is larger than Word allows), and a picture wider or taller than the page's text area is scaled down to fit. Fonts, colours, tables, and drawings made of lines and shapes are not carried across, and bold or italics only where a whole paragraph is set in them, such as a heading.`,
    `The extractor follows the page's reading order: a page set in two columns is read one column at a time, and a table whose cells each fit on one line comes through one row per paragraph, with its cells separated by tabs rather than placed in Word table cells. If no page has selectable text, as with a scan that was never OCR'd, the job stops rather than hand you a document of page pictures with nothing in it to edit. Tick “${WORD_OCR_LABEL}” before exporting and our server runs OCR on the file first, in the languages you pick, and converts the result in the same job.`,
    `Conversion happens on a server, not in your browser. Your PDF travels over TLS to pdf.xyz's secure server, where poppler's pdftotext reads the text layer and pdf.js finds each picture and where the page shows it. Our server deletes the uploaded PDF when the job finishes; the DOCX link expires after ${OUTPUT_TTL} minutes, and a daily storage rule then erases the stored copy. A run handles a single PDF, and uploads above ${CEILING_MB} MB are refused.`,
  ],

  useCases: [
    {
      title: "Reuse the wording of a report or policy",
      body: "When a few pages of an existing document belong in a new one, converting saves retyping. The text arrives as paragraphs in reading order, ready to restyle in your own template.",
    },
    {
      title: "Rework a guide that is built around screenshots",
      body: "A how-to with a screenshot under each step comes through with every screenshot between its caption and the next step, so the steps can be rewritten without capturing the screens again. Arrows, boxes and labels drawn on top of a screenshot are drawn into it, so it shows what the page shows; lines and shapes elsewhere on the page do not come across.",
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
      // CHANGED 2026-10-24: was "Recover text from a scan in two passes",
      // through OCR PDF and back — the only way until OCR ran in this job.
      title: "Recover text from a scan",
      body: `A scanned contract usually arrives as page pictures with no text layer, so on its own it is refused here. Tick “${WORD_OCR_LABEL}” and pick the languages printed on it: our server adds the recognised words to each page first, then converts, so each page's scan then comes through as a picture, followed by its words as text you can edit.`,
    },
  ],

  steps: [
    {
      title: "Add one PDF",
      body: "Drop your file on the Add your PDF area or choose browse to pick it; it is sent only when you press Export DOCX, which works once the status badge reads Secure server. The page holds one PDF at a time; press Remove to swap it for another.",
    },
    {
      title: "Press Export DOCX",
      body: `A PDF larger than ${CEILING_MB} MB is refused as soon as you pick it, before anything is uploaded. Otherwise your file goes up over TLS: the button reads "Uploading your file…", then "Waiting for our server…" while the job is queued, "Exporting DOCX…" while our secure server reads its text and pictures, and "Downloading the result…" until the DOCX is in the page. Our server discards your upload once the job is done.`,
    },
    {
      title: "Download the Word file",
      body: `When "Your DOCX file is ready." appears, press the Download button beneath it, named after your file with a .docx extension. The page has already fetched the DOCX, but save it before closing the tab: our server's own link stops working after ${OUTPUT_TTL} minutes.`,
    },
  ],

  faqs: [
    {
      q: "Will the Word file look like my PDF?",
      a: "Not closely. The DOCX carries the words as plain paragraphs, with the pictures on lines of their own between them; fonts, sizes, colours, tables as tables, link targets and drawings made of lines and shapes stay behind. A paragraph set wholly in bold or italics keeps it; a bold word inside a sentence does not. The original's indentation and spacing are not kept, and a picture painted over another, or over text, comes through on its own line instead of on top. What the page paints over a picture, such as a box over a name, is drawn into that picture, so what it covers stays covered. Each PDF page with text or a picture begins on a new Word page, and running headers and page numbers come through as ordinary paragraphs.",
    },
    {
      q: "Are the pictures kept at their full quality?",
      a: `Mostly. A plain JPEG photo up to ${PICTURE_PX} pixels on its longer side goes into the DOCX byte for byte. A larger one is scaled down to ${PICTURE_PX} pixels on that side, a black-and-white scan to ${BILEVEL_PX}, and a picture that is not a plain JPEG is re-saved, as a PNG or, for a photograph, a JPEG. A one-colour stencil comes through in its colour, and a picture the page repeats comes through each time it is shown. A picture the page shows only part of is cropped in Word the same way, so the hidden part can be uncropped there, unless something is painted over the picture: then it is re-saved as the page shows it, at its own resolution, and what is covered is not in the file. A picture too large for our server, or one it cannot decode, is left out, and the note beside the download names its page, ${UNNOTED}. Past ${MAX_PICTURES} pictures, the size of one file, or the time one conversion may take, a document's remaining pictures are left out too and counted in the same note; the text still comes through whole.`,
    },
    {
      q: "What happens to pages that are scans?",
      a: `A scan has no selectable text, only a picture of its words. In a PDF that also has typed pages, a scanned page comes through as that picture, on its own Word page, with no editable words, and beside the download the panel says how many pages had text and names the ones that came through only as pictures (up to ${MAX_LISTED_PAGES}, then a count of the rest). If no page has any selectable text, the job is turned away instead, since a document of page pictures would have nothing in it to edit; lettering converted to vector outlines has the same effect. Tick “${WORD_OCR_LABEL}” to have the words as text: our server runs OCR first, keeping pages that already have text as they are, and converts its result. OCR in the wrong language does not fail, it produces plausible-looking gibberish, so choose every language printed on the page. ${RTL_WORD_SENTENCE}`,
    },
    {
      q: "How are tables and multi-column pages handled?",
      a: "In reading order. A page set in two columns is read one column at a time. A table whose cells each fit on one line comes through as one paragraph per row, with its cells separated by tabs rather than placed in Word table cells; a table whose cells wrap onto a second line is read column by column instead. For real cells, use PDF to Excel or Extract Tables; for plain words with no upload at all, PDF to Text runs in your browser.",
    },
    {
      q: "Can I turn a PDF that has an open password into Word?",
      a: "Not directly. Our server cannot read text it cannot decrypt, so the job stops at once, without retrying, with a message that says the PDF is password-protected and a link to Unlock PDF. If you know the password, remove it with Unlock PDF and convert the decrypted copy. Unlock PDF cannot recover or bypass a password you do not have. A PDF that opens without a password and only restricts editing converts as it is, pictures included. A PDF whose structure our server cannot read is rebuilt first, the way Repair PDF does, and the rebuilt copy is converted, with a note beside the download that says so; one that cannot be rebuilt into a readable file is not converted, and the message suggests Repair PDF.",
    },
    {
      q: "Is my PDF kept once the DOCX is made?",
      a: `No. Our server erases your uploaded PDF when the conversion ends. The DOCX stays retrievable for ${OUTPUT_TTL} minutes, then the link lapses and a daily storage rule wipes the leftover file. No sign-up is involved.`,
    },
  ],

  relatedGuides: [
    "how-to-convert-pdf-to-word",
    "how-to-make-a-scanned-pdf-searchable",
    "how-to-ocr-a-pdf-in-other-languages",
  ],
};

export default content;
