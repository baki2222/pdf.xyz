import type { ToolContent } from "./types";
import { MAX_PDF_BYTES } from "@/lib/pdf/files";
import { MAX_EDIT_IMAGE_BYTES } from "@/lib/pdf/edit";
import { rasterScaleForDpi } from "@/lib/pdf/pdf-to-image";
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
 *    default, and `RUNNER_FILE_CEILINGS.edit` names the same constant. Imported
 *    from the leaf module rather than through the `@/lib/tools` barrel, so this
 *    file cannot become a module cycle if the barrel ever imports content.
 *  - The image cap is MAX_EDIT_IMAGE_BYTES, the constant both `checkEditImage`
 *    and the runner's "Choose a PNG or JPG image (max N MB)" label read.
 *  - Points per inch is derived the way create-forms and pdf-to-png derive it,
 *    from `rasterScaleForDpi`, rather than typed.
 *  - The scripts named are SUPPORTED_SCRIPTS, the list `embedDrawingFont`
 *    quotes in its own refusal; the right-to-left names are the
 *    UNSUPPORTED_SCRIPTS rows whose stated reason is direction.
 *  - A password-protected PDF is refused when it OPENS: `useSinglePdf` calls
 *    `getPageRotations` → `engine.load` → `loadPdf`, which maps /encrypt/ to
 *    "This PDF is password-protected. Unlock it first, then try again."
 *  - `validateEditOps` checks a text item's ANCHOR point only, never the
 *    extent of the drawn string; boxes, images and both line ends are checked
 *    whole. So "anything that spills off the page is refused" would be false.
 *    `wrapText` flows wrapped lines DOWN from Y with nothing bounding them, and
 *    the Wrap field's max is the page width, not the space right of X.
 *  - `PagePreview` is a white box at the page's aspect ratio with markers for
 *    queued items; it renders none of the document, so the copy calls it an
 *    outline, not a preview of the page.
 *  - `onPickImage` seeds Width/Height from the picture's natural size, scaled
 *    to fit, so "start at the picture's own proportions" is the runner's.
 *  - Non-WinAnsi text loads the coverage chunk and fontkit as code, then the
 *    face from `fontPackUrl`; none of those requests carries document data.
 *  - Sizes come from pdf-lib `getSize()` (the MediaBox), so Y = H is the top
 *    of the full page box, which a CropBox can hide.
 *
 * Probed 2026-09-27 against the real engine (`editPdf` in Node, the shipped
 * Noto TTFs as the font source):
 *  - a Bengali box on page 1 plus a Chinese box on page 2 in one run is
 *    refused ("This text mixes Bengali and Chinese…"); Hebrew is refused by
 *    name; Bengali, Chinese, Japanese and Korean EACH succeed alongside an
 *    English text item in the same run;
 *  - a text field's value and the document title survive an edit;
 *  - a white filled box drawn over "SECRET 12345" leaves that string in the
 *    output's text content as pdf.js extracts it (the hide-not-remove claim);
 *  - a 30 pt line anchored at x=600 on a 612 pt page was accepted, i.e. text
 *    can run past the edge without a refusal.
 *
 * Control labels ("Text", "Box", "Line", "Image", "Page", "X (pt)", "Y (pt)",
 * "Wrap (pt)", "Font size", "Width (pt)", "Height (pt)", "Filled"/"Outline",
 * "Fill opacity", "Outline width", "Opacity", "Start X"…"End Y", "Thickness",
 * "Line"/"Arrow", the swatch names, "Add content", "Add to page",
 * "Apply N edits", "Edited PDF ready", "Download edited PDF") are quoted from
 * `edit-runner.tsx`; the drop box caption is `EditRunner`'s `hint` prop,
 * rendered under `Dropzone`'s title in `runner-kit.tsx`, and "Reading page
 * sizes…" is the runner's placeholder until `getEditPageSizes` resolves. The "-edited" file name suffix is `editedOutputName`.
 */

const MAX_MB = Math.round(MAX_PDF_BYTES / (1024 * 1024));
const IMAGE_MB = Math.round(MAX_EDIT_IMAGE_BYTES / (1024 * 1024));
const POINTS_PER_INCH = Math.round(1 / rasterScaleForDpi(1));

