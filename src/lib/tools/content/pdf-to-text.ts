import type { ToolContent } from "./types";
import { RUNNER_FILE_CEILINGS } from "@/lib/tools/file-ceilings";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";

/**
 * The byte cap the PDF to Text runner's own gate (`useSinglePdf` →
 * `validatePdfFile`) refuses above, read from the per-runner ceiling table and
 * stated in whole megabytes. Derived, never typed.
 */
const MAX_MB = Math.round(RUNNER_FILE_CEILINGS["pdf-to-text"] / (1024 * 1024));

/** Minutes a worker download link lasts, for the OCR PDF cross-link. */
const OUTPUT_TTL = DEFAULT_RETENTION.outputTtlMinutes;

/*
 * Behaviour claims below were checked against src/lib/pdf/text.ts, the runner
 * (pdf-to-text-runner.tsx, single-pdf-runner.tsx, runner-kit.tsx) and pdfjs
 * 6.1.200 probes on 2026-09-27, using getTextContent({includeMarkedContent:
 * false}) exactly as text.ts does:
 *  - text under a drawn black box, white text and render-mode-3 (invisible)
 *    text ARE extracted;
 *  - two words drawn apart with no space glyph came out "LEFT RIGHT": pdfjs
 *    inserts spaces and line ends from glyph positions, so the copy must not
 *    say nothing is inferred;
 *  - a filled form field's value is NOT extracted until pdf-lib form.flatten()
 *    (what flatten.ts calls); after it the value ran on with no separator
 *    ("WHITE TEXTFIELDVALUE");
 *  - a blank page contributes nothing (pageTextChunks drops empty chunks), but
 *    the result line's page count is doc.numPages, blank pages included;
 *  - a trailer /Encrypt entry alone makes pdf-lib PDFDocument.load throw
 *    EncryptedPDFError (probed with a hand-built /Encrypt dict), and loadPdf
 *    maps it to "This PDF is password-protected. Unlock it first…". Presence is
 *    the whole test, so owner-password-only files are refused too.
 *  - OCRmyPDF runs without --force-ocr (ocr-native.ts), so OCR PDF cannot
 *    re-read pages that already carry a (garbled) text layer: the FAQ must not
 *    offer OCR as the fix for fonts with no Unicode map.
 *  - Unlock PDF requires a non-empty password (pdf-security.ts), so the FAQ
 *    says a copy-restricted file needs its owner password there.
 *  - Re-probed in review (pdf-lib + pdfjs-dist 6.1.200 from this tree): white,
 *    under-box, render-mode-3 and LEFT/RIGHT all came out as above; the
 *    flattened field value ran on ("LINE2FIELDVALUE") even 180pt lower on the
 *    page; a trailer /Encrypt alone made PDFDocument.load throw /encrypt/i.
 *  - text.ts itself says pdfjs "already provides real space glyphs for most
 *    PDFs", so the intro must not claim a PDF never records word ends.
 *  - Reading order (2026-10-06): text.ts reorders a page's lines — a title
 *    or heading drawn after its body, a header drawn last, a footer or page
 *    number drawn first, alone or in two pieces on one baseline — and keeps
 *    stored order for a page drawn a column at a time, for rotated or
 *    vertical text, and above MAX_ORDERED_BLOCKS blocks. Every one of those
 *    is a fixture in src/lib/pdf/text-reading-order.test.ts. The copy said
 *    "in the order the program that made the PDF wrote it" until then, and
 *    derived-tool-copy.test.ts now bans that shape on every page whose
 *    runner reads through the extractor.
 */
