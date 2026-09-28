import type { ToolContent } from "./types";
import { getToolBySlug } from "@/lib/tools";
import { toolFileCeilingMb } from "@/lib/tools/file-ceilings";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";

/*
 * Every behavioral claim below was read from, or probed against, the code:
 *  - runner: src/components/tools/runner/rotate-runner.tsx (button labels,
 *    default all-pages selection, disabled-until-changed "Apply rotation",
 *    "Download rotated PDF", `-rotated` filename suffix via outputName).
 *    Selection helpers in ./selection.ts: a click TOGGLES a page and a
 *    shift-click ADDS a range to the current selection — and every page starts
 *    selected, so a range only narrows anything after Clear. The use cases
 *    below are written around that;
 *  - thumbnails are rendered at rotation 0 and turned by CSS to the page's
 *    current angle; page-tile.tsx prints the angle on any tile not at 0°;
 *  - engine: organizePages() in src/lib/pdf/engine.ts copies each page into a
 *    NEW pdf-lib document and sets its /Rotate. Probes on 2026-09-27 through
 *    tsx: rotations [0,90,0] became [90,180,0]; the result had no /Outlines,
 *    no /AcroForm (0 fields, but the widget still carries its /AP), no
 *    title/author, and a catalog of only /Type and /Pages — /PageLabels,
 *    /StructTreeRoot, /MarkInfo and /Names (attachments) were all dropped.
 *    Flatten PDF then Rotate: 0 fields, value drawn as a page XObject.
 *    Link probe (2026-09-27, tsx, organizePages on a 2-page file): a /URI
 *    link and a /Text comment survive on their page, but an internal /Link
 *    whose /Dest named page 2 now points at an orphan copy of page 2 (6 0 R)
 *    that is NOT in the page tree (10 0 R, 11 0 R) — hence "may stop working".
    SUPERSEDED the same day: `copyChosenPages` in src/lib/pdf/engine.ts
    re-aims such links at the kept pages' new copies (engine.test.ts);
 *  - pdf-lib's create() plus stamp() leave producer/creator reading pdf.xyz;
 *  - Unlock PDF needs a typed password (canSubmit in
 *    pdf-security-worker-panel.tsx), so a restricted file needs its OWNER
 *    password there — the FAQ says so rather than implying it just unlocks;
 *  - loadPdf() refuses any PDF with an /Encrypt dictionary (pdf-lib throws
 *    even when only an owner password is set) with "Unlock it first";
 *  - the size cap is the rotate runner's own gate, read via toolFileCeilingMb.
 */
const rotateTool = getToolBySlug("rotate-pdf");
const ceilingMb = rotateTool ? toolFileCeilingMb(rotateTool) : null;
if (ceilingMb === null) {
  throw new Error("rotate-pdf content states a file ceiling it cannot find");
}
const unlockLinkMinutes = DEFAULT_RETENTION.outputTtlMinutes;

