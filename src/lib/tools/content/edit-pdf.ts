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
 *  - Edit text REMOVES the edited run's glyphs from the content stream and
 *    draws the new words where the run began, in the run's own font when
 *    that font has every character, else the closest standard face (Noto
 *    for other scripts); untouched operators stay byte-identical
 *    (`editor/content-edit.test.ts`, on the saved file through pdf.js). It
 *    edits what pdf.js reads as text: a scan has none, an invisible OCR
 *    layer is not offered, and text nested deeper than one Form XObject,
 *    or vertical text, is refused with a message (`describeRun`).
 *  - Find & replace searches every page's runs as currently edited and
 *    replaces through the same edit (`findMatches`, `replaceAt`).
 *  - Redact removes the glyphs whose boxes overlap the box, rewrites the
 *    covered pixels of images under it (a redacted copy), removes
 *    annotations under it, refuses form fields, inline images and nested
 *    objects under it, and fills the box; lines and shapes are covered,
 *    not removed (`applyContentEdits`).
 *  - Text and objects nobody edited survive (`tool-page-content.test.ts`);
 *    a form field's value and the document title survive
 *    (`editor-export.test.ts`).
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
    "Retype the text in a PDF, find and replace words, redact, and add text, pictures, signatures and shapes. Runs in your browser; your PDF is not uploaded.",

  intro: [
    "Edit PDF shows every page of your PDF and lets you add to it by clicking on the page: text boxes you type straight onto the page, PNG or JPG pictures, a signature you draw, type or pick from a picture, today's date, your initials or name and check marks in one click, links to a web address, an email address, a phone number or another page, fillable form fields, rectangles, ellipses, lines and arrows, whiteout boxes, highlights, freehand drawing and notes. Anything you place can be selected, dragged, resized from its handles, restyled, copied or deleted, and every step can be undone.",
    "Edit text changes the words already in the file: click a line, retype it, and when you apply, the old words are removed from the page and yours are written where they stood, in the line's own font when that font has every letter you typed, otherwise in the closest standard font, which the editor names while you type. Find & replace does the same across every page. Redact removes the text and picture pixels under a box you draw. Whiteout only covers: the words under a whiteout box stay in the file, where search and copy still find them.",
    "Edit text works on real text. A scanned page is a picture of words, so it has nothing to edit — and OCR PDF's text layer is invisible, so Edit text does not offer it either; to change a scan's words, use PDF to Word with its OCR option ticked; text nested inside embedded objects, and vertical text, is refused with a message rather than half-changed. Each line is retyped as one line: it does not reflow a paragraph.",
    `Everything runs in your browser tab, so your PDF is not uploaded. Files up to ${MAX_MB} MB open, each picture may be up to ${IMAGE_MB} MB, and a password-protected PDF is turned away until it has been unlocked. A PDF that opens without a password but whose author restricted changes opens with only what the author allows: filling in its form, and, when the author allows comments, highlights, drawings, notes and shapes saved as comments. The copy you download keeps the author's encryption, restrictions and owner password; enter the owner password in the editor to unlock every tool, and that copy is saved without encryption. Unless you turn, insert, delete or reorder pages in the page list, page count and page sizes are kept; the text you did not edit, form fields and the title are kept too, and rotated or cropped pages are shown and edited the way your viewer shows them. Your additions are written into the page content itself, except links and form fields, which are saved as real links and fillable fields, and highlights, drawings, notes, shapes and lines when you choose Save markups as comments beside Apply & download: those become standard PDF annotations that other PDF apps can select, edit or delete. Whiteout and redaction are always page content.`,
  ],

  useCases: [
    {
      title: "Fill in a form that has no fillable fields",
      body: "On a scanned or flat form there is nothing to click into, so choose Text, click where the answer goes and type; Date, Initials, Name and Check put today's date, your initials, your name or a check mark where you click. A PDF that already has fillable fields shows them on the page, ready to type into.",
    },
    {
      title: "Make a form others can fill in",
      body: "Under Forms, drag out a text field, checkbox, dropdown, radio group or signature field and name it in the panel. They are saved as real form fields, so anyone can fill them in in a PDF reader; only a radio group's option names are written beside its buttons as page text. Field names and choices use the standard PDF alphabet, so Latin letters only.",
    },
    {
      title: "Link to a website or another page",
      body: "Choose Link and drag a box over the words to link. In the panel, type a web address, an email address or a phone number, or pick a page of the file to jump to. The link is saved as a real link, not drawn; links already in the PDF are outlined, ready to change or delete.",
    },
    {
      title: "Sign a contract or a letter",
      body: "Choose Sign, then draw your signature, type your name, or pick a picture of your signature, and click where it goes. Drag it into place and resize it from a corner; it is a picture of a signature, not a certificate-based digital signature.",
    },
    {
      title: "Fix a wrong figure on a finished document",
      body: "Choose Edit text, click the line with the old number and type the right one. The old figure is removed from the file, not hidden under a box.",
    },
    {
      title: "Take a name or an account number out before sharing",
      body: "Choose Redact and drag a box over it. When you apply, the text and picture pixels under the box are removed from the file and the box is filled black or white. Find & replace (Ctrl+F) finds every place a name appears first.",
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
      body: "Edit text outlines every line of the PDF's own text: click one and retype it. Text and Note place a box you type into straight away. Rectangle, Ellipse, Line, Arrow, Whiteout, Redact and Highlight draw where you drag, or at a standard size where you click. Draw follows your pointer. Image and Sign ask for a picture or a signature first, then place it where you click. Date, Initials, Name and Check place one where you click. Link and the Forms tools draw where you drag; then the panel sets where the link goes, or the field's name and choices. Find & replace, or Ctrl+F, searches every page.",
    },
    {
      title: "Move, resize and style",
      body: `With Select, click an item to select it, drag it to move it, or drag a handle to resize it; Shift-click adds to the selection, and items snap to the page's edges and centre lines and to other items' edges and centres; Order in the panel brings an item forward or sends it back. The arrow keys nudge by ${NUDGE_PT} pt, or ${NUDGE_BIG_PT} pt with Shift. The panel beside the page sets font (${fonts}), size, colour, bold, italic, alignment and line height for text, and outline, fill and opacity for shapes. Undo and Redo, or Ctrl+Z and Ctrl+Shift+Z, step back and forward.`,
    },
    {
      title: "Arrange the pages",
      body: "Beside the pages on a wide screen, or under Pages on a smaller one, each thumbnail can be turned a quarter, followed by a new blank page, or deleted, and dragged (or moved with its arrows) into a new order. What you placed on a page goes with it, and each change can be undone.",
    },
    {
      title: "Apply & download",
      body: "Apply & download writes your changes into the PDF and downloads it; “Edited PDF ready” then offers Download edited PDF again. The copy is named after yours, with -edited before the .pdf.",
    },
  ],

  faqs: [
    {
      q: "Can I change the existing text in my PDF?",
      a: "Yes, a line at a time. Choose Edit text, click the line and retype it; when you apply, the old words are removed from the file and the new ones are written where they began. They use the line's own font when it has every character you typed; otherwise the closest standard font is used and the editor says which while you type. A scanned page has no text to change (OCR PDF's invisible text layer is not offered for editing; PDF to Word with its OCR option ticked is the way to edit a scan's words), and text nested inside embedded objects is refused. To rewrite whole paragraphs, PDF to Word gives an editable document, though that tool uploads the file to pdf.xyz's secure worker.",
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
      q: "Does whiteout or Redact remove what is underneath?",
      a: "Whiteout does not: it paints a white box, and the text or image below stays in the file, where search, copy and an image extractor still reach it. Redact does: the text under its box is removed from the page, the pixels of any picture under it are overwritten, and comments under it are deleted. Lines and shapes under the box are covered, not removed. A form field, an inline picture or deeply nested content under a box is refused with a message; Redact PDF, which turns pages into images, handles those. Bookmarks and the document's properties are not changed.",
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

  relatedGuides: [
    "how-to-edit-text-in-a-pdf",
    "how-to-convert-pdf-to-word",
    "how-to-fill-out-a-pdf-form",
  ],
};

export default content;
