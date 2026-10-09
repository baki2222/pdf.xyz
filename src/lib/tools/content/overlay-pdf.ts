import type { ToolContent } from "./types";
import {
  OVERLAY_FITS,
  OVERLAY_LAYERS,
  type OverlayLayer,
} from "@/lib/pdf/overlay";
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

/** The three Layer buttons, labelled exactly as the segmented control shows them. */
const layerLabel = (id: OverlayLayer): string => {
  const option = OVERLAY_LAYERS.find((candidate) => candidate.id === id);
  if (!option) {
    throw new Error(
      `overlay-pdf content names a layer "${id}" the runner does not offer`,
    );
  }
  return option.label;
};
const ON_TOP = layerLabel("front");
const BEHIND = layerLabel("back");
const MULTIPLY = layerLabel("multiply");
const LAYER_LABELS = new Intl.ListFormat("en", {
  type: "disjunction",
}).format(OVERLAY_LAYERS.map((option) => `"${option.label}"`));

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
 * What an overlay keeps and drops, as the engine (`overlayPdf` in
 * src/lib/pdf/overlay.ts) does it since 1642738d, and where each is held:
 *  - Layer: "front" paints over the base content, "back" moves the overlay's
 *    stream to the front of /Contents so it paints under it, "multiply"
 *    blends on top. overlay-output.test.ts reads the pixels of each;
 *    overlay-runner.test.tsx drives the control and holds the served steps to
 *    every Layer and Scale label the runner renders.
 *  - Annotations: every visible annotation's normal appearance on an overlay
 *    page (a filled field, a stamp, a comment icon) is painted into that page
 *    before it is embedded; hidden ones and popups are not. The interactive
 *    objects themselves are not copied. A used overlay page that still has no
 *    content stream is skipped as blank and named; if every used page is
 *    blank the job is refused by name. Held in overlay-output.test.ts,
 *    "overlay pages whose content is not in a content stream".
 *  - Geometry: both pages as a viewer shows them, CropBox ∩ MediaBox turned by
 *    each page's /Rotate (placeOverlay, visibleBox). Held in overlay.test.ts
 *    ("all 16 rotation pairs") and overlay-output.test.ts (pdf.js renders).
 *  - the output's Title is the base's; Producer and Creator are
 *    STAMP_PRODUCER; ModDate is the time of the run (pdf-lib's load updates
 *    it).
 *  - owner-password-only and open-password PDFs are both refused by
 *    getPageCount / getPageRotations — the calls the two pickers make when a
 *    file is added — with "This PDF is password-protected. Unlock it first".
 *
 * HISTORY: until 2026-10-06 this block recorded a 2026-09-27 probe of the
 * engine BEFORE 1642738d (overlay always on top, MediaBox placement, /Rotate
 * ignored, annotations dropped, a field-only page refused), and the intro and
 * FAQ were written from it. The engine changed under them; the notes did not.
 */