const content: ToolContent = {
  slug: "rotate-pdf",

  seoTitle: "Rotate PDF Pages Permanently — No Upload",

  metaDescription:
    "Turn sideways or upside-down PDF pages the right way up: one page, a selection or all of them. The new angle is saved in the file; the PDF is not uploaded.",

  intro: [
    "Rotate PDF fixes pages that open sideways or upside down: a scan fed through the wrong way, a wide spreadsheet inside a portrait report, a receipt photographed at a quarter turn. Open one PDF and each page appears as a tile previewing its current angle, with the angle printed on any tile not at 0°. Every page starts selected, so Left, Right or 180° turn the whole document at once, while a tile's own arrows fix just that page.",
    `The new angle goes into each page's /Rotate entry rather than into its drawing, so text stays selectable, images are not recompressed, and any standards-following viewer opens the page the right way up. Page count and order stay exactly as they were. Your browser does the work locally and the document is not uploaded; it takes one file of up to ${ceilingMb} MB.`,
    "One trade-off: the rotated copy is rebuilt from the pages alone. Web links and comments stay on their pages, but bookmarks, the document's title and author properties, and the form definition that makes fields fillable are left behind. Links that jump to another page of the same PDF are re-aimed at the rotated pages, so they keep working. For an interactive form or a tagged, accessible PDF, read the FAQ below first.",
  ],

  useCases: [
    {
      title: "A batch scan with a few pages turned",
      body: "When only some sheets went through the scanner sideways, press Clear, click the first bad tile, shift-click the last one to add the run between them, then press Left or Right, whichever way those pages lie.",
    },
    {
      title: "Every other page upside down after duplex scanning",
      body: "Every page starts selected, so click each page that already reads correctly to take it out of the selection, then press 180° to flip all the rest in one move.",
    },
    {
      title: "A landscape table inside a portrait document",
      body: "Use the arrows on each wide page's own tile so a spreadsheet or chart reads without tilting your head; the text pages around them keep their angle whatever is selected.",
    },
    {
      title: "Getting orientation right before you merge or print",
      body: "Straighten each source file first, then combine them with Merge PDF so the finished pack reads one way from cover to last page.",
    },
  ],

  steps: [
    {
      title: "Open the PDF you want to straighten",
      body: 'Drag one file onto the "Drop your PDF here, or browse" area (captioned "One PDF · rotate any or all pages"), or click browse. The file name, page count and size then appear above the Rotate controls.',
    },
    {
      title: "Pick the pages to turn",
      body: "Every page starts selected, and the Rotate bar shows what it applies to. Click a tile (or focus it and press Enter or Space) to toggle it, use Select all, Clear or Invert, or shift-click to add every page between the tile you last clicked and this one. With nothing selected, Left, Right and 180° act on every page.",
    },
    {
      title: "Rotate",
      body: "Press Left or Right to turn the selected pages a quarter turn, or 180° to flip them; each press adds to the angle the page already has. The arrows on a single tile turn only that page, and Reset puts every page back the way it arrived.",
    },
    {
      title: "Apply and download",
      body: "Press Apply rotation, which unlocks once at least one page differs from the original. The finished panel counts the pages that were turned; Download rotated PDF then saves the file under its original name with -rotated added before .pdf, minus any characters a file name cannot hold.",
    },
  ],

  faqs: [
    {
      q: "Will the pages stay rotated when I open the file somewhere else?",
      a: "Yes. The rotate button in many PDF viewers only changes the on-screen view and forgets it when the file closes. This tool writes the angle into each page's rotation entry inside the PDF, so the downloaded copy opens and prints rotated in other viewers too.",
    },
    {
      q: "Can I rotate a single page and leave the rest alone?",
      a: "Yes. Each tile has its own left and right arrows that turn only that page, whatever is selected. Left, Right and 180° act on the current selection instead.",
    },
    {
      q: "Does rotating reduce quality or re-render the pages?",
      a: "No. The page content is copied across unchanged and only its rotation setting is updated, so text stays text and images keep their original resolution.",
    },
    {
      q: "Why is the Apply rotation button greyed out?",
      a: "It activates only when at least one page will end up at a different angle from the one it opened with. Four quarter turns, or Reset, bring pages back to where they started and leave nothing to apply.",
    },
    {
      q: "Does anything get lost when I rotate a PDF here?",
      a: "Page content, dimensions and order are kept, and so are web links and comments on each page. Document-level items are not: bookmarks, the title and author, page labels such as i, ii, iii, attached files, the accessibility tags of a tagged PDF, and the form structure; the copy lists pdf.xyz as its producer. A link that jumps to another page of the same PDF is reconnected to that page in the rotated copy. Without the form structure the copy is no longer a dependable fillable form: each field's drawn box stays on its page, but whether it can still be filled, or still shows a typed value, depends on the viewer. To keep typed values, run Flatten PDF first and rotate the flattened copy.",
    },
    {
      q: "Can I rotate a password-protected PDF, and is my file uploaded?",
      a: `Not while it is encrypted: opening one stops with "This PDF is password-protected. Unlock it first, then try again." That includes a PDF anyone can open but whose author blocked printing or copying. Unlock PDF removes a password you know, which for a restricted file means its owner password. Unlike rotation, Unlock PDF runs on a server: the file is uploaded over TLS to pdf.xyz's secure worker, the input is deleted when the job finishes, and the download link expires after ${unlockLinkMinutes} minutes. Rotation itself uploads nothing: your browser turns a PDF of up to ${ceilingMb} MB.`,
    },
  ],

  relatedGuides: [],
};

export default content;
