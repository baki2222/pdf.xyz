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

/**
 * Note text is drawn with ONE face that `embedStampFont` → `embedDrawingFont`
 * picks for every note in the job, and it refuses — by name — anything no
 * shipped face draws (`refuseUncovered`, which appends each named script's
 * `reason`). The right-to-left names are the UNSUPPORTED_SCRIPTS rows whose
 * reason says so (the regex tolerates "right-to-left"), so the day bidi lands
 * and those rows go, the sentence naming them goes with them. The other named
 * rows are listed as examples of the same refusal.
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

/** Named in a use case; fail the build rather than name a script we dropped. */
const CYRILLIC = "Cyrillic";
if (!SUPPORTED_SCRIPTS.includes(CYRILLIC)) {
  throw new Error(
    `annotate-pdf content names ${CYRILLIC}, which no pack draws`,
  );
}
const rtlClause =
  rtlScripts.length > 0
    ? ` For ${listOf(rtlScripts, "and")} the message adds that the script runs right to left and would come out reversed.`
    : "";

/*
 * All notes in one Apply share a single embedded face. Measured 2026-09-27 by
 * running annotatePdf with a Bengali note and a Japanese note in one list: it
 * was refused with "This text mixes Bengali and Japanese…" (refuseMixedScripts),
 * while Cyrillic + Latin, Bengali + Latin and Japanese + Cyrillic were drawn.
 * `fontPack()` throws on an unknown id, so renaming a pack breaks this import
 * rather than leaving a stale label on the page.
 */
const bengali = fontPack("bengali").label;
const japanese = fontPack("japanese").label;

/** The Noto files a note can trigger, smallest and largest, from FONT_PACKS. */
const packsBySize = [...FONT_PACKS].sort((a, b) => a.bytes - b.bytes);
const smallestPack = packsBySize[0]!;
const largestPack = packsBySize[packsBySize.length - 1]!;

/*
 * Behaviour claims below were checked on 2026-09-27 against
 * src/lib/pdf/annotate.ts, src/lib/pdf/unicode-font.ts, src/lib/pdf/stamp.ts,
 * src/lib/pdf/engine.ts (loadPdf), src/components/tools/runner/annotate-runner.tsx
 * and stamp-controls.tsx (NumberField rounds and clamps on change only), and by
 * running `annotatePdf` under vitest on a generated two-page PDF (Letter, and
 * A4 carrying /Rotate 90) with a title, author, creator, producer, an outline
 * and a filled text field:
 *   - output kept both pages at their sizes and rotation, the title, author,
 *     outline, the form field and page 1's existing /Annots entry;
 *   - Creator AND Producer came back as "pdf.xyz" (stampProducer) and the
 *     modification date as the time of the run (pdf-lib's updateInfoDict on
 *     load) — so "nothing else changes" would be false. Re-probed by the
 *     review pass the same day with tsx: a file with NO CreationDate came back
 *     WITH one (updateInfoDict adds it when absent), so "three things change"
 *     was false too;
 *   - an Arabic note was refused naming the characters and "reversed"; a Thai
 *     note was refused naming "no Thai face is shipped";
 *   - Bengali and Japanese notes in one job were refused as mixed scripts.
 * The signature claim is from pdf-lib's `save()`, which writes a whole new
 * file (no incremental update), so a prior /ByteRange no longer covers the
 * bytes.
 *
 * RE-READ 2026-10-07 at d3263ff7, history kept. This block used to say the
 * /Rotate drawing claim came from drawAnnotation passing no rotation, that only
 * a note's anchor was bounds-checked, and that page sizes were the MEDIA box
 * from `page.getSize()` — and the "X and Y" FAQ told readers exactly that. All
 * three went stale under it: `getAnnotatePageSizes` now returns
 * `displayedSize(pageFrame(page))` (the crop box clipped to the media box,
 * width and height swapped on /Rotate 90 or 270), the readout, input bounds,
 * validation and preview all read it, `toContentSpace` adds the crop box's
 * origin after turning, note glyphs are drawn with `rotate: frame.rotation`
 * so they read upright, and `noteFitIssues` measures every wrapped line with
 * the font Apply will use. Add markup runs that check (`findNoteOverflows`)
 * and Apply repeats it (`annotatePdf` → `refuseIssues`), so a note past the
 * right edge, above the top or below the bottom is refused with its overflow
 * in points (EDGE_EPSILON = 0.5 pt), never drawn clipped.
 * The result panel's "across N pages" is `result.pageCount`, the document's
 * page count, not the number of pages that received a markup.
 */