const content: ToolContent = {
  slug: "overlay-pdf",

  seoTitle: "Overlay PDF on Another PDF — Stamp or Letterhead",

  metaDescription:
    "Stamp a letterhead, approval mark or ruled template PDF over every page of another PDF. Both files stay in your browser. Set scale, opacity and page cycling.",

  intro: [
    `${toolName} lays one PDF on top of another. The base is your document; the overlay is a letterhead, a "Received" stamp, a draft banner or a ruled template. Each base page gets the overlay drawn on top of its content, behind it, or blended with ${MULTIPLY}, as you choose under Layer, and the result keeps the base's page count and page sizes exactly. A base page mapped to a blank overlay page is left as it was, and the result says which.`,
    `The overlay is embedded as vector content, not a picture: its lines stay sharp at any zoom, its text stays selectable, and a stamp repeated on every page is stored only once. Both PDFs are combined in your browser with pdf-lib, neither is uploaded, and each may be up to ${maxMb} MB.`,
    `What a viewer shows on the overlay page is carried over as drawing: its own content plus the visible appearance of any filled-in field, stamp or comment on it, so typed answers show but can no longer be edited, and links in the overlay do not work as links. The base keeps its own form fields and title, its Producer and Creator properties become ${STAMP_PRODUCER}, and its modification date becomes the moment you ran the overlay.`,
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
      title: "Set layer, scale and opacity",
      body: `Under "Placement", choose ${LAYER_LABELS} for Layer, ${SCALE_LABELS} for Scale, and drag the Opacity slider. If the overlay has more than one page, a "Multi-page overlay" choice appears: "First page on all" or "Cycle pages".`,
    },
    {
      title: "Apply and download",
      body: 'Press "Overlay onto" followed by your page count. "Overlay applied" then lists the pages stamped, scale, opacity and file size; press "Download overlaid PDF" for a file ending in "-overlay.pdf".',
    },
  ],

  faqs: [
    {
      q: `What is the difference between "${FIT}", "${STRETCH}" and "${ACTUAL}"?`,
      a: `"${FIT}" scales the overlay up or down until it fits inside each page without distortion and centres it, which may leave margins. "${STRETCH}" covers the whole page, distorting it if the proportions differ. "${ACTUAL}" keeps its original size, centred, so a larger overlay is cut off at the edges. All three measure the part of the page a viewer shows, so a page trimmed with a crop box is fitted by its visible area, and only the visible part of the overlay page is used.`,
    },
    {
      q: "Why did my overlay hide the text of the base page?",
      a: `It was drawn with Layer set to "${ON_TOP}", the default, which paints the overlay over the page's content: if its page has a background, such as a white rectangle behind a letterhead, that background covers whatever lies under it. Under "Placement", set Layer to "${BEHIND}" to draw the overlay underneath the page's own text, or to "${MULTIPLY}" to keep it on top but let its white areas drop out. "${MULTIPLY}" is the choice for a scanned base page, whose own opaque image would hide an overlay placed behind it. Lowering the Opacity slider also lets the text show through.`,
    },
    {
      q: "Will the overlay be sideways on rotated pages?",
      a: `No. Some PDFs store a page one way up and carry a rotation setting that viewers apply on display, which is common in scans. The overlay is placed against the page as a viewer shows it, so it lands upright, and "${FIT}" sizes it against the width and height you see. A rotation setting on the overlay's own page is honoured too: the overlay appears the way it does when you open that file on its own.`,
    },
    {
      q: "Can I use a different overlay page for each page of my document?",
      a: 'Yes, when the overlay PDF has more than one page. Choose "Cycle pages" and base page one gets overlay page one, page two gets page two, and so on, starting again from the first overlay page when the overlay runs out. "First page on all" ignores the rest and repeats page one.',
    },
    {
      q: "My overlay is a filled-in form. Will the answers show?",
      a: "Usually, yes. The visible appearance of each filled field is painted into the overlay as part of its drawing, so the answers appear on every stamped page but cannot be edited there; the overlay's fields themselves are not copied. Some form fillers save the values without redrawing the fields and leave the viewer to do it, and those answers come out blank or out of date. Run such a form through Flatten PDF first, which also works in your browser and redraws the answers into the page, then use the flattened copy as the overlay. An overlay page with no content stream and no visible field, stamp or comment is skipped as blank: the base pages it maps to are left unchanged and the result names it.",
    },
    {
      q: "What if either PDF is password-protected?",
      a: `Each picker refuses an encrypted file the moment you add it, and that includes a PDF with no open password whose printing or copying is locked, because those permissions are enforced through encryption. Unlock PDF can remove the protection given the open password or, for a permissions-only file, the owner password. Unlike this tool, Unlock PDF uploads: the PDF travels over TLS to pdf.xyz's secure worker, the input is deleted when the job finishes, the unlocked copy can be downloaded for ${linkMinutes} minutes, and a daily storage rule erases the stored copy after that.`,
    },
  ],

  relatedGuides: [],
};

export default content;
