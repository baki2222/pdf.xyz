import type { ToolContent } from "./types";
import { RUNNER_FILE_CEILINGS } from "@/lib/tools/file-ceilings";
import { SETTINGS_BATCH_TOOLS, batchLimitsSentence } from "@/lib/batch/tools";
import { MIN_CROP_DIMENSION } from "@/lib/pdf/page-geometry";
import {
  BOOKLET_ORDER,
  ONLY_WIDER_LABELS,
  SPLIT_DIRECTIONS,
  SPLIT_HALF_RUN_LABEL,
  SPLIT_ORDERS,
  SPLIT_ORDER_CHOICES,
  SPLIT_POSITION,
} from "@/lib/pdf/split-half";

/**
 * Behaviour claims below were checked against the code on 2026-11-01
 * (src/lib/pdf/split-half.ts, crop.ts `insetBox` / `toContentMargins`,
 * page-frame.ts `visiblePageFrame`, page-copy.ts `assemblePages`,
 * split-half-runner.tsx, single-pdf-runner.tsx) and proved by
 * `split-half.test.ts`, which reads the SAVED file with pdf.js: displayed
 * sizes, rendered pixels of each half against the source's own render on
 * every /Rotate and box shape, text per half, covers, the byte size against
 * a real duplicate, and the refusal of encrypted files.
 */
const ceilingMb = Math.round(
  RUNNER_FILE_CEILINGS["split-half"] / (1024 * 1024),
);
const label = (id: string, list: readonly { id: string; label: string }[]) =>
  list.find((item) => item.id === id)!.label;
const LEFT_RIGHT = label("left-right", SPLIT_DIRECTIONS);
const TOP_BOTTOM = label("top-bottom", SPLIT_DIRECTIONS);
const LEFT_FIRST = label("left-first", SPLIT_ORDERS);
const RIGHT_FIRST = label("right-first", SPLIT_ORDERS);
const TOP_FIRST = label("left-first", SPLIT_ORDER_CHOICES["top-bottom"]);
const BOTTOM_FIRST = label("right-first", SPLIT_ORDER_CHOICES["top-bottom"]);
const BOOKLET = BOOKLET_ORDER.label;
const ONLY_WIDER = ONLY_WIDER_LABELS["left-right"];
const ONLY_TALLER = ONLY_WIDER_LABELS["top-bottom"];

