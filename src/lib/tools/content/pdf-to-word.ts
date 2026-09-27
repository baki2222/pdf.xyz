import type { ToolContent } from "./types";
import { getToolBySlug } from "@/lib/tools";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { toolFileCeiling } from "@/lib/tools/file-ceilings";
import {
  modeHasBrowserPath,
  modeUploadsFiles,
} from "@/lib/tools/processing-split";

/*
 * Behaviour claims below were read from the implementation on 2026-09-27:
 *  - src/components/tools/pdf-office-export-worker-panel.tsx — the status badge
 *    ("Secure worker" when the runner is shown), the one-file "Add your PDF, or
 *    browse" drop zone with a Remove button, the "Export DOCX" button (busy label
 *    "Exporting DOCX…"), "Your DOCX file is ready." and "Download <name>". The
 *    panel has ALREADY fetched the DOCX bytes (pdf-security-client.ts step 5)
 *    before it shows that button, which saves them from browser memory — so the
 *    button keeps working past the worker's link TTL until the page is closed;
 *  - src/app/api/uploads/route.ts + src/app/api/jobs/route.ts — rate-limited,
 *    but no sign-in check, which is what "no account" rests on;
 *  - src/lib/workers/pdf-text/native.ts + parse.ts — the worker runs poppler's
 *    `pdftotext -layout` with the inter-column padding KEPT, pages joined by a
 *    blank line; `hasText` is simply "the extracted text is not blank", so text
 *    drawn as vector outlines fails the same way an image scan does;
 *  - src/lib/workers/pdf-office-export/engine.ts — `docx()` trims each line
 *    (leading indentation goes), drops empty ones (so the blank line between two
 *    paragraphs goes too), and writes one plain `<w:p>` run per line: no styles,
 *    no images, no tables, no page breaks, no hyperlinks. No selectable text in
 *    the WHOLE file → `no_text`, which tells the visitor to run OCR first; a
 *    page with no text inside an otherwise textual PDF contributes nothing, with
 *    no marker; any extractor failure (e.g. an open password) → the generic
 *    "could not be exported" message, which does not mention the password;
 *  - src/lib/workers/processor/pdf-office-export.ts — exactly one PDF per job,
 *    output named after the input stem with `.docx`; the generic failure maps to
 *    a RETRYABLE `internal_error`, so the executor (executor.ts, default
 *    DEFAULT_MAX_ATTEMPTS with a requeue delay) re-runs a password-locked PDF
 *    before the job finally fails. The FAQ says "retries" and states no count.
 * Checked locally on 2026-09-27 by running createPdfOfficeExportProcessor with
 * nativePdfOfficeExportDeps (poppler 25.07 pdftotext, NOT the production
 * worker's build) and opening the DOCX in Microsoft Word: a two-column page
 * gave one Normal paragraph per line holding both columns with the spaces
 * intact, a text-less middle page vanished silently, a blank PDF gave
 * `no_text`, and an RC4 open-password PDF gave the generic failure. That was
 * the PROCESSOR, not the composed executor → client chain; a production job is
 * still owed (CLAUDE.md rule 5).
 * The catalogue description ("preserving layout and text flow") is NOT true of
 * this engine and nothing here repeats it. Every number is interpolated.
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

  metaDescription: `Convert a PDF to an editable Word DOCX: every line of selectable text becomes a paragraph you can rewrite. Scans need OCR first. Up to ${CEILING_MB} MB, no account.`,

  intro: [
    `PDF to Word lifts the text you could highlight in a PDF and writes it out as a .docx file that opens and edits in Word. It is a text conversion, not a page replica: each line on the page becomes its own paragraph in Word's default Normal style, page after page. Fonts, bold and italics, colours, images and page breaks are not carried across, and a sentence wrapped over three lines arrives as three short paragraphs.`,
    `The extractor keeps the horizontal spacing between words, so text that sat side by side on the page shares one paragraph. A table row that fits on one line stays on one line, and a two-column article comes out with a slice of each column on every line. If no page has selectable text, as with a scan that was never OCR'd, the job stops and asks you to run OCR first instead of handing you an empty document.`,
    `Conversion happens on a server, not in your browser. Your PDF travels over TLS to pdf.xyz's secure worker, where poppler's pdftotext reads the text layer. The worker deletes the uploaded PDF when the job finishes; the DOCX link expires after ${OUTPUT_TTL} minutes, and a daily storage rule then erases the stored copy. A run handles a single PDF, and uploads above ${CEILING_MB} MB are refused.`,
  ],

  useCases: [
    {
      title: "Reuse the wording of a report or policy",
      body: "When a few pages of an existing document belong in a new one, converting saves retyping. Single-column prose arrives line by line in page order, ready to restyle in your own template.",
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
      body: "Your file goes up over TLS and the secure worker pulls out its selectable text. The button shows Exporting DOCX… while the job runs, and the worker discards your upload once the job is done.",
    },
    {
      title: "Download the Word file",
      body: `When "Your DOCX file is ready." appears, press the Download button beneath it, named after your file with a .docx extension. The page has already fetched the DOCX, but save it before closing the tab: the worker's own link stops working after ${OUTPUT_TTL} minutes.`,
    },
  ],

  faqs: [
    {
      q: "Will the Word file look like my PDF?",
      a: "No. The DOCX carries the words as plain paragraphs; fonts, sizes, colours, images and link targets stay behind. Indentation is trimmed from the start of each line, the blank gap between paragraphs is dropped, and running headers and page numbers come through as ordinary lines wherever they fall.",
    },
    {
      q: "Why was my PDF turned away as having nothing to export?",
      a: "Because no page gave up any selectable text. Most often every page is a picture, as with a scan or a phone photo saved as PDF; lettering converted to vector outlines has the same effect. The converter refuses rather than return an empty file. If you cannot highlight a word in your viewer, add a text layer with OCR PDF, then convert that result.",
    },
    {
      q: "What if only some of my pages are scanned?",
      a: "The job still succeeds as long as one page has selectable text; the image-only pages simply add nothing, and no placeholder marks where they were. If the DOCX seems short, look for pages you cannot highlight and run the whole file through OCR PDF before converting again.",
    },
    {
      q: "How are tables and multi-column pages handled?",
      a: "Line by line. Text sharing a line on the page shares a paragraph in Word, so table rows stay together without becoming Word table cells, and two columns end up interleaved. For real cells, use PDF to Excel or Extract Tables; for plain words with no upload at all, PDF to Text runs in your browser.",
    },
    {
      q: "Can I turn a PDF that has an open password into Word?",
      a: "Not directly. The worker cannot read text it cannot decrypt; it treats the failure as possibly temporary and retries, then the job fails with a general could-not-export message that does not mention the password. If you know the password, remove it with Unlock PDF and convert the decrypted copy. Unlock PDF cannot recover or bypass a password you do not have.",
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
