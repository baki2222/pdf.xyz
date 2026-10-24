import type { ToolContent } from "./types";
import { MAX_PDF_BYTES } from "@/lib/pdf/files";
import { MAX_EDIT_IMAGE_BYTES } from "@/lib/pdf/edit";
import { MAX_ZOOM, MIN_ZOOM } from "@/lib/pdf/editor/geometry";
import {
  EDITOR_FONTS,
  EDITOR_FONT_LABEL,
  NUDGE_BIG_PT,
  NUDGE_PT,
} from "@/lib/pdf/editor/model";
import {
  FONT_PACKS,
  SUPPORTED_SCRIPTS,
  UNSUPPORTED_SCRIPTS,
} from "@/lib/pdf/font-packs";

/**
 * Facts this copy leans on, each read from the code that makes it true:
 *
 *  - The PDF cap is MAX_PDF_BYTES: `EditRunner` loads through
 *    `SinglePdfRunner` → `useSinglePdf` → `validatePdfFile(file)` with its
 *    default, and `RUNNER_FILE_CEILINGS.edit` names the same constant.
 *  - The picture cap is MAX_EDIT_IMAGE_BYTES: the editor's `onPickImage`
 *    refuses through `checkEditImage`, and its picker's label names it.
 *  - Pages are drawn by pdf.js (`editor/page-render.ts`) in the frame a
 *    reader sees — the page's own /Rotate applied, its visible box only —
 *    and every object is stored and exported in that frame
 *    (`editor-export.ts`: y-flip, then `viewToContent`; pinned against
 *    pdf.js's own viewport by `editor/geometry.test.ts` and by
 *    `editor-export.test.ts` on rotated and cropped pages).
 *  - Zoom is MIN_ZOOM–MAX_ZOOM by the buttons, menu, Ctrl+wheel and pinch;
 *    "Fit width" may go lower (`MIN_FIT_ZOOM`), which the copy does not
 *    promise either way.
 *  - Arrow keys nudge by NUDGE_PT, with Shift by NUDGE_BIG_PT
 *    (`wysiwyg-editor.tsx`'s keyboard handler).
 *  - The fonts offered are EDITOR_FONTS. Text a standard face cannot encode
 *    is drawn in the Noto face `embedDrawingFont` picks, PER BOX (one call per
 *    object in `exportEditedPdf`), in its regular weight — the properties
 *    panel says bold/italic apply to Latin-only text. WAS, until 2026-10-24
 *    on this page: "One font is chosen for every text item in the queue",
 *    true of `editPdf`'s batch font and false of the editor, where a Bengali
 *    box and a Chinese box on one page each get their face
 *    (`editor-export.test.ts`). A single box mixing two such scripts is still
 *    refused by `embedDrawingFont` ("This text mixes …").
 *  - Whiteout is a white filled rectangle; the covered text stays
 *    extractable (`editor-export.test.ts`, "covers but does not remove").
 *  - Existing text and the original content stream survive
 *    (`tool-page-content.test.ts`); a form field's value and the document
 *    title survive (`editor-export.test.ts`).
 *  - Non-WinAnsi text loads the coverage chunk and fontkit as code, then the
 *    face from `fontPackUrl` (`loadPreviewFace` for the on-screen preview,
 *    the same cached bytes for the export); none of those requests carries
 *    document data.
 *  - Control names are the toolbar's (`TOOL_BUTTONS` in `editor/toolbar.tsx`:
 *    Select, Text, Image, Sign, Rectangle, Ellipse, Line, Arrow, Whiteout,
 *    Highlight, Draw, Note, Undo, Redo, Zoom in/out, Fit width) and the run
 *    button "Apply & download"; the result is "Edited PDF ready" with
 *    "Download edited PDF", and the file name gains "-edited"
 *    (`editedOutputName`).
 *
 * HISTORY. Until 2026-10-24 this page described the coordinate form: items
 * placed by page number and X/Y in points from the lower-left, a blank
 * outline for a preview, "Add to page", "Apply N edits". Every one of those
 * sentences was true of the form and is false of the editor that replaced it.
 */

const MAX_MB = Math.round(MAX_PDF_BYTES / (1024 * 1024));
const IMAGE_MB = Math.round(MAX_EDIT_IMAGE_BYTES / (1024 * 1024));
const pct = (z: number) => `${Math.round(z * 100)}%`;