const content: ToolContent = {
  slug: "split-pdf-pages-in-half",

  seoTitle: "Split PDF Pages in Half — Scanned Book Spreads",

  metaDescription:
    "Cut each page of a scanned book or two-page spread into two pages, left and right or top and bottom, keeping covers whole. Runs in your browser, no upload.",

  intro: [
    "Split PDF Pages in Half turns each page of a PDF into two pages. The usual case is a book or magazine scanned open on a flatbed, where every page of the PDF holds two facing pages side by side: after the split, each facing page is a page of its own, in reading order, ready for a phone, an e-reader or a printer. The cut goes down each page, or across it for a spread laid out one above the other, in the middle or wherever you set it.",
    `It runs in your browser with pdf-lib: the PDF is read on your device and not uploaded to pdf.xyz. The size check comes first, so a file over ${ceilingMb} MB is refused without being read. Encrypted PDFs are refused when they are opened, including a file that shows its pages without a password but restricts printing or editing, so remove the protection first.`,
    "Each half is cut from the page as your viewer shows it: the visible area, after any crop the file already has, and after any rotation setting. So on a spread that is stored upright and turned for display, Left page first still gives you the half you see on the left. The halves are made the way Crop PDF crops: each new page is a copy of the original with its crop box, the area a viewer shows, set to one half. Nothing is redrawn, so text stays sharp and selectable and pictures are not re-compressed.",
  ],

  useCases: [
    {
      title: "Single pages from a scanned book",
      body: "A library book scanned two pages at a time reads awkwardly on a phone. Split it, and each page of the book fills the screen on its own.",
    },
    {
      title: "Covers scanned on their own",
      body: `The front and back covers are often scanned as single pages while everything in between is a spread. Tick Keep the first page whole and Keep the last page whole, and only the spreads are split.`,
    },
    {
      title: "Books read right to left",
      body: `For Arabic, Hebrew, Japanese or Persian books, the right-hand page comes first. Choose ${RIGHT_FIRST} and the halves land in the order the book is read.`,
    },
    {
      title: "A folded booklet scanned sheet by sheet",
      body: `A stapled booklet taken apart and scanned one sheet at a time comes out with its pages paired as printed: for 8 pages, 8 and 1, then 2 and 7, 6 and 3, 4 and 5. Choose ${BOOKLET} as the Page order and the halves are put back in reading order, 1 to 8.`,
    },
    {
      title: "Spreads mixed with single pages",
      body: `A scan with plates or inserts as single upright pages among the spreads: tick ${ONLY_WIDER} and only pages wider than they are tall, as your viewer shows them, are split; the single pages stay whole, in their place. For a top and bottom cut the option reads ${ONLY_TALLER}.`,
    },
    {
      title: "Two-up handouts back to one page each",
      body: `A handout printed two pages to a sheet, one above the other, then scanned. ${TOP_BOTTOM} gives the top page, then the bottom page, for every sheet.`,
    },
    {
      title: "Split a whole shelf of scans",
      body: `Add two or more PDFs and they open as a batch list, with one Direction, Page order, Cut position and set of checkboxes for them all. Every page of each file is split, except a cover kept whole or a page the shape option leaves whole; to split only some pages, open one file on its own. Press Split with the number of files and each one is split in turn, in your browser, with nothing uploaded. Download a file from its row, or press “Download all” for ${SETTINGS_BATCH_TOOLS["split-pdf-pages-in-half"].zipName}. ${batchLimitsSentence()}`,
    },
  ],

  steps: [
    {
      title: "Open your PDF",
      body: `Drag the PDF into the drop area, or click it to pick the file from your device. It takes files of up to ${ceilingMb} MB each; two or more open a batch list.`,
    },
    {
      title: "Choose the direction and order",
      body: `Under Direction, keep ${LEFT_RIGHT} for a vertical cut down the middle, or choose ${TOP_BOTTOM} for a cut across it. Page order sets which half comes first: for ${LEFT_RIGHT}, ${LEFT_FIRST}, or ${RIGHT_FIRST} for books read right to left; for ${TOP_BOTTOM}, ${TOP_FIRST} or ${BOTTOM_FIRST}.`,
    },
    {
      title: "Set where to cut",
      body: `Under Where to cut, Cut position starts at ${SPLIT_POSITION.middle}%, the middle. Move it, or drag the dashed line on the picture of the first page to be split, until the line sits in the gap between the two pages.`,
    },
    {
      title: "Choose the pages",
      body: `Under Pages, keep All pages, or choose Selected pages and type a list such as 2-9. Tick Keep the first page whole or Keep the last page whole to leave a cover as it is, and tick ${ONLY_WIDER} to leave single upright pages whole. Pages that are not split stay whole, in their place.`,
    },
    {
      title: "Split and download",
      body: `Press ${SPLIT_HALF_RUN_LABEL}. The result says how many pages were split and how many pages the new file has. Press Download split PDF to save it with -halved added to its name.`,
    },
  ],

  faqs: [
    {
      q: "Is the hidden half really removed?",
      a: "No. Each half page shows only its own half, but the other half is hidden by the crop box rather than deleted: it stays inside the file, and anyone with the file can bring it back by resetting the crop in another editor. To remove part of a page permanently, use Redact PDF on the original before you split it. Because both halves point at the same stored drawing, the file is not twice the size: the drawing is kept once, and each extra page adds only a small page entry.",
    },
    {
      q: "Does it work on rotated or already-cropped pages?",
      a: `Yes. The cut is made on the page as your viewer displays it, after any rotation setting and inside any crop the file already has, so left is the half you see on the left. A page whose halves would end up narrower or shorter than ${MIN_CROP_DIMENSION} points is refused with its page number.`,
    },
    {
      q: "Can I split only some pages?",
      a: "Yes. Choose Selected pages and type the pages to split, such as 2-9 or 3, 5, 7. The pages you leave out are kept whole and stay where they were, between the split ones. To keep single pages whole among the spreads without listing them, tick Only split pages wider than tall.",
    },
    {
      q: "Is my PDF uploaded?",
      a: "No. The pages are split in your browser tab and the new file is saved on your device; the PDF is not sent to pdf.xyz.",
    },
    {
      q: "What if the gap between the pages is not in the middle?",
      a: `Set Cut position, from ${SPLIT_POSITION.min}% to ${SPLIT_POSITION.max}% of the page's width from the left (or of its height from the top for a top and bottom cut), or drag the dashed line on the picture of the page. The picture shows the first page that will be split, so you can see where the cut falls before you press ${SPLIT_HALF_RUN_LABEL}. The same position is used on every page that is split.`,
    },
    {
      q: "Can it put a booklet scanned sheet by sheet back in order?",
      a: `Yes. Choose ${BOOKLET} as the Page order. It is for a folded booklet whose sheets were scanned in order, each showing the two pages printed side by side on it: for 8 pages, 8 and 1, 2 and 7, 6 and 3, 4 and 5. The halves come out 1 to 8. A cover scanned on its own can be kept whole at either end; any other page left whole has no place in that order, so the split is refused with a message.`,
    },
  ],

  relatedGuides: [],
};

export default content;
