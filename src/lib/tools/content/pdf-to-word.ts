import type { ToolContent } from "./types";
import { getToolBySlug } from "@/lib/tools";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { MAX_LISTED_PAGES } from "@/lib/jobs/office-export-results";
import { WORD_OCR_LABEL } from "@/lib/jobs/pdf-office-export";
import {
  describeOcrLanguage,
  REDO_OCR_SCOPE,
  RTL_OCR_LANGUAGES,
} from "@/lib/jobs/ocr";
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
import { workerBatchPageSentence } from "@/lib/batch/worker-copy";

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
 *    read a column at a time, a run of aligned short-cell rows becomes a
 *    table (since 2026-11-15 a Word table; see the CHANGED entry below), and
 *    the writer puts a Word page break between pages that have text. No
 *    styles part or hyperlinks. No selectable text in the WHOLE
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
 *    charts), stencil masks, repeated or grouped tiles, typefaces, tables as
 *    tables, positions. A picture too large or
 *    undecodable is left out and named in the note, except on a page the
 *    reader cannot read ahead (`picturesUnverified`). A PDF with NO text is
 *    still refused (`no_text`); a scanned page in a PDF that has text comes
 *    through as its picture, and the note names it. A PDF the reader cannot
 *    read ahead is rebuilt first (Repair PDF's engine) or refused. Until
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
 *  - CHANGED 2026-11-15 (backlog #28, slice 1): each of poppler's words is
 *    labelled with the bold, italics, size and colour of the pdf.js run the
 *    page draws it in (docx-run-style.ts; the text stays poppler's, every
 *    character), and docx-package.ts writes one run per stretch of one
 *    style. A word no run covers is written plain; a page the reader did not
 *    read (deadline, budget, picture count), a page over
 *    MAX_STYLED_PIECES_PER_PAGE words, and a page with no word matched (an
 *    OCR layer is invisible) are named in the note (`pagesWithoutFormatting`).
 *    CHANGED the same day (review round 1): a word takes a style only when
 *    a run of that ONE style holds its whole text (a word whose colour
 *    changes partway through, one drawn over another line, and OCR words
 *    under a turned watermark had been labelled by position alone), and
 *    the note names EVERY page with a word left plain — until then a page
 *    was named only when none of its words matched, so an OCR'd page with
 *    a visible Bates stamp went unnamed while the FAQ said OCR pages are.
 *    NOT carried: the typeface (no `w:rFonts`), paragraph properties, tables
 *    as tables. The engine refuses a .docx whose text read back differs from
 *    poppler's on any page (`undeliverableDocx`). Until this date a
 *    paragraph EVERY visible run of which was bold (italic) was written bold
 *    (italic), and nothing else: the page said "bold or italics only where a
 *    whole paragraph is set in them" and "fonts, sizes, colours … stay
 *    behind", both true then. The live answer is the heartbeat's
 *    `docxRunStyles`.
 *  - CHANGED 2026-11-15 (backlog #28 slice 2, tables): every table
 *    flow.ts recognises is written as a real Word table (`w:tbl`), one per
 *    grid segment (table-grid.ts; a run split by white space is two
 *    tables), each value in the column its position falls in and an empty
 *    column left as an empty cell, run styles kept, thin grey borders added
 *    (the PDF's rules are not read). STILL NOT: tables of more than 63
 *    columns, over the per-table/per-page caps, of one column, or past the
 *    size fallback (tabbed rows, counted); a lone wide-gapped line (a
 *    tabbed paragraph); wrapped-cell tables as ONE table (fragments of 2+
 *    aligned rows can become small tables); the typeface. Until this date
 *    the page said a table "comes through one row per paragraph, with its
 *    cells separated by tabs rather than placed in Word table cells",
 *    "tables as tables … are not carried across", and that a wrapped-cell
 *    table "is read column by column instead" — the first two true then,
 *    the third never wholly true (only the run holding the wrapped row is
 *    refused). The live answer is the heartbeat's `docxTables`
 *    (provesDocxTables), and the claims are held to the engine in
 *    claims-vs-capability.test.ts ("PDF to Word: the table sentences hold
 *    of the engine").
 *  - CHANGED 2026-11-15 (#28 slice 2, review round 2): the review built
 *    false Word tables (a running header, a letterhead, Bengali prose beside
 *    names, two columns of Chinese prose, sentences set beside a table) and
 *    a table whose heading did not overlap its values (REPORT_TABLES:
 *    "Staff" over an empty column). A Word table now also needs three rows
 *    and a column of figures, no column of sentences, and each heading over
 *    a value (table-grid.ts `wordTableDoubt`); the rest stay tabbed rows,
 *    counted. The page had said "each value sits in its own column" (false
 *    under a spanning heading, whose values share a cell), "a table that
 *    continues onto the next page comes through as a second table" (false
 *    for a part of fewer rows) and "more cells than one page's limit" (the
 *    real per-table cap, 10,000, is half the page's); and it left out the
 *    size fallback, which now has its own line in the note beside the
 *    download (`tablesAsTextForSize`).
 *  - CHANGED 2026-11-15 (backlog #28 slice 4, typeface by kind): each
 *    matched word in the Latin alphabet is written with `w:rFonts` (ascii,
 *    hAnsi and cs, never eastAsia) naming an Office family
 *    (pdf-office-export/typeface.ts): the PDF's own family when Windows or
 *    Office ships it, the family a metric clone was cut to match, otherwise
 *    Arial, Times New Roman or Courier New by the PDF font's class. No font
 *    is embedded. Words with a letter outside Latin, symbol and dingbat
 *    words, OCR text and unmatched words carry none. Until this date the
 *    page said "The typeface and drawings made of lines and shapes are not
 *    carried across", "without the original's typeface", and listed "the
 *    typeface" among what stays behind (and the entries above say "NOT
 *    carried: … typefaces" / "the typeface (no `w:rFonts`)"): all true
 *    then, false of this engine. Over the size limit the typefaces go
 *    first and the note says so (`typefacesDroppedForSize`). The live
 *    answer is the heartbeat's `docxTypefaces` (provesDocxTypefaces), and
 *    claims-vs-capability.test.ts holds the sentences to the engine ("PDF
 *    to Word: the typeface sentences hold of the engine", and the
 *    re-pointed rule "PDF to Word keeps the fonts").
 *  - CHANGED 2026-11-15 (review round 2 of slice 4): a family Word does
 *    not know took Arial, Times New Roman or Courier New by pdf.js's
 *    `fallbackName`, which says "sans-serif" for every font without the
 *    Serif flag or equal widths — pdfTeX's CMR10 and CMTT10 and pdf.xyz's
 *    own Geist Mono came back in Arial while the page promised "of the same
 *    kind as the PDF's (serif, sans-serif or monospaced)". The kind is now
 *    read from the family's name and what pdf.js positively marked
 *    (`docxKindOf`), and a face whose kind cannot be told takes NO font
 *    (Word's default). The page says so: "a substitute of the same kind
 *    … wherever its name or the PDF says which kind it is, and otherwise
 *    in Word's default font", and every sentence promising the kind
 *    carries its condition (claims-vs-capability.test.ts, "every PDF to
 *    Word sentence promising a font of the same kind says when").
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
    `PDF to Word lifts the text you could highlight in a PDF, and the photos, screenshots and scans on its pages, into a .docx file that opens and edits in Word. It is not a page replica: lines the PDF wrapped are joined back into paragraphs, each picture sits on a line of its own between the paragraphs printed above and below it, and each PDF page with text or a picture starts on a new Word page. The Word page is the size of the PDF's first page, or A4 upright when that page is landscape, such as a slide (scaled to fit, its shape kept, when it is larger than Word allows), and a picture wider or taller than the page's text area is scaled down to fit. Each word keeps its bold, italics, text size and colour wherever our reader matches it to the PDF's text, so a bold word inside a sentence stays bold. A word it matches is also set in a font that comes with Windows or Office, when our reader can tell which: the PDF's own font when it is one of those, such as Arial or Georgia, the one a free look-alike such as Liberation Sans or Carlito was drawn to match, and otherwise Arial, Times New Roman or Courier New, a substitute of the same kind as the PDF's font (sans-serif, serif or monospaced), judged by the font's name or by how the PDF marks it. A word whose font shows neither keeps Word's default font. The PDF's font files are not copied into the document. Words in other alphabets, such as Greek, Bengali or Chinese, and symbols carry no font name, so Word picks one, and text recognised by OCR comes through in Word's default style. Drawings made of lines and shapes are not carried across.`,
    `The extractor follows the page's reading order: a page set in two columns is read one column at a time. A table whose cells each fit on one line, with at least three rows and a column of figures such as amounts, quantities or dates, comes through as a Word table, each value in the column it sits under and an empty cell left empty; other tables come through one row per paragraph, their cells separated by tabs, and a table whose cells wrap onto a second line is not laid out as one Word table: the rows around a wrapped cell may come through as a smaller table, and the rest as lines of text. If no page has selectable text, as with a scan that was never OCR'd, the job stops rather than hand you a document of page pictures with nothing in it to edit. Tick “${WORD_OCR_LABEL}” before exporting and our server runs OCR on the file first, in the languages you pick, and converts the result in the same job.`,
    `Conversion happens on a server, not in your browser. Your PDF travels over TLS to pdf.xyz's secure server, where poppler's pdftotext reads the text layer and pdf.js finds each picture and where the page shows it. Our server deletes the uploaded PDF when the job finishes; the DOCX link expires after ${OUTPUT_TTL} minutes, and a daily storage rule then erases the stored copy. Each PDF is a job of its own, and uploads above ${CEILING_MB} MB are refused.`,
  ],

  useCases: [
    {
      title: "Several files at once",
      body: workerBatchPageSentence("pdf-to-word"),
    },
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
      body: "Fix a name, a date or a clause in the DOCX, then turn the finished file back into a PDF with Word to PDF. Check the result against the original, since the converted text starts out in standard Office fonts and without the original's layout.",
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
      title: "Add your PDF",
      body: "Drop your file on the Add your PDF area or choose browse to pick it; it is sent only when you press Export DOCX, which works once the status badge reads Secure server. Press Remove to swap it for another; two or more PDFs open a batch list instead.",
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
      a: "Closer than plain text, but not a copy of the page. Words keep their bold, italics, size and colour where our reader matches them, and a table whose cells each fit on one line, with a column of figures, comes through as a Word table; link targets and drawings made of lines and shapes stay behind, and the page's positions, indentation and spacing are not kept. Words are set in fonts that come with Windows or Office, a substitute of the same kind as the PDF's font (serif, sans-serif or monospaced) wherever its name or the PDF says which kind it is, and otherwise in Word's default font; the PDF's font files are not copied into the document. Text recognised by OCR, pages our server could not read within what one conversion allows, and any word whose formatting it cannot tell for certain, such as one whose colour changes partway through or text drawn turned or over other text, come through unformatted rather than guessed, and the note beside the download names every page where that happened. The pictures sit on lines of their own between the paragraphs, and a picture painted over another, or over text, comes through on its own line instead of on top. What the page paints over a picture, such as a box over a name, is drawn into that picture, so what it covers stays covered. Each PDF page with text or a picture begins on a new Word page, and running headers and page numbers come through as ordinary paragraphs.",
    },
    {
      q: "Are the pictures kept at their full quality?",
      a: `Mostly. A plain JPEG photo up to ${PICTURE_PX} pixels on its longer side goes into the DOCX byte for byte. A larger one is scaled down to ${PICTURE_PX} pixels on that side, a black-and-white scan to ${BILEVEL_PX}, and a picture that is not a plain JPEG is re-saved, as a PNG or, for a photograph, a JPEG. A one-colour stencil comes through in its colour, and a picture the page repeats comes through each time it is shown. A picture the page shows only part of is cropped in Word the same way, so the hidden part can be uncropped there, unless something is painted over the picture: then it is re-saved as the page shows it, at its own resolution, and what is covered is not in the file. A picture too large for our server, or one it cannot decode, is left out, and the note beside the download names its page, ${UNNOTED}. Past ${MAX_PICTURES} pictures, the size of one file, or the time one conversion may take, a document's remaining pictures are left out too and counted in the same note; the text still comes through whole.`,
    },
    {
      q: "What happens to pages that are scans?",
      a: `A scan has no selectable text, only a picture of its words. In a PDF that also has typed pages, a scanned page comes through as that picture, on its own Word page, with no editable words, and beside the download the panel says how many pages had text and names the ones that came through only as pictures (up to ${MAX_LISTED_PAGES}, then a count of the rest). If no page has any selectable text, the job is turned away instead, since a document of page pictures would have nothing in it to edit; lettering converted to vector outlines has the same effect. Tick “${WORD_OCR_LABEL}” to have the words as text: our server runs OCR first, keeping pages that already have text as they are, and converts its result. OCR in the wrong language does not fail, it produces plausible-looking gibberish, so choose every language printed on the page. With the switch on, three of OCR PDF's boxes sit beside it: “Turn pages upright” for sideways or upside-down scanned pages, “Straighten crooked pages” for pages scanned at a slight angle, and “Redo existing OCR” for a PDF whose earlier OCR text is poor, to have those pages read again; Straighten and Redo cannot be ticked together. ${REDO_OCR_SCOPE} ${RTL_WORD_SENTENCE}`,
    },
    {
      q: "How are tables and multi-column pages handled?",
      a: "In reading order. A page set in two columns is read one column at a time. A table comes through as a Word table when each of its cells fits on one line, it has at least three rows, and one of its columns holds figures such as amounts, quantities or dates: each value stays in the column it sits under, an empty cell stays empty, and the words keep their formatting. Where one heading spans two columns, the values under it can share a cell, separated by a tab. Thin grey borders are added, since the PDF's own lines and shading are not read. A table we are less sure of comes through one row per paragraph with its cells separated by tabs instead: one with no column of figures, one with a column of sentences beside it, one whose heading does not sit over its values, one of more than 63 columns (Word's limit) or more than 10,000 cells, the tables of a page past its first 20,000 cells (empty ones counted), and every table of a document that would otherwise be too large to deliver, which the note beside the download then says. A table that continues onto the next page is not joined into one: each page's part is judged on its own, so a part of one or two rows comes through as lines of text. A table whose cells wrap onto a second line is not laid out as one Word table: the rows around a wrapped cell may come through as a smaller table, and the rest as lines of text. For a spreadsheet, use PDF to Excel or Extract Tables; for plain words with no upload at all, PDF to Text runs in your browser.",
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
    "how-to-convert-a-scanned-pdf-to-word",
    "how-to-make-a-scanned-pdf-searchable",
    "how-to-ocr-a-pdf-in-other-languages",
  ],
};

export default content;