function listOf(items: readonly string[], conjunction = "and"): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1]}`;
}

const scripts = listOf(SUPPORTED_SCRIPTS);
const fonts = listOf(
  EDITOR_FONTS.map((f) => EDITOR_FONT_LABEL[f]),
  "or",
);
/** The non-Latin SCRIPT faces shipped, by the label a refusal would use. */
const otherAlphabets = listOf(
  FONT_PACKS.filter(
    (pack) => pack.role === "script" && pack.id !== "latin",
  ).map((pack) => pack.label),
  "or",
);
const rtlScripts = listOf(
  UNSUPPORTED_SCRIPTS.filter((entry) =>
    /right to left/i.test(entry.reason),
  ).map((entry) => entry.name),
);
const rtlSentence = rtlScripts
  ? ` ${rtlScripts} text is turned away, because the editor sets every line left to right and it would read reversed.`
  : "";

const content: ToolContent = {
  slug: "edit-pdf",

  seoTitle: "Edit PDF — Add Text, Images, Signatures and Shapes",

  metaDescription:
    "Click on a PDF page to add text, pictures, signatures, shapes, highlights and notes, then move and resize them. Runs in your browser; your PDF is not uploaded.",

  intro: [
    "Edit PDF shows every page of your PDF and lets you add to it by clicking on the page: text boxes you type straight onto the page, PNG or JPG pictures, a signature you draw, type or pick from a picture, rectangles, ellipses, lines and arrows, whiteout boxes, highlights, freehand drawing and notes. Anything you place can be selected, dragged, resized from its handles, restyled, copied or deleted, and every step can be undone.",
    "It cannot change, move or delete the words that are already in the file. A whiteout box covers an old phrase so new text can sit on top, but the covered words stay in the file, where search and copy still find them. Redact PDF is the tool that removes them.",
    `Everything runs in your browser tab, so your PDF is not uploaded. Files up to ${MAX_MB} MB open, each picture may be up to ${IMAGE_MB} MB, and a password-protected PDF is turned away until it has been unlocked. Page count, page sizes, existing text, form fields and the title are kept, and rotated or cropped pages are shown and edited the way your viewer shows them. Your additions are written into the page content itself, not added as comments.`,
  ],

  useCases: [
    {
      title: "Fill in a form that has no fillable fields",
      body: "On a scanned or flat form there is nothing to click into, so choose Text, click where the answer goes and type. A form with real fields is better served by Fill Forms.",
    },
    {
      title: "Sign a contract or a letter",
      body: "Choose Sign, then draw your signature, type your name, or pick a picture of your signature, and click where it goes. Drag it into place and resize it from a corner; it is a picture of a signature, not a certificate-based digital signature.",
    },
    {
      title: "Patch a wrong figure on a finished document",
      body: "Draw a Whiteout box over the old number, then type the corrected figure on top. Fine for a typo; not for hiding anything confidential, since the old figure is still in the file beneath the box.",
    },
    {
      title: "Write in another script",
      body: `A ${otherAlphabets} text box is drawn with a matching Noto font, which the page downloads from pdf.xyz the first time it is needed; each box gets its own, so two scripts can sit on one page in separate boxes.`,
    },
  ],

  steps: [
    {
      title: "Open your PDF",
      body: `Drag one PDF onto the box captioned “One PDF · edited locally in your browser”, or click it to choose one. An empty file, a non-PDF or anything over ${MAX_MB} MB is refused before it is read. Every page then appears in a scrolling view, with page thumbnails beside it on a wide screen.`,
    },
    {
      title: "Pick a tool and click on the page",
      body: "Text and Note place a box you type into straight away. Rectangle, Ellipse, Line, Arrow, Whiteout and Highlight draw where you drag, or at a standard size where you click. Draw follows your pointer. Image and Sign ask for a picture or a signature first, then place it where you click.",
    },
    {
      title: "Move, resize and style",
      body: `With Select, click an item to select it, drag it to move it, or drag a handle to resize it; Shift-click adds to the selection, and items snap to the page's edges and centre lines. The arrow keys nudge by ${NUDGE_PT} pt, or ${NUDGE_BIG_PT} pt with Shift. The panel beside the page sets font (${fonts}), size, colour, bold, italic, alignment and line height for text, and outline, fill and opacity for shapes. Undo and Redo, or Ctrl+Z and Ctrl+Shift+Z, step back and forward.`,
    },
    {
      title: "Apply & download",
      body: "Apply & download writes your additions into the PDF and downloads it; “Edited PDF ready” then offers Download edited PDF again. The copy is named after yours, with -edited before the .pdf.",
    },
  ],

  faqs: [
    {
      q: "Can I change the existing text in my PDF?",
      a: "No. It adds content on top and leaves the existing words alone; a whiteout box with new text over it handles a small visible fix. To rewrite text, PDF to Word gives an editable document, though that tool uploads the file to pdf.xyz's secure worker.",
    },
    {
      q: "Does my PDF leave my computer while I edit it?",
      a: "No. The pages are drawn and the PDF is written inside your browser tab, with any picture or signature you add. Only when a text box uses characters outside the basic Western set does the page download a Noto font from pdf.xyz's own /fonts/ path, plus the code that embeds it; those requests ask for files by name and carry nothing from your document.",
    },
    {
      q: "Which languages can I type onto a page?",
      a: `Text can be written in the ${scripts} scripts.${rtlSentence} Each text box is drawn with one font, so a box can hold one of these scripts; put a second one in a box of its own. Text in those scripts uses the regular weight of its Noto font, so bold and italic apply to Latin text only.`,
    },
    {
      q: "Does whiteout remove what is underneath?",
      a: "No. It paints a white box over the area; the text or image below stays in the file, where search, copy and paste or an image extractor can still reach it. When an account number or a name must be gone, use Redact PDF.",
    },
    {
      q: "Does it work on rotated or cropped pages?",
      a: "Yes. Each page is shown the way a PDF viewer shows it, after any rotation setting and with only its visible area, and what you add lands exactly where you placed it and reads upright.",
    },
    {
      q: "How far can I zoom?",
      a: `From ${pct(MIN_ZOOM)} to ${pct(MAX_ZOOM)}, with the zoom buttons, the zoom menu, Ctrl and the mouse wheel, or a two-finger pinch on a touch screen. Fit width sizes the pages to the view.`,
    },
  ],

  relatedGuides: ["how-to-convert-pdf-to-word", "how-to-fill-out-a-pdf-form"],
};

export default content;
