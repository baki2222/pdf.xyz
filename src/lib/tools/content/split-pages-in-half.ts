import type { ToolContent } from "./types";
import { RUNNER_FILE_CEILINGS } from "@/lib/tools/file-ceilings";
import { MIN_CROP_DIMENSION } from "@/lib/pdf/page-geometry";
import {
  SPLIT_DIRECTIONS,
  SPLIT_HALF_RUN_LABEL,
  SPLIT_ORDERS,
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

const content: ToolContent = {
  slug: "split-pages-in-half",

  seoTitle: "Split PDF Pages in Half – Scanned Book Spreads",

  metaDescription:
    "Cut each page of a scanned book or two-page spread into two pages, left and right or top and bottom, keeping covers whole. Runs in your browser, no upload.",

  intro: [
    "Split Pages in Half turns each page of a PDF into two pages. The usual case is a book or magazine scanned open on a flatbed, where every page of the PDF holds two facing pages side by side: after the split, each facing page is a page of its own, in reading order, ready for a phone, an e-reader or a printer. The cut goes down the middle of each page, or across it for a spread laid out one above the other.",
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
      title: "Two-up handouts back to one page each",
      body: `A handout printed two pages to a sheet, one above the other, then scanned. ${TOP_BOTTOM} gives the top page, then the bottom page, for every sheet.`,
    },
  ],

  steps: [
    {
      title: "Open one PDF",
      body: `Drag the PDF into the drop area, or click it to pick the file from your device. It takes one file, up to ${ceilingMb} MB.`,
    },
    {
      title: "Choose the direction and order",
      body: `Under Direction, keep ${LEFT_RIGHT} for a vertical cut down the middle, or choose ${TOP_BOTTOM} for a cut across it. For ${LEFT_RIGHT}, Page order sets which half comes first: ${LEFT_FIRST}, or ${RIGHT_FIRST} for books read right to left.`,
    },
    {
      title: "Choose the pages",
      body: `Under Pages, keep All pages, or choose Selected pages and type a list such as 2-9. Tick Keep the first page whole or Keep the last page whole to leave a cover as it is. Pages that are not split stay whole, in their place.`,
    },
    {
      title: "Split and download",
      body: `Press ${SPLIT_HALF_RUN_LABEL}. The result says how many pages were split and how many pages the new file has. Press Download split PDF to save it with -halved added to its name.`,
    },
  ],

  faqs: [
    {
      q: "Is the hidden half really removed?",
      a: "No. Each half page shows only its own half, but the other half is hidden by the crop box rather than deleted: it stays inside the file, and anyone with the file can bring it back by resetting the crop in another editor. To remove part of a page permanently, use Redact PDF on the original before you split it.",
    },
    {
      q: "Will the split file be twice the size?",
      a: "No. Both halves of a page point at the same stored drawing, so the drawing is kept once, not twice, and the file grows only by a small amount for each extra page.",
    },
    {
      q: "Does it work on rotated or already-cropped pages?",
      a: `Yes. The cut is made on the page as your viewer displays it, after any rotation setting and inside any crop the file already has, so left is the half you see on the left. A page whose halves would end up narrower or shorter than ${MIN_CROP_DIMENSION} points is refused with its page number.`,
    },
    {
      q: "Can I split only some pages?",
      a: "Yes. Choose Selected pages and type the pages to split, such as 2-9 or 3, 5, 7. The pages you leave out are kept whole and stay where they were, between the split ones.",
    },
    {
      q: "Is my PDF uploaded?",
      a: "No. The pages are split in your browser tab and the new file is saved on your device; the PDF is not sent to pdf.xyz.",
    },
    {
      q: "What if the spread is not cut exactly in the middle?",
      a: "The cut is always at the exact middle of the visible page. If a scan sits off centre, crop the margins first with Crop PDF so the gutter between the pages is in the middle, then split.",
    },
  ],

  relatedGuides: [],
};

export default content;