const content: ToolContent = {
  slug: "annotate-pdf",

  seoTitle: "Annotate PDF — Highlight, Add Notes, No Upload",

  metaDescription:
    "Add highlight bars, outlined boxes, text notes and arrows to a PDF at typed page positions, flattened into the page by your own browser. Nothing is uploaded.",

  intro: [
    `Annotate PDF adds four kinds of markup to an existing document: a translucent Highlight bar, an outlined Box, a free-text Note, and a Line that can end in an arrowhead. You place each one with typed numbers rather than by dragging: a page, then distances in points across and up from the lower-left corner. Markups collect in a list and are applied in one pass. A preview outline drawn to the page's proportions shows where each falls; it is not a picture of the page.`,
    `The whole job runs in your browser: pdf-lib opens, marks and saves the document there, with no upload: the PDF stays on your device. The limit is ${CEILING_MB} MB, and an encrypted PDF will not load, even one a viewer opens without asking for a password. When every note in the job stays within the Western European character set, they are drawn in the built-in Helvetica; otherwise the page fetches a Noto typeface from this site, covering ${noteScripts}. A note with characters none of those faces draws, such as ${refusedExamples}${emojiClause}, stops the export with a message naming them.${rtlClause}`,
    `Markups are drawn as vector content inside the page, so the original text stays selectable and nothing becomes an image. They are therefore not PDF comments: a viewer's comment panel shows nothing to toggle, reply to or delete, and a highlight is a rectangle you position, not a selection that follows the text.`,
  ],

  useCases: [
    {
      title: "Point a colleague at one clause",
      body: "Lay a yellow Highlight over the sentence that matters and run an arrow to it from a margin Note. Because the marks are part of the page, they also show in viewers and printouts that leave comments out.",
    },
    {
      title: "Box the figures on a form or statement",
      body: "A red or blue Box around a total or reference number draws the eye without covering it, because a Box is an outline with no fill.",
    },
    {
      title: "Stamp a short status note",
      body: `A Note such as "Draft, do not circulate" wraps at a width you choose and can be written in ${bengali}, ${CYRILLIC} or ${japanese} as well as English. Every note in one Apply shares a single font, so ${bengali} in one note and ${japanese} in another is refused as mixed scripts: apply one, download, then annotate that file for the other.`,
    },
    {
      title: "Mark the same spot across many pages",
      body: "The form keeps its values after each Add markup, so repeating a box in the same place on other pages means changing the Page number and pressing Add markup again.",
    },
  ],

  steps: [
    {
      title: "Open your PDF",
      body: "Drag a single PDF onto the drop area or click browse. Once it loads, a bar shows its name, page count and size, with the Add markup section below.",
    },
    {
      title: "Choose a markup and a colour",
      body: "Select Highlight, Box, Note or Line and click a swatch: yellow, orange, red, green, blue, violet or black. Beside the swatches, a readout gives the width and height in points of the page named in the Page field.",
    },
    {
      title: "Set its page and position",
      body: "After Page, Highlight and Box take a corner in X (pt) and Y (pt) and a size in Width (pt) and Height (pt), then a Fill opacity slider for Highlight or an Outline width slider for Box. Note takes X (pt), Y (pt) and Wrap (pt), a Note text box and a Font size slider. Line takes a start point (Start X, Start Y), an end point (End X, End Y), a Thickness slider and an Arrowhead choice of Line or Arrow.",
    },
    {
      title: "Add it and check the preview",
      body: "Press Add markup. A shape that would spill off the page, a note whose text would run past an edge, an empty note or a line whose ends coincide is rejected at once with the reason. Accepted markups are listed with a remove button each, and those on the page in the Page field appear on that page's preview outline.",
    },
    {
      title: "Apply and download",
      body: "Press Apply, whose label counts your markups. Annotated PDF ready then gives the markup count, the document's total page count and the new file size; Download annotated PDF saves a copy with -annotated added to the name, and Start over clears the tool.",
    },
  ],

  faqs: [
    {
      q: "Can I highlight text by selecting it, or draw freehand?",
      a: "Neither. There is no drawing canvas and no text selection: a highlight is a coloured rectangle whose corner and size you type, so covering a line of text means matching its position and height. To hide text rather than mark it, use Redact PDF.",
    },
    {
      q: "Can I take a markup out after saving?",
      a: "Only with an editor that can change page content: each markup is drawn into the page like ink rather than stored as a separate object. Keep the original if you may want an unmarked copy.",
    },
    {
      q: "How do I work out the X and Y numbers?",
      a: "Measure in points from the lower-left corner of the page as a viewer shows it: larger X moves right, larger Y moves up, and the top edge is at the page height shown in the readout by the swatches. A rotated or cropped page is measured as displayed. The readout and preview show it turned, its origin is the visible corner of the crop box, and notes on a turned page still read upright. Typing rounds a field to a whole point and stops it at the page's size, and Add markup refuses a shape that still spills over. A note is measured in the font Apply will use. If its text would run past the right edge, rise above the top or run below the bottom, it is refused with the number of points it overflows by. You can then move it, shorten it or narrow its Wrap width.",
    },
    {
      q: "Does annotating change anything else in my PDF?",
      a: "Pages keep their count, size, rotation, text and images, and the file keeps its bookmarks, form fields, existing annotations, title and author. What does change: Creator and Producer both become this site's name, the modification date becomes the moment you pressed Apply (and a creation date is added if the file had none), and an existing digital signature will no longer validate, because pdf-lib writes out a whole new file rather than appending to the signed one. Markups sit on top of the page's own content, later ones in the list over earlier ones.",
    },
    {
      q: "Is my document uploaded?",
      a: `No. The PDF is read, marked and saved by code running in this tab. The only files the tool itself fetches are pdf.xyz's own scripts and, when a note goes beyond the Western European character set, a Noto typeface from the /fonts/ folder on this same site: ${formatBytes(smallestPack.bytes)} for ${smallestPack.label} up to ${formatBytes(largestPack.bytes)} for ${largestPack.label}. That typeface is subset, so the finished PDF carries only the glyphs your notes use; notes drawn in Helvetica embed no font file at all.`,
    },
  ],

  relatedGuides: [],
};

export default content;
