import type { ToolContent } from "./types";
import { RUNNER_FILE_CEILINGS } from "@/lib/tools/file-ceilings";
import {
  FONT_PACKS,
  SUPPORTED_SCRIPTS,
  UNSUPPORTED_SCRIPTS,
  fontPack,
} from "@/lib/pdf/font-packs";
import { formatBytes } from "@/lib/utils";

/**
 * The annotate runner's own input gate (`useSinglePdf` → `validatePdfFile` →
 * MAX_PDF_BYTES), read through the per-runner ceiling map and rounded the way
 * `toolFileCeilingMb` rounds it, so this page and the refusal quote one number.
 */
const CEILING_MB = Math.round(RUNNER_FILE_CEILINGS.annotate / (1024 * 1024));

function listOf(items: readonly string[], joiner = "and"): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${joiner} ${items[items.length - 1]}`;
}

/*
 * SINCE 2026-10-24 Annotate PDF mounts the shared WYSIWYG editor
 * (`annotate-runner.tsx` → `editor/editor-session.tsx`), opened with its
 * Mark-up group's Highlight tool active and a "Mark up" first step. Until
 * then it was a form of its own — four markup kinds (Highlight, Box, Note,
 * Line) placed by typed X/Y points, a blank outline for a preview, "Add
 * markup", "Apply N markups" — and this page described that form; every such
 * sentence was rewritten with it.
 *
 * Facts this page leans on:
 *  - Mark-up group: MARKUP_KINDS in offered-kinds (Whiteout, Highlight,
 *    Draw, Note), the list the tool facts count; every other editor tool is
 *    in the same toolbar.
 *  - Highlight: a filled rectangle drawn with the Multiply blend at the
 *    chosen opacity (40% by default) — `editor-export.ts`.
 *  - Notes: typed on the page, wrapped in their box, on a coloured paper;
 *    each note's text chooses its OWN face (`embedDrawingFont` per object),
 *    WAS "Every note in one Apply shares a single font" until 2026-10-24 —
 *    true of `annotatePdf`'s batch font, false of the editor. A single note
 *    mixing two non-Latin scripts is still refused ("This text mixes …"), and
 *    characters no shipped face draws are refused by name
 *    (`refuseUncovered`), right-to-left scripts with that reason.
 *  - Output: `exportEditedPdf` appends to each page's content and saves with
 *    pdf-lib (`stampProducer`: Creator/Producer), so an existing digital
 *    signature stops validating; result "Annotated PDF ready", "Download
 *    annotated PDF", `annotatedOutputName` (-annotated).
 */
const noteScripts = listOf(SUPPORTED_SCRIPTS);
const isRtl = (reason: string) => /right[\s-]to[\s-]left/i.test(reason);
const rtlScripts = UNSUPPORTED_SCRIPTS.filter((e) => isRtl(e.reason)).map(
  (e) => e.name,
);
const otherRefused = UNSUPPORTED_SCRIPTS.filter(
  (e) => !isRtl(e.reason) && e.name !== "emoji",
)
  .slice(0, 3)
  .map((e) => e.name);
const refusedExamples = listOf([...rtlScripts, ...otherRefused], "or");
const emojiClause = UNSUPPORTED_SCRIPTS.some((e) => e.name === "emoji")
  ? ", or an emoji"
  : "";
const rtlClause =
  rtlScripts.length > 0
    ? ` For ${listOf(rtlScripts, "and")} the message adds that the script runs right to left and would come out reversed.`
    : "";

/** Named in a use case; fail the build rather than name a script we dropped. */
const CYRILLIC = "Cyrillic";
if (!SUPPORTED_SCRIPTS.includes(CYRILLIC)) {
  throw new Error(
    `annotate-pdf content names ${CYRILLIC}, which no pack draws`,
  );
}
const bengali = fontPack("bengali").label;
const japanese = fontPack("japanese").label;

/** The Noto files a note can trigger, smallest and largest, from FONT_PACKS. */
const packsBySize = [...FONT_PACKS].sort((a, b) => a.bytes - b.bytes);
const smallestPack = packsBySize[0]!;
const largestPack = packsBySize[packsBySize.length - 1]!;

const content: ToolContent = {
  slug: "annotate-pdf",

  seoTitle: "Annotate PDF — Highlight, Add Notes, No Upload",

  metaDescription:
    "Highlight, draw, add notes and white out parts of a PDF by dragging and clicking on its pages, flattened into the page by your own browser. Nothing is uploaded.",

  intro: [
    "Annotate PDF shows every page of your document and opens with Highlight ready: drag across the page and a translucent bar lands there. Beside it in the toolbar are Whiteout, Draw for freehand ink and Note for a typed note on coloured paper, and the rest of the editor's tools: text, pictures, signatures, rectangles, ellipses, lines and arrows. Anything you place can be dragged, resized from its handles, restyled or deleted, and every step can be undone.",
    `The whole job runs in your browser: the PDF is drawn, marked and saved there, with no upload, so it stays on your device. The limit is ${CEILING_MB} MB, and an encrypted PDF will not load, even one a viewer opens without asking for a password. Notes in the Western European character set are drawn in a built-in font; otherwise the page fetches a Noto typeface from this site, covering ${noteScripts}. A note with characters none of those faces draws, such as ${refusedExamples}${emojiClause}, stops the export with a message naming them.${rtlClause}`,
    "Markups are drawn as content inside the page, so the original text stays selectable and nothing becomes an image. They are therefore not PDF comments: a viewer's comment panel shows nothing to toggle, reply to or delete, and a highlight is a rectangle you draw, not a selection that follows the text.",
  ],

  useCases: [
    {
      title: "Point a colleague at one clause",
      body: "Drag a Highlight over the sentence that matters, add a Note in the margin and run an Arrow to it. Because the marks are part of the page, they also show in viewers and printouts that leave comments out.",
    },
    {
      title: "Circle the figures on a form or statement",
      body: "An Ellipse or Rectangle with an outline and no fill around a total or reference number draws the eye without covering it.",
    },
    {
      title: "Write a note in another script",
      body: `A Note can be written in ${bengali}, ${CYRILLIC} or ${japanese} as well as English. Each note takes its own font, so a ${bengali} note and a ${japanese} one can sit on the same page.`,
    },
    {
      title: "Sign off a review",
      body: "Draw a tick or your initials with Draw, or place a signature with Sign, beside the parts you have checked.",
    },
  ],

  steps: [
    {
      title: "Open your PDF",
      body: "Drag a single PDF onto the drop area or click browse. Its pages appear in a scrolling view, with Highlight already chosen in the toolbar.",
    },
    {
      title: "Mark up the page",
      body: "Drag across the page to highlight. Choose Whiteout, Draw or Note in the Mark up group for the others: Whiteout and Highlight draw where you drag, Draw follows your pointer, and Note opens a box to type in where you click.",
    },
    {
      title: "Adjust",
      body: "With Select, drag a markup to move it or drag a handle to resize it. The panel beside the page sets colour and opacity, and font, size and paper colour for notes. Undo and Redo step back and forward.",
    },
    {
      title: "Apply and download",
      body: "Apply & download writes the markups into the PDF and downloads it. Annotated PDF ready then gives the item count, the page count and the new file size; Download annotated PDF saves it again with -annotated added to the name, and Start over clears the tool.",
    },
  ],

  faqs: [
    {
      q: "Can I highlight text by selecting it?",
      a: "No. A highlight is a see-through rectangle you drag over the words, not a selection of them, so it covers the area you draw. To hide text rather than mark it, use Redact PDF.",
    },
    {
      q: "Can I take a markup out after saving?",
      a: "Only with an editor that can change page content: each markup is drawn into the page like ink rather than stored as a separate object. Before you apply, any markup can be selected and deleted, or undone. Keep the original if you may want an unmarked copy.",
    },
    {
      q: "Does annotating change anything else in my PDF?",
      a: "Pages keep their count, size, rotation, text and images, and the file keeps its bookmarks, form fields, existing annotations, title and author. What does change: Creator and Producer both become this site's name, and an existing digital signature will no longer validate, because pdf-lib writes out a whole new file rather than appending to the signed one. Markups sit on top of the page's own content, later ones over earlier ones.",
    },
    {
      q: "Is my document uploaded?",
      a: `No. The PDF is read, marked and saved by code running in this tab. The only files the tool itself fetches are pdf.xyz's own scripts and, when a note goes beyond the Western European character set, a Noto typeface from the /fonts/ folder on this same site: ${formatBytes(smallestPack.bytes)} for ${smallestPack.label} up to ${formatBytes(largestPack.bytes)} for ${largestPack.label}. That typeface is subset, so the finished PDF carries only the glyphs your notes use; notes in the built-in font embed no font file at all.`,
    },
  ],

  relatedGuides: [],
};

export default content;
