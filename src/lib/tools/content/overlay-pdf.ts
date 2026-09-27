import type { ToolContent } from "./types";
import { OVERLAY_FITS } from "@/lib/pdf/overlay";
import { getToolBySlug } from "@/lib/tools";
import { toolFileCeilingMb } from "@/lib/tools/file-ceilings";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { STAMP_PRODUCER } from "@/lib/pdf/stamp";
import { modeUploadsFiles } from "@/lib/tools/processing-split";
import { getToolCapability } from "@/lib/jobs/capabilities";

/**
 * The size both file pickers refuse above, read through the same registry
 * chain the tool page uses (getRunnerKind → RUNNER_FILE_CEILINGS.overlay →
 * MAX_PDF_BYTES). The base PDF goes through `useSinglePdf` →
 * `validatePdfFile(file)` and the overlay through the runner's own
 * `validatePdfFile(file)`; both use that default budget.
 */
const overlayTool = getToolBySlug("overlay-pdf");
if (!overlayTool) {
  throw new Error("overlay-pdf content has no catalogue entry to describe");
}
const maxMb = toolFileCeilingMb(overlayTool);
if (maxMb === null) {
  throw new Error("overlay-pdf content states a file ceiling it cannot find");
}
/*
 * The description, intro and first FAQ all say neither file is uploaded. That
 * is asked of the chain that owns the meaning (modeUploadsFiles), not answered
 * by comparing a processing string here.
 */
if (modeUploadsFiles(overlayTool.processing)) {
  throw new Error(
    "overlay-pdf content says no upload, but the tool is not client-side",
  );
}
/** The name the intro uses is the catalogue's, not a second spelling of it. */
const toolName = overlayTool.name;
/*
 * The form FAQ sends people to Flatten PDF and says it also stays in the
 * browser; tie that to the catalogue, not to this comment.
 */
const flattenTool = getToolBySlug("flatten-pdf");
if (!flattenTool || modeUploadsFiles(flattenTool.processing)) {
  throw new Error(
    "overlay-pdf content says Flatten PDF runs in the browser, but it does not",
  );
}

/** The three Scale buttons, labelled exactly as the segmented control shows them. */
const fitLabel = (id: (typeof OVERLAY_FITS)[number]["id"]): string =>
  OVERLAY_FITS.find((option) => option.id === id)?.label ?? id;
const FIT = fitLabel("fit");
const STRETCH = fitLabel("stretch");
const ACTUAL = fitLabel("actual");
const SCALE_LABELS = new Intl.ListFormat("en", {
  type: "disjunction",
}).format(OVERLAY_FITS.map((option) => `"${option.label}"`));

/*
 * The password FAQ sends people to Unlock PDF and describes it as an upload.
 * That is only true while Unlock PDF runs on the worker, so the claim is tied
 * to its capability (getToolCapability) rather than to this comment.
 */
if (getToolCapability("unlock-pdf") !== "secure-worker") {
  throw new Error("overlay-pdf content describes Unlock PDF as an upload");
}
const linkMinutes = DEFAULT_RETENTION.outputTtlMinutes;

/*
 * What an overlay keeps and drops was checked against the real engine
 * (`overlayPdf` in src/lib/pdf/overlay.ts) on 2026-09-27, output read back
 * with pdfjs-dist, not assumed:
 *  - base: three pages, a title, a filled text field, page 3 carrying
 *    /Rotate 90; overlay: two 300 pt pages of Helvetica text plus a text
 *    field. Output: three pages, base title and base field kept, overlay
 *    field absent, overlay text EXTRACTED from every page (so "selectable"
 *    is measured, not inferred from the "Real vector overlay" tile).
 *  - "First page on all": every page's /XObject entry points at the SAME
 *    indirect object (24 0 R) — the stamp is stored once. "Cycle pages":
 *    page 1 → overlay 1, page 2 → overlay 2, page 3 → overlay 1 again.
 *  - an overlay page with no content stream, and an overlay whose only
 *    content is a filled form field, are both refused with "The overlay PDF
 *    couldn't be applied — …". The same form run through flattenPdf first
 *    and then overlaid carries its typed value onto the base page.
 *  - CORRECTION, re-probed 2026-09-27: the refusal is keyed on a MISSING
 *    /Contents (pdf-lib's MissingPageContentsEmbeddingError), not on "only
 *    fields". A field-only page that does carry an (empty) content stream is
 *    ACCEPTED and its answers silently vanish. The form FAQ was worded as if
 *    every field-only page is refused; it now states both outcomes.
 *  - the output's Title is the base's; Producer and Creator are
 *    STAMP_PRODUCER; ModDate is the time of the run (pdf-lib's load updates
 *    it). A base page carrying /Rotate 90 keeps it, and the overlay is drawn
 *    in that page's unrotated space, so the reader sees it turned with the
 *    page (the "HONEST SCOPE" note in overlay.ts).
 *  - owner-password-only and open-password PDFs are both refused by
 *    getPageCount / getPageRotations — the calls the two pickers make when a
 *    file is added — with "This PDF is password-protected. Unlock it first".
 *  - pdf-lib's PDFPageEmbedder copies only /Contents and /Resources, bounded
 *    by the MediaBox; it never reads /Annots or /Rotate. The placement box
 *    comes from PDFPage.getSize(), which is the MediaBox, not the CropBox.
 */
