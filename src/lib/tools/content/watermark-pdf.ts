import type { ToolContent } from "./types";
import { RUNNER_FILE_CEILINGS } from "@/lib/tools/file-ceilings";
import { FONT_PACKS, UNSUPPORTED_SCRIPTS } from "@/lib/pdf/font-packs";

/**
 * The watermark runner's input gate: `SinglePdfRunner` → `useSinglePdf` →
 * `validatePdfFile(file)` with its default cap, which is the constant
 * `RUNNER_FILE_CEILINGS.watermark` names. Converted the way
 * `toolFileCeilingMb` converts it, so the page and the refusal agree.
 */
const CEILING_MB = Math.round(RUNNER_FILE_CEILINGS.watermark / (1024 * 1024));

const listFormat = new Intl.ListFormat("en", { type: "conjunction" });

/**
 * Scripts that need a downloaded Noto face, read from the shipped font packs
 * rather than typed: pack labels such as "Latin, Greek, Cyrillic and
 * Devanagari" are split into single names, and Latin is dropped because plain
 * Western text is drawn with the built-in standard face (accented Latin beyond
 * that set is named separately in the copy).
 */
const EXTRA_SCRIPTS = listFormat.format([
  ...new Set(
    FONT_PACKS.flatMap((pack) => pack.label.split(/, | and /)).filter(
      (name) => name !== "Latin",
    ),
  ),
]);

/** Scripts refused because layout is left-to-right only, from the refusal table. */
const RTL_REFUSED = listFormat.format(
  UNSUPPORTED_SCRIPTS.filter((s) => /right to left/.test(s.reason)).map(
    (s) => s.name,
  ),
);

/**
 * One script refused only because no face ships for it, taken from the same
 * table, so the example goes away the day that face is added.
 */
const NO_FACE_EXAMPLE =
  UNSUPPORTED_SCRIPTS.find((s) => /^no .* face is shipped$/.test(s.reason))
    ?.name ?? "a script with no shipped face";

/*
 * Behaviour claims below were checked on 2026-09-27 by running `addWatermark`
 * (src/lib/pdf/watermark.ts) on a generated two-page PDF with a title, an
 * author, a filled text field and one page carrying /Rotate 90:
 *   - output kept 2 pages, rotations [0, 90], title and author, the field
 *     "name" and its typed value (the form was not flattened);
 *   - the file came out as `Quarterly Report-watermarked.pdf`;
 *   - Arabic text was refused with the right-to-left message, and blank text
 *     with "Enter the watermark text to stamp.".
 * A second probe the same day (fonts read from node_modules through
 * `setFontByteSource`, the TTFs the copy step ships): Hebrew was refused with
 * the right-to-left reason, Thai with "no Thai face is shipped", "Łódź" was
 * stamped through the Noto path, and "CONFIDENTIAL — Ünïcödé" through the
 * built-in face.
 * Read from the code, not measured: the mark is `page.drawText` on every page
 * (no page picker, no position control, no image input, no tiling, no fit-to-
 * width), centred by `placeCenteredStamp` on `page.getSize()`, which pdf-lib
 * reads from the MEDIA box, so a CropBox set by Crop PDF (crop.ts only calls
 * `setCropBox`) is ignored. The tilt adds the page's /Rotate. `stampProducer`
 * rewrites Producer and Creator, and `doc.save()` writes the whole file anew
 * after new page content is appended, so an existing signature's byte range no
 * longer matches. The runner has no preview, and "Start over"
 * clears the loaded file (`onReset` = `clear` in useSinglePdf).
 * JPG to PDF / PNG to PDF paint a full-page white rectangle under the image
 * (image-to-pdf.ts), so their output is opaque when used as an overlay.
 * Overlay / Stamp has its own Opacity slider (10-100 in overlay-runner.tsx)
 * and, for a multi-page overlay, "First page on all" or "Cycle pages", so the
 * FAQ says "a page from a second PDF" and "washes them out", not "hides".
 * The slider bounds (opacity, rotation, font size) are inline literals in
 * watermark-runner.tsx with no exported constant, so this copy names the
 * controls and does not state their ranges.
 */