function listOf(items: readonly string[], conjunction = "and"): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1]}`;
}

const scripts = listOf(SUPPORTED_SCRIPTS);
/** The non-Latin faces shipped, by the label a refusal would use. */
const otherAlphabets = listOf(
  FONT_PACKS.filter((pack) => pack.id !== "latin").map((pack) => pack.label),
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

  seoTitle: "Edit PDF — Add Text, Images, Boxes and Lines",

  metaDescription:
    "Add text, PNG or JPG pictures, boxes, lines and arrows to PDF pages at exact coordinates. The editing happens in your browser tab; your PDF is not uploaded.",

  intro: [
    `Edit PDF lays new content over the pages you already have: text, filled or outlined boxes, lines and arrows, or a PNG or JPG picture. Each item is placed by page number and by X and Y values in points (${POINTS_PER_INCH} to the inch), measured from the lower-left corner. A blank outline of the chosen page, drawn to its proportions, marks roughly where each queued item will land; it does not show the page's own content.`,
    "It cannot retype, move or delete words that are already in the file. A white filled box can cover an old phrase so new text sits on top, but the covered words stay in the file, where search and copy still find them. Redact PDF is the tool that removes them, by turning each page into a picture.",
    `Everything runs in your browser tab with pdf-lib, so your PDF is not uploaded. Files up to ${MAX_MB} MB open, each inserted picture may be up to ${IMAGE_MB} MB, and a password-protected PDF is turned away until it has been unlocked. Page count, page sizes, existing text, form fields and the title are kept. Your additions are written into the page content itself, not added as comments or annotations.`,
  ],

  useCases: [
    {
      title: "Complete a form that has no fillable fields",
      body: "On a scanned or flat form there is nothing to click into, so type the name, date and answers as text items at the right spots. A form with real fields is better served by Fill Forms.",
    },
    {
      title: "Patch a wrong figure on a finished document",
      body: "Draw a Filled box with the White swatch over the old number, then type the corrected figure on top. Fine for a typo; not for hiding anything confidential, since the old figure is still in the file beneath the box.",
    },
    {
      title: "Put a logo, stamp or photo on a page",
      body: `Choose a PNG or JPG of up to ${IMAGE_MB} MB; Width (pt) and Height (pt) start at the picture's own proportions, and lowering Opacity lets the page show through. GIF and WebP pictures are not accepted.`,
    },
    {
      title: "Write a caption in another script",
      body: `A ${otherAlphabets} caption is drawn with a matching Noto font, and an English label elsewhere in the same batch is drawn with that font too instead of being refused.`,
    },
  ],

  steps: [
    {
      title: "Open your PDF",
      body: `Drag one PDF onto the box captioned “One PDF · edited locally in your browser”, or click it to choose one. An empty file, a non-PDF or anything over ${MAX_MB} MB is refused before it is read. Then the Add content panel appears, showing “Reading page sizes…” until it can take edits.`,
    },
    {
      title: "Pick Text, Box, Line or Image",
      body: "Set Page, then X (pt) and Y (pt), or Start X, Start Y, End X and End Y for a line. Text adds Wrap (pt), a Text box and Font size. Box adds Width (pt) and Height (pt), then Filled with a Fill opacity slider or Outline with an Outline width slider. Image adds a PNG or JPG picker, Width (pt), Height (pt) and Opacity. Line adds Thickness and, under Arrowhead, Line or Arrow. The swatches, Black through Violet, colour everything except pictures.",
    },
    {
      title: "Press Add to page",
      body: "The item joins a list, with a bin button to remove it, and shows on that page's outline. A box, picture or line end that falls off the page is refused with a message. Text is checked only at its starting point, so a long line can run past the right edge and wrapped lines past the bottom; a Wrap (pt) no wider than the space right of X keeps it in.",
    },
    {
      title: "Apply the edits and download",
      body: "The Apply button counts the queued edits. When “Edited PDF ready” appears, Download edited PDF saves a copy named after yours, with “-edited” before the .pdf.",
    },
  ],

  faqs: [
    {
      q: "Can I change the existing text in my PDF?",
      a: "No. It adds content on top and leaves the existing words alone; a white box with new text over it handles a small visible fix. To rewrite text, PDF to Word gives an editable document, though that tool uploads the file to pdf.xyz's secure worker.",
    },
    {
      q: "Does my PDF leave my computer while I edit it?",
      a: "No. The PDF and any picture you add are combined inside your browser tab. Only when a text item uses characters outside the basic Western set does the page download a Noto font from pdf.xyz's own /fonts/ path, plus the code that embeds it; those requests ask for files by name and carry nothing from your document.",
    },
    {
      q: "Which languages can I type onto a page?",
      a: `Text can be written in the ${scripts} scripts.${rtlSentence} The font is chosen once for every text item in the queue, so Bengali on page 1 and Chinese on page 2 stop Apply with a message naming both, even though each works alone. Put one of them on in a first pass, then open the downloaded file here again for the second.`,
    },
    {
      q: "Does a white box remove what is underneath?",
      a: "No. It paints over the area; the text or image below stays in the file, where search, copy and paste or an image extractor can still reach it. When an account number or a name must be gone, use Redact PDF.",
    },
    {
      q: "How do I find the right X and Y values?",
      a: "Larger Y values sit higher. A line above the fields reads “Page N is W × H pt” for the chosen page, and Y = H is the top of that full page box; a file cropped to a smaller visible area can show its top edge lower. For text, Y is the baseline of the first line. On a page stored with a rotation setting, positions are measured on the unrotated page, so new content turns with it.",
    },
  ],

  relatedGuides: ["how-to-convert-pdf-to-word", "how-to-fill-out-a-pdf-form"],
};

export default content;