const content: ToolContent = {
  slug: "overlay-pdf",

  seoTitle: "Overlay PDF on Another PDF — Stamp or Letterhead",

  metaDescription:
    "Stamp a letterhead, approval mark or ruled template PDF over every page of another PDF. Both files stay in your browser. Set scale, opacity and page cycling.",

  intro: [
    `${toolName} lays one PDF on top of another. The base is your document; the overlay is a letterhead, a "Received" stamp, a draft banner or a ruled template. Every base page gets the overlay drawn over its content, and the result keeps the base's page count and page sizes exactly.`,
    `The overlay is embedded as vector content, not a picture: its lines stay sharp at any zoom, its text stays selectable, and a stamp repeated on every page is stored only once. Both PDFs are combined in your browser with pdf-lib, neither is uploaded, and each may be up to ${maxMb} MB.`,
    `Only what the overlay page itself draws is carried over; links, comments and fillable fields in the overlay PDF, and any answers typed into them, are left behind. The base keeps its own form fields and title, its Producer and Creator properties become ${STAMP_PRODUCER}, and its modification date becomes the moment you ran the overlay.`,
  ],

  useCases: [
    {
      title: "Putting letters on company letterhead",
      body: "Export the letterhead as a one-page PDF and overlay it on a letter written with plain margins. Every page gets the logo and footer, and the letter stays real text.",
    },
    {
      title: "Stamping a document as received or approved",
      body: "Lay a stamp PDF over an invoice before filing it, opaque for a solid mark or at lower opacity so a large stamp does not hide the figures beneath.",
    },
    {
      title: "Checking a design against a print template",
      body: `Overlay a dieline, bleed guide or label grid on a proof at partial opacity to see whether the artwork lines up. "${ACTUAL}" keeps the template at its true dimensions, centred, so its measurements still hold.`,
    },
    {
      title: "A different template page for each page",
      body: "A multi-page overlay can be applied in order, so the cover, continuation and closing sheets of a three-page letterhead set land on the matching pages of a three-page report.",
    },
  ],

  steps: [
    {
      title: "Add the base PDF",
      body: `Drag the document you want to stamp onto "Drop your PDF here, or", or click "browse". A file that is not a PDF, is empty, or is larger than ${maxMb} MB is refused before its contents are read; once accepted, its name and page count sit above the overlay picker.`,
    },
    {
      title: "Add the overlay PDF",
      body: 'In the "Overlay PDF" section, drag the stamp, letterhead or template onto "Drop the overlay PDF here, or", or click "browse". The same file checks apply. Its name and page count appear, and the "Remove overlay" cross beside them clears a wrong pick.',
    },
    {
      title: "Set scale and opacity",
      body: `Under "Placement", choose ${SCALE_LABELS} for Scale and drag the Opacity slider. If the overlay has more than one page, a "Multi-page overlay" choice appears: "First page on all" or "Cycle pages".`,
    },
    {
      title: "Apply and download",
      body: 'Press "Overlay onto" followed by your page count. "Overlay applied" then lists the pages stamped, scale, opacity and file size; press "Download overlaid PDF" for a file ending in "-overlay.pdf".',
    },
  ],

  faqs: [
    {
      q: `What is the difference between "${FIT}", "${STRETCH}" and "${ACTUAL}"?`,
      a: `"${FIT}" scales the overlay up or down until it fits inside each page without distortion and centres it, which may leave margins. "${STRETCH}" covers the whole page, distorting it if the proportions differ. "${ACTUAL}" keeps its original size, centred, so a larger overlay is cut off at the edges. All three measure the full media box, so on a page trimmed by a smaller crop box part of the overlay can fall outside what a viewer shows.`,
    },
    {
      q: "Why did my overlay hide the text of the base page?",
      a: "The overlay is always drawn above the base page's content, never beneath it. If its page paints a background, such as a white rectangle behind a letterhead, that background covers whatever lies under it. Lower the Opacity slider, or re-export the template without a background.",
    },
    {
      q: "Why is the overlay sideways on some pages?",
      a: `Some PDFs store a page one way up and carry a rotation setting that viewers apply on display, which is common in scans. The overlay is drawn onto the page as stored, before that rotation, so it turns along with the page, and "${FIT}" sizes it against the unrotated width and height. A rotation setting on the overlay's own page is ignored in the same way: the page is copied as stored.`,
    },
    {
      q: "Can I use a different overlay page for each page of my document?",
      a: 'Yes, when the overlay PDF has more than one page. Choose "Cycle pages" and base page one gets overlay page one, page two gets page two, and so on, starting again from the first overlay page when the overlay runs out. "First page on all" ignores the rest and repeats page one.',
    },
    {
      q: "My overlay is a filled-in form. Why was it refused, or why are the answers missing?",
      a: 'Typed answers are kept in form fields, which sit on top of a page rather than in its drawing, and only the drawing is copied. A form page with no content stream at all is refused with "The overlay PDF couldn\'t be applied"; one that has a content stream goes through with its answers missing. Run the form through Flatten PDF first, which also works in your browser, so the answers become page content, then use the flattened copy as the overlay.',
    },
    {
      q: "What if either PDF is password-protected?",
      a: `Each picker refuses an encrypted file the moment you add it, and that includes a PDF with no open password whose printing or copying is locked, because those permissions are enforced through encryption. Unlock PDF can remove the protection given the open password or, for a permissions-only file, the owner password. Unlike this tool, Unlock PDF uploads: the PDF travels over TLS to pdf.xyz's secure worker, the input is deleted when the job finishes, the unlocked copy can be downloaded for ${linkMinutes} minutes, and a daily storage rule erases the stored copy after that.`,
    },
  ],

  relatedGuides: [],
};

export default content;