const content: ToolContent = {
  slug: "watermark-pdf",

  seoTitle: "Watermark PDF — Add Text Watermark, No Upload",

  metaDescription:
    "Stamp CONFIDENTIAL, DRAFT or your own words diagonally across every PDF page, with opacity, angle, size and color controls. Your PDF stays in your browser.",

  intro: [
    `Add Watermark writes one line of text diagonally across the middle of every page of a PDF: CONFIDENTIAL, DRAFT, SAMPLE or a recipient's name. The Text field starts with CONFIDENTIAL typed in, and four controls shape the mark: Opacity, Rotation and Font size sliders, plus a Gray, Red or Blue color. Each page is measured on its own, so in a document mixing portrait and landscape sheets every mark lands in the middle of its page, and on pages saved with a rotation flag the angle is corrected so the diagonal leans the same way as on upright pages.`,
    `Your browser does the stamping, using pdf-lib, and the PDF never leaves the tab. Western European text, accents like é and ü included, is set in a font built into the PDF format. Letters outside that set, such as a Polish Ł, and ${EXTRA_SCRIPTS} text first make the page download the matching Noto typeface, served by pdf.xyz: the font travels to you, the document stays put. ${RTL_REFUSED} stop the run with an error that lists the characters, rather than being stamped with the letters in reverse order. The page takes a single PDF of up to ${CEILING_MB} MB at a time, and a password-protected one has to go through Unlock PDF before it will open here.`,
    `The mark is real text drawn over each page's content. Page order and rotation, the title and author, and fillable form fields with their typed values all come through, and the fields stay editable; a field's own box is drawn above the page, so a filled one can cover part of the mark. The saved copy names pdf.xyz as its producer and creator, and because the saved file is rebuilt around new page content, a digital signature on the original stops validating in the watermarked copy.`,
  ],

  useCases: [
    {
      title: "Flag a working draft",
      body: "Stamp DRAFT in red before a contract or proposal goes round for comments, so nobody files the unsigned version as the final one.",
    },
    {
      title: "Put the recipient's name on their copy",
      body: 'Typing a line such as "Prepared for Northwind — do not forward" on every page tells the reader who the copy was meant for and makes a forwarded copy obvious at a glance.',
    },
    {
      title: "Share a readable sample",
      body: "A course pack, report or design portfolio can go out marked SAMPLE at low opacity: prospective buyers can read every page, but a clean copy is not what they receive.",
    },
    {
      title: "Label HR and finance paperwork without handing it over",
      body: "Payslips, offer letters and board packs are files you would rather not upload anywhere. The stamping runs in the tab, so marking them CONFIDENTIAL does not cost you the confidentiality.",
    },
  ],

  steps: [
    {
      title: "Choose your PDF",
      body: 'Drag one PDF onto the dashed box that says "Drop your PDF here, or browse"; clicking its browse link opens a file picker instead. When it has been read, the file name, page count and file size appear in a bar above the Watermark section.',
    },
    {
      title: "Type the watermark text",
      body: "In the Watermark section, replace CONFIDENTIAL in the Text field with your own wording. Add watermark cannot be pressed while that field is empty or holds only spaces.",
    },
    {
      title: "Set the appearance",
      body: "Under Appearance, drag Opacity for how faint the mark is, Rotation for its angle (positive runs uphill from lower left, negative runs downhill, zero lies flat) and Font size in points, then pick Gray, Red or Blue.",
    },
    {
      title: "Stamp and download",
      body: "Press Add watermark. The result panel shows how many pages were stamped and the new size; Download watermarked PDF saves a copy with -watermarked added to the name.",
    },
  ],

  faqs: [
    {
      q: "Can I use a logo or image as the watermark?",
      a: "Not here: Add Watermark stamps text only. Edit PDF places a PNG or JPG with its own Opacity slider, one page at a time. Overlay / Stamp lays a page from a second PDF over every page, also with an Opacity slider, so a logo works there when it sits on a transparent background. A page made with JPG to PDF or PNG to PDF does not: those tools paint the whole page white behind the picture, so at full opacity it covers your pages and at lower opacity it washes them out.",
    },
    {
      q: "Can I watermark only some pages, or move the mark off-center?",
      a: "No. The text goes on every page, centered, and the only placement control is the angle. For wording along the top or bottom edge, Header & Footer does that; to mark only part of a document, split that part off, watermark it and merge the pieces back.",
    },
    {
      q: "Can someone remove the watermark?",
      a: "It is written into the page content, not added as a comment, so a viewer's comments toggle cannot hide it. But the words are selectable text, and an editor that edits page content can delete them: treat a watermark as a label and a deterrent, not protection.",
    },
    {
      q: "Which languages can the watermark text be in?",
      a: `Plain Western European text, extended Latin, plus ${EXTRA_SCRIPTS}. Anything beyond plain Western text is drawn from a downloaded Noto font in its regular weight, so it is not bold like a Western mark. ${RTL_REFUSED} are refused because lines are set left to right. ${NO_FACE_EXAMPLE} and other scripts with no shipped font are refused too, and one line cannot mix two downloaded faces, such as Bengali with Chinese.`,
    },
    {
      q: "Why is my watermark cut off or off-center?",
      a: "The text is not shrunk to fit, so a long line at a large Font size runs off the page and is clipped. Centering uses the full sheet: on a page trimmed with Crop PDF, which hides margins rather than removing them, the mark can sit off-center. There is no preview, so press Start over, choose the file again and lower the size or shorten the text.",
    },
  ],

  // Empty on purpose: no guide in src/lib/guides/catalog.ts covers stamping
  // or watermarking, and the type asks for guides that genuinely cover it.
  relatedGuides: [],
};

export default content;
