import type { ToolContent } from "./types";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { REDACT_DPI_PRESETS, redactPresetById } from "@/lib/pdf/redact";
import { RUNNER_FILE_CEILINGS } from "@/lib/tools/file-ceilings";

/*
 * Every behavioral claim below was read from the code on 2026-09-27:
 *  - runner: src/components/tools/runner/redact-runner.tsx — the "Redaction
 *    areas" section with Page / X (pt) / Y (pt) / Width (pt) / Height (pt)
 *    fields, a "Page N is W × H pt" line above them and an "Add area" button
 *    (which runs validateRedactions on the draft and shows its message); a
 *    per-box trash button; a "Page N preview" that is a blank schematic of the
 *    page (boxes only, NOT the page's content); "Fill" (Black / White);
 *    "Output quality" (the two presets below, Print selected by default); a
 *    "Redact PDF" button disabled until one area exists; a "Redacting pages…
 *    done/total" counter; "Redacted PDF ready" + "Download redacted PDF".
 *    AMENDED 2026-10-25: the button is enabled by an area OR a ticked match;
 *    "Output quality" is shown only for Flatten every page.
 *  - loading: SinglePdfRunner → useSinglePdf → validatePdfFile (default
 *    MAX_PDF_BYTES, which is RUNNER_FILE_CEILINGS.redact) and getPageRotations
 *    → loadPdf, which refuses ANY file with an /Encrypt entry (pdf-lib's
 *    isEncrypted) — owner-password-only files that open freely included — in
 *    the words of the pdf.js probe's verdict (src/lib/pdf/encryption.ts):
 *    "password-protected" only for a file that needs a password to open.
 *    AMENDED 2026-10-06: the FAQ quoted the retired "Unlock it first" sentence
 *    for both kinds until then.
 *    Drop zone text: "Drop your PDF here, or" + a "browse" link.
 *  - engine: src/lib/pdf/redact.ts — boxes are validated against each page's
 *    displayed (rotation-aware) size and a box that runs off the page is
 *    refused; then EVERY page of the document (not only pages with boxes) is
 *    rendered by pdf.js (worker bundled via import.meta.url in render.ts), the
 *    fill is painted into the canvas pixels before JPEG encoding, and each page
 *    is placed in a brand-new pdf-lib document. Its info dict is the title
 *    "Redacted PDF", creator/producer "pdf.xyz", and pdf-lib's fresh creation
 *    and modification dates (updateInfoDict). Nothing of the source's object
 *    tree is copied, so text, vectors, form fields, links, bookmarks and
 *    document properties do not survive as data.
 *  - there is no text search, no automatic detection and no click-and-drag
 *    drawing: areas are entered as numbers.
 *    SUPERSEDED 2026-10-25 (kept as history): "Find text to redact" searches
 *    the text (Match case, Whole word) and "Detect personal data" finds
 *    email addresses, phone numbers, Luhn-checked card numbers, mod-97-
 *    checked IBANs and dates after a date-of-birth label (redact-find.ts);
 *    every match goes into a review list, ticked, and each ticked match is
 *    boxed over its own glyphs when the PDF is redacted. A "Method" control
 *    offers "Flatten every page" (the default, unchanged) and "Remove text
 *    under boxes" (redact-remove.ts: Edit PDF's content-edit removal, which
 *    keeps everything outside the boxes and refuses vertical text, inline
 *    or unrewritable images, nested content and form fields under a box);
 *    the removal re-reads the output and refuses to save if a ticked match
 *    is still in its text (redact-find.test.ts). Areas by position are
 *    still typed as numbers; there is no click-and-drag drawing here.
 *  - images pdf.js cannot decode come out blank and the result says so
 *    (UndecodedImagesNotice with `redaction`, which states the count).
 *  - OCR PDF, Unlock PDF and Protect PDF are all processing "server" in
 *    src/lib/tools/catalog.ts, so every follow-up named here uploads.
 *  - Unlock PDF cannot run without a password: pdf-security-worker-panel.tsx
 *    canSubmit requires password.length > 0, so a file that opens freely but
 *    is restricted needs its OWNER password there. The FAQ must not imply
 *    Unlock PDF strips an owner lock on its own.
 *  - the "Redaction areas" heading carries the aside "Points from bottom-left
 *    · 72 pt = 1 in".
 *  - output filename: redactedOutputName() → "<name>-redacted.pdf".
 */