const content: ToolContent = {
  slug: "pdf-to-text",

  seoTitle: "PDF to Text: Extract a PDF to TXT in Your Browser",

  metaDescription:
    "Copy the selectable text out of a PDF into a UTF-8 .txt file and read it in a preview before saving. It is extracted locally, so the file is not uploaded.",

  intro: [
    `PDF to Text reads the text stored in one PDF and saves it as a plain UTF-8 .txt file. A PDF records where each run of text sits rather than where its lines end, and some files leave out the spaces between words, so the extractor, pdf.js, works both out from positions: a new line where the text drops down the page, a space where the gap between letters is wide enough to be one. Pages are separated by one blank line, a page with no text adds nothing, and no page numbers or markers are inserted. Typefaces, bold, colour, pictures and ruled lines are left behind.`,
    `Extraction runs inside your browser tab, so the PDF is not uploaded to pdf.xyz. It takes one file at a time, up to ${MAX_MB} MB. Before you save, the result gives the character count and the document's page count, blank pages included, and shows the full text in a scrollable box you can copy from.`,
    `Text comes out in reading order where the order the PDF stores it in is out of step with the page: a title or heading stored after the text under it, a running header stored last, and a footer or page number stored first are each moved to where they read. A page stored a column at a time comes out a column at a time, while a page carrying rotated or vertical text, or more separate pieces of text than the extractor will sort (a detailed map can have that many), keeps the order stored in the file. A scanned page stores a picture, not characters, so an image-only PDF is reported as having no selectable text rather than producing an empty file. Hidden text is the opposite case: white lettering, words under a black box drawn on top, and the invisible layer an OCR pass adds are all extracted.`,
  ],

  useCases: [
    {
      title: "Taking a whole document's words in one go",
      body: "Instead of selecting page after page in a viewer, get every page's text as one file to paste into an email, a spreadsheet or a translation tool.",
    },
    {
      title: "Feeding a script, search index or word count",
      body: "A UTF-8 .txt file with no markup is plain input for grep, a word counter, a diff against an earlier draft, or a search index.",
    },
    {
      title: "Testing whether a redaction really removed the words",
      body: "If a name was blacked out by drawing a box over it, the name is still in the text layer and appears in the preview.",
    },
    {
      title: "Reading what an OCR pass actually recognised",
      body: "A searchable PDF from OCR carries an invisible text layer. This shows it as plain words, so a page recognised in the wrong language stands out before you rely on it.",
    },
  ],

  steps: [
    {
      title: "Add a PDF",
      body: `Drop one PDF where the page says "Drop your PDF here, or browse", or click there to open your file picker. A file that is not a PDF, is empty, or is over ${MAX_MB} MB gets a message naming it before any page is read.`,
    },
    {
      title: "Press Extract text",
      body: 'The file name, page count and size appear. There are no settings: press Extract text, and the button reads "Extracting text…" while pages are read.',
    },
    {
      title: "Check the preview",
      body: 'Under "Text extracted" you see the character and page counts and the text itself in a scrollable box. Select any part of it to copy just that passage.',
    },
    {
      title: "Download TXT",
      body: 'The button shows the size of the file it will save, named after your PDF with "-text.txt" on the end. "Start over" clears the page for another document.',
    },
  ],

  faqs: [
    {
      q: 'What does "No selectable text found" mean?',
      a: `No page of the PDF has stored characters, usually because the pages are scans or photos, or the lettering was converted to outlines. OCR PDF can recognise the words and return a searchable PDF, a .txt file, or both, but it is not local: the file goes over TLS to pdf.xyz's secure worker, the input is deleted when the job finishes, and the download link expires after ${OUTPUT_TTL} minutes.`,
    },
    {
      q: "Are columns, tables and spacing kept?",
      a: "A new line on the page becomes a new line in the file; horizontal alignment is lost. Columns and table cells come out as plain text, split by spaces and line breaks, and a page stored a column at a time comes out a column at a time. For a grid you can sort and sum, Extract Tables returns a ZIP of per-table CSV files plus one Excel workbook; it runs on the secure worker, so that document is uploaded.",
    },
    {
      q: "Why are my form entries missing from the text?",
      a: "Answers typed into fillable fields belong to the form, not the page, so they are not extracted. Run the file through Flatten PDF first, which also works in your browser; the entries become page text, though a value can run straight on from the words before it with no space.",
    },
    {
      q: "Can it open a password-protected PDF?",
      a: "No. Any encrypted PDF is stopped while loading with a password-protected message, even one that opens freely in a viewer and only forbids copying. Unlock PDF removes the encryption given a password the file accepts (for a copy-restricted file, its owner password); it runs on pdf.xyz's secure worker, so the file and the password are uploaded.",
    },
    {
      q: "Will the text be readable in other languages and scripts?",
      a: "The file is UTF-8 with Unix-style line breaks, so any script comes through as long as the PDF maps its glyphs back to Unicode. Fonts embedded without that map give wrong characters or none, and this tool cannot repair them.",
    },
    {
      q: "Does a PDF from Redact PDF still have text to extract?",
      a: "No. Redact PDF turns every page into an image and paints over the areas you choose, so its output has no text layer at all and this tool reports that it found no selectable text.",
    },
  ],

  relatedGuides: ["how-to-make-a-scanned-pdf-searchable"],
};

export default content;
