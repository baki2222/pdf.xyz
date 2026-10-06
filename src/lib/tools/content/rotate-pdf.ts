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
 * SUPERSEDED 2026-10-06 (kept as history): since L08 the runner calls setPageRotations(),
 *    which turns the loaded document IN PLACE. engine.test.ts and
 *    rotate-runner.test.tsx find nothing lost (lostStructure == []) on a file
 *    with bookmarks, a filled form, title/author, page labels, /Lang, tags and
 *    viewer preferences. The intro and FAQ kept saying the copy was "rebuilt
 *    from the pages alone" until then; tool-page-substance.test.ts now runs
 *    the engine and reads the served page for that claim;
 *  - stamp() leaves producer/creator reading pdf.xyz;
 *  - Unlock PDF needs a typed password (canSubmit in
 *    pdf-security-worker-panel.tsx), so a restricted file needs its OWNER
 *    password there — the FAQ says so rather than implying it just unlocks;
 *  - loadPdf() refuses any PDF with an /Encrypt dictionary (pdf-lib throws
 *    even when only an owner password is set), in the words of the pdf.js
 *    probe's verdict (src/lib/pdf/encryption.ts, AMENDED 2026-10-06): a file
 *    that needs a password is "password-protected", one that opens without
 *    one is told it has editing restrictions. The FAQ quoted the retired
 *    "Unlock it first" sentence for both until then;
 *    encryption-claims.test.ts now catches a quotation no surface says;
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
    `The new angle is saved permanently in each page's /Rotate entry rather than into its drawing, so text stays selectable, images are not recompressed, and any standards-following viewer opens the page the right way up. Page count and order stay exactly as they were. Your browser does the work locally and the document is not uploaded; it takes one file of up to ${ceilingMb} MB.`,
    "Nothing else in the file changes. Rotation updates one entry on each page and saves the same document, so bookmarks, the title and author, page labels, the fillable form and anything typed into it, attached files and a tagged PDF's accessibility tags all stay as they were, and links keep pointing where they did.",
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
      a: "No. The pages are not re-rendered: only each page's rotation setting is updated, and its content is left exactly as it was, so text stays text and images keep their original resolution.",
    },
    {
      q: "Why is the Apply rotation button greyed out?",
      a: "It activates only when at least one page will end up at a different angle from the one it opened with. Four quarter turns, or Reset, bring pages back to where they started and leave nothing to apply.",
    },
    {
      q: "Does anything get lost when I rotate a PDF here?",
      a: "No. Rotation saves the same document with a new angle on its pages. Page content, dimensions and order stay as they were, and so do web links, links between pages, comments, bookmarks, the title and author, page labels such as i, ii, iii, attached files, the accessibility tags of a tagged PDF, and the fillable form with any values already typed into it. The one other change is the producer entry, which now names pdf.xyz.",
    },
    {
      q: "Can I rotate a password-protected PDF, and is my file uploaded?",
      a: `Not while it is encrypted, and the message says which lock it has. A PDF that needs a password to open is refused as password-protected. One that anyone can open but whose author restricted editing is refused too, with a message naming those restrictions, because your browser cannot rewrite it; Unlock PDF removes them with the owner (permissions) password that set them. Unlock PDF only removes a password you know; it cannot recover one. Unlike rotation, Unlock PDF runs on a server: the file is uploaded over TLS to pdf.xyz's secure worker, the input is deleted when the job finishes, and the download link expires after ${unlockLinkMinutes} minutes. Rotation itself uploads nothing: your browser turns a PDF of up to ${ceilingMb} MB.`,
    },
  ],

  relatedGuides: [],
};

export default content;
