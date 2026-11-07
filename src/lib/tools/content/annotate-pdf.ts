import type { ToolContent } from "./types";
import { RUNNER_FILE_CEILINGS } from "@/lib/tools/file-ceilings";
import {
  FONT_PACKS,
  SUPPORTED_SCRIPTS,
  UNSUPPORTED_SCRIPTS,
  fontPack,
} from "@/lib/pdf/font-packs";
import { formatBytes } from "@/lib/utils";
import { TEXT_MARKUPS, TEXT_MARKUP_LABEL } from "@/lib/pdf/editor/markup";

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
 *  - Mark-up group: MARKUP_KINDS in offered-kinds (Whiteout, Redact,
 *    Highlight, Draw, Note), the list the tool facts count; every other
 *    editor tool is in the same toolbar. WAS "(Whiteout, Highlight, Draw,
 *    Note)" here and in the intro, How-to and first step until 2026-11-01:
 *    Redact joined the group on 2026-10-24 and only the derived fact said so.
 *  - Highlight: a filled rectangle drawn with the Multiply blend at the
 *    chosen opacity (40% by default) — `editor-export.ts`.
 *  - Text markup (2026-11-08, audit annotate-pdf#2): Underline and
 *    Strikethrough buttons beside Highlight, and a Style menu (Highlight,
 *    Underline, Strikethrough, Squiggly — TEXT_MARKUPS in `markup.ts`) on
 *    a selected one; saved as comments they are /Underline, /StrikeOut and
 *    /Squiggly annotations (`editor-export-markup.test.ts`).
 *  - Selecting text (2026-11-08, audit annotate-pdf#3): with Highlight,
 *    Underline or Strikethrough, a press on text selects whole words to the
 *    release point in reading order, one band per line (`selectTextQuads`);
 *    a click on a word marks it; a press off text draws a box. WAS "No. A
 *    highlight is a see-through rectangle you drag over the words" until
 *    that day.
 *  - Comment (2026-11-08, audit annotate-pdf#4): a sticky note — an icon,
 *    its words in a popup — always written as a /Text annotation with a
 *    /Popup, even when the rest is flattened (`sticky.ts`). "Your name on
 *    comments (optional)", shown beside Apply once something is saved as a
 *    comment, fills every comment's /T; kept in localStorage only; blank
 *    writes no /T.
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
 *  - Restricted input (since 2026-10-30): `annotate-runner.tsx` passes
 *    `openProtected`, as Edit PDF does, so a PDF that opens with the empty
 *    password is decrypted in the browser and its /P is enforced by the
 *    editor's lock; comments only (bit 6), written as an incremental update
 *    under the author's encryption (`ProtectedPdf.saveChanges`), the
 *    markup choice fixed to comments. Until then the page said "an
 *    encrypted PDF will not load, even one a viewer opens without asking
 *    for a password" — true while the runner refused it.
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

/** "Highlight, Underline, Strikethrough or Squiggly": the Style menu's choices. */
const styleChoices = listOf(
  TEXT_MARKUPS.map((m) => TEXT_MARKUP_LABEL[m]),
  "or",
);

const content: ToolContent = {
  slug: "annotate-pdf",

  seoTitle: "Annotate PDF — Highlight, Add Notes, No Upload",

  metaDescription:
    "Highlight, draw, add notes and white out a PDF by clicking on its pages, then flatten them or save them as editable comments, in your browser. No upload.",

  intro: [
    "Annotate PDF shows every page of your document and opens with Highlight ready: press on a word and drag to the last word you want, and a translucent band follows the selected text line by line, the way a PDF viewer highlights; a click marks one word, and a drag where there is no text, such as a scan, draws a box. Beside it in the toolbar are Underline and Strikethrough for marking words the same way, Whiteout, Redact, Draw for freehand ink, Note for a typed note on coloured paper, and Comment for a sticky-note icon whose words open in a popup, and the rest of the editor's tools, among them text, pictures, signatures, rectangles, ellipses, lines and arrows. Whiteout only paints over what is under it; Redact removes the text and picture pixels under its box. Anything you place can be dragged, resized from its handles, restyled or deleted, and every step can be undone.",
    `The whole job runs in your browser: the PDF is drawn, marked and saved there, with no upload, so it stays on your device. The limit is ${CEILING_MB} MB. A PDF that needs a password to open has to be unlocked first; one that opens without a password but whose author restricted changes opens with only what the author allows, as described below. Notes in the Western European character set are drawn in a built-in font; otherwise the page fetches a Noto typeface from this site, covering ${noteScripts}. A note with characters none of those faces draws, such as ${refusedExamples}${emojiClause}, stops the export with a message naming them.${rtlClause}`,
    "Beside Apply & download you choose how highlights, drawings, notes, shapes and lines are saved. Flatten into the page, the default, draws them as content inside the page, so they show in every viewer and printout, the original text stays selectable and nothing becomes an image. Save markups as comments writes each one as a standard PDF annotation instead (a highlight, underline, strikethrough or squiggly underline, an ink drawing, a free-text note, a square, circle or line, each with its own appearance), which other PDF apps list as comments and let you select, edit or delete. Whiteout and redaction are always written into the page: a comment can be deleted by whoever opens the file, so a cover saved as one would hide nothing. A Comment is the reverse: it is always saved as a PDF comment, even when you flatten the rest, because a popup cannot be drawn into a page.",
    "A PDF whose author restricted changes, but that opens without a password, opens here with the author's rules in force. If the author allows comments, highlights, drawings, notes, shapes and lines are always saved as comments, never flattened, and the copy you download keeps the author's encryption, restrictions and owner password, with the original file kept byte for byte and the comments added after it. If the author does not allow comments, the mark-up tools stay locked and the page says so. Either way, typing the owner password into the page unlocks every tool for that file, checked in your browser and not sent anywhere, and the copy is then saved without encryption.",
  ],

  useCases: [
    {
      title: "Point a colleague at one clause",
      body: "Drag a Highlight over the sentence that matters, add a Note in the margin and run an Arrow to it. Flattened, the marks are part of the page, so they also show in viewers and printouts that leave comments out; saved as comments, your colleague can reply to or delete them in their own PDF app.",
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
      body: "Drag across the words to highlight them, or click one word. Choose Underline, Strikethrough, Whiteout, Redact, Draw, Note or Comment in the Mark up group for the others: Highlight, Underline and Strikethrough follow the text you drag across (or draw a box where there is no text), Whiteout and Redact draw where you drag, Draw follows your pointer, Note opens a box to type in where you click, and Comment drops a sticky-note icon there with a popup for your words.",
    },
    {
      title: "Adjust",
      body: `With Select, drag a markup to move it or drag a handle to resize it. The panel beside the page sets colour and opacity, a highlight's Style (${styleChoices}), and font, size and paper colour for notes. Undo and Redo step back and forward.`,
    },
    {
      title: "Apply and download",
      body: "Pick Flatten into the page or Save markups as comments beside the button, then Apply & download writes the markups into the PDF and downloads it. Annotated PDF ready then gives the item count, how many were saved as comments, the page count and the new file size; Download annotated PDF saves it again with -annotated added to the name, and Start over clears the tool.",
    },
  ],

  faqs: [
    {
      q: "Can I highlight text by selecting it?",
      a: "Yes. With Highlight, Underline or Strikethrough chosen, press on a word and drag to the last word you want: the mark follows the selected text in reading order, one band per line, from the first whole word to the last, and a click on a single word marks just that word. The bands are what is saved, flattened or as a comment. Press where there is no selectable text, such as on a scanned page or a picture, and you draw a box instead. Flattened, a box covers exactly the area you draw. Saved as a comment, a box fits itself to the lines of text under it: one band per line, as tall as the line and as wide as the text inside your box, the way a viewer's own text highlight looks. A strip of the box above, below or between the lines that has no text in it and is at least two lines tall, such as a chart below a line, stays highlighted at the full width of your box. Space beside the text on the same lines, such as a picture next to a short line, is not kept. To hide text rather than mark it, use Redact PDF.",
    },
    {
      q: "Can I underline or strike through text?",
      a: `Yes. Underline and Strikethrough sit beside Highlight in the Mark up group and are placed the same way. Select one and the panel's Style menu turns it into a ${styleChoices} mark. Flattened, the line is drawn into the page; saved as comments, each is a standard underline, strikeout or squiggly annotation, fitted to the lines of text under it as a highlight is, which other PDF apps list in their comment panel.`,
    },
    {
      q: "Can I add a sticky-note comment with my name on it?",
      a: "Yes. Comment, in the Mark up group, drops a small note icon where you click and opens a box for your words; other PDF apps show the icon on the page and open the words in a popup when it is clicked, and list it in their comment panel. Type a name in Your name on comments (optional), beside Apply & download, and every comment you save carries it as its author; leave it blank and no author is written. The name is kept in this browser for next time and is not sent anywhere. There are no reply threads here.",
    },
    {
      q: "Can I take a markup out after saving?",
      a: "Saved as comments, yes: each highlight, drawing, note, shape and line is its own annotation, which a PDF app that edits comments can select and delete. Flattened, only with an editor that can change page content, because each markup is drawn into the page like ink rather than stored as a separate object. Before you apply, any markup can be selected and deleted, or undone, either way. Keep the original if you may want an unmarked copy.",
    },
    {
      q: "Does annotating change anything else in my PDF?",
      a: "Unless you turn, insert, delete or reorder pages in the page list, pages keep their count, size and rotation, and their text and images; the file keeps its bookmarks, form fields, existing annotations, title and author. What does change on an ordinary PDF: Creator and Producer both become this site's name, and an existing digital signature will no longer validate, because pdf-lib writes out a whole new file rather than appending to the signed one. A PDF whose author restricted changes is the exception: its original bytes are kept and the comments are appended after them, as an update under the author's own encryption. Markups sit on top of the page's own content, later ones over earlier ones.",
    },
    {
      q: "Is my document uploaded?",
      a: `No. The PDF is read, marked and saved by code running in this tab. The only files the tool itself fetches are pdf.xyz's own scripts and, when a note goes beyond the Western European character set, a Noto typeface from the /fonts/ folder on this same site: ${formatBytes(smallestPack.bytes)} for ${smallestPack.label} up to ${formatBytes(largestPack.bytes)} for ${largestPack.label}. That typeface is subset, so the finished PDF carries only the glyphs your notes use; notes in the built-in font embed no font file at all.`,
    },
  ],

  relatedGuides: [],
};

export default content;