const SCREEN = redactPresetById("screen");
const PRINT = redactPresetById("print");
const MAX_MB = Math.round(RUNNER_FILE_CEILINGS.redact / (1024 * 1024));
const LINK_MINUTES = DEFAULT_RETENTION.outputTtlMinutes;
const PRESET_LABELS = REDACT_DPI_PRESETS.map(
  (preset) => `${preset.label} (${preset.dpi} DPI)`,
).join(" or ");

const content: ToolContent = {
  slug: "redact-pdf",

  seoTitle: "Redact PDF — Find and Remove Text, No Upload",

  metaDescription:
    "Find words, detect emails, phone and card numbers, then black them out for good: pages flattened, or the text under each box removed. In your browser.",

  intro: [
    "Redact PDF removes the parts of a document you mark instead of hiding them. A black rectangle drawn with an annotation tool is a separate object on top of the page, and the words beneath it can still be copied out of the file. Here each black-out area is painted into the pixels of a rendered page image, and the output is built from those images alone, so under a box there is no text, vector or form layer left to recover.",
    `The whole job runs in your browser tab: pdf.js, shipped with the page, reads and draws each page and the new file is assembled there, so the PDF is not uploaded. Find text searches the PDF's own text for a name or a number on every page at once, with Match case and Whole word, and Detect personal data finds email addresses, phone numbers, payment card numbers that pass the card checksum, IBANs that pass the IBAN checksum and dates that follow a “Date of birth” or “DOB” label. Every match lands in a review list, ticked, so you untick anything that should stay. You can also place an area by typing its page, its position from the bottom-left corner and its size in PDF points. One PDF at a time, up to ${MAX_MB} MB.`,
    `Under Method, “Flatten every page”, selected when the tool opens, rebuilds every page as a picture, including pages you did not mark, at ${PRESET_LABELS}: the result cannot be selected, searched or filled in, and links, bookmarks and the original title and author are not carried over. “Remove text under boxes” takes out only what lies under each box — its text, the covered pixels of a picture and any annotation there — and keeps the rest of the file as it was, still searchable. Before it saves, it searches the result for every ticked match again and stops if one is still there.`,
  ],

  useCases: [
    {
      title: "Court and tribunal filings",
      body: "Remove a date of birth, a home address or a minor's name from an exhibit before it goes into a public bundle, and hand over a copy where the removed text cannot be pasted back out.",
    },
    {
      title: "Sharing a statement or payslip",
      body: "A landlord or lender may need proof of income but not your full account number or employee ID. Box out those fields and send the rest.",
    },
    {
      title: "Answering a records request",
      body: "Before releasing records under a subject-access or freedom-of-information request, cover third parties' names and contact details.",
    },
    {
      title: "Posting a signed document",
      body: "Publish a contract, permit or certificate as evidence while covering the handwritten signature and reference numbers that someone could reuse.",
    },
    {
      title: "Dropping hidden document data",
      body: 'With Flatten every page, the output is a new file made only of page images, so the original\'s author, keywords and earlier saved revisions are not copied in. Its own properties read "Redacted PDF", with pdf.xyz as creator.',
    },
  ],

  steps: [
    {
      title: "Add your PDF",
      body: `Drag one PDF onto "Drop your PDF here, or", or use its browse link. Files over ${MAX_MB} MB are turned away before loading, and an encrypted PDF stops with a note asking you to unlock it first.`,
    },
    {
      title: "Find or detect what to remove",
      body: 'Under "Find text to redact", type a word or number and press Find, or tick the kinds of personal data to look for and press Detect. Each match appears in the review list with the words around it and its page; untick any that should stay. A scanned page has no text to search, and the panel names such pages.',
    },
    {
      title: "Enter each redaction area",
      body: 'Under "Redaction areas", fill in Page, X (pt), Y (pt), Width (pt) and Height (pt), then press "Add area". X and Y place the box\'s lower-left corner, measured from the page\'s bottom-left at 72 points to the inch (the note beside the heading says the same), and the line above the fields gives that page\'s size in points. A box that runs past the page edge is refused with a message naming the page size. Each accepted area gets its own trash button.',
    },
    {
      title: "Choose method, fill and quality",
      body: `Under "Method", keep “Flatten every page” or choose “Remove text under boxes” to keep the rest of the file searchable. Under "Fill", pick Black or White. When flattening, "Output quality" offers ${PRINT.label} (${PRINT.dpi} DPI), the default, for sharper pages, or ${SCREEN.label} (${SCREEN.dpi} DPI) for a lighter file meant for on-screen reading.`,
    },
    {
      title: "Redact and download",
      body: 'Press "Redact PDF" (it stays disabled until there is an area or a ticked match) and, when flattening, watch the "Redacting pages…" counter. When "Redacted PDF ready" appears, "Download redacted PDF" saves it with -redacted added to the original name.',
    },
  ],

  faqs: [
    {
      q: "Can someone remove the black boxes or copy the text underneath?",
      a: "Not inside the boxed areas. When flattening, the fill is painted into the page image before it is saved, and the download holds only those images, so there is nothing under a box to select or uncover. When removing, the text under a box is deleted from the page itself, so there is nothing left to copy there either. Anything a box misses stays readable, so an area placed slightly off by position can leave the edge of a word showing; boxes from Find text and Detect are placed over the matched letters themselves.",
    },
    {
      q: "Can it find and redact every instance of a word automatically?",
      a: "Yes. Type it under Find text to redact and press Find: every place it appears on every page is listed, ticked, and each ticked one is boxed when you redact. Detect personal data does the same for email addresses, phone numbers, card numbers, IBANs and labelled dates of birth. Detection matches patterns and checksums, so it can miss a format it does not know — read the list before you redact. It reads the PDF's own text, so a scan with no text layer has nothing to find. The preview draws boxes on a blank outline of the page, not on its content, so open the downloaded file and check it.",
    },
    {
      q: "Why can't I select or search text in the redacted PDF?",
      a: `Because Flatten every page, the method the tool opens with, rebuilds every page as an image, which is what makes the removal permanent; nothing of the original's text, form fields, links or document information survives on any page. Choose “Remove text under boxes” when the rest must stay searchable: only what is under each box is taken out, and bookmarks, links and properties elsewhere stay. If it meets something it cannot take out safely, such as vertical text or a form field under a box, it stops and says so, and flattening handles it. After flattening, OCR PDF can add a searchable text layer back, and the boxed areas give it nothing to read. OCR PDF does not run in the browser: the file goes over TLS to pdf.xyz's secure server, the upload is deleted when the job finishes, the result's link expires after ${LINK_MINUTES} minutes, and a daily storage rule erases the stored copy after that.`,
    },
    {
      q: "Is my file uploaded when I redact it here?",
      a: `No. Rendering and rebuilding happen in your browser with a pdf.js server bundled into the site, and the PDF, up to ${MAX_MB} MB, stays on your device.`,
    },
    {
      q: "What happens with a password-protected PDF?",
      a: `Loading stops, with a message saying which lock the file has, or, when the check cannot tell, asking for whichever password applies. A PDF that needs a password to open is called password-protected. One that opens freely but carries an owner password restricting edits is told it has editing restrictions, and Unlock PDF removes those only with the owner (permissions) password that set them; it has no way to strip a lock without the password. Unlock PDF, and Protect PDF for re-locking the redacted copy, upload over TLS to pdf.xyz's secure server rather than running in your browser: the input is deleted when each job finishes, each download link expires after ${LINK_MINUTES} minutes, and a daily storage rule erases the stored copy after that.`,
    },
    {
      q: "What if part of a page comes out blank?",
      a: "If pdf.js cannot decode an image on a page, that image is missing from the output, not hidden under a box, and the result panel warns with a count. Treat that warning as a reason to look through the saved file page by page before it goes anywhere.",
    },
  ],

  relatedGuides: [
    "how-to-password-protect-a-pdf",
    "how-to-make-a-scanned-pdf-searchable",
  ],
};

export default content;
