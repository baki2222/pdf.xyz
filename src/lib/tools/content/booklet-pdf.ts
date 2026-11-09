import type { ToolContent } from "./types";
import { RUNNER_FILE_CEILINGS } from "@/lib/tools/file-ceilings";
import {
  BOOKLET_BACK_COVER_LABEL,
  BOOKLET_BINDINGS,
  BOOKLET_DOUBLE_LABEL,
  BOOKLET_FLIPS,
  BOOKLET_RESULT_TITLE,
  BOOKLET_RTL_LABEL,
  BOOKLET_RUN_LABEL,
  BOOKLET_SHEETS,
  DEFAULT_BOOKLET_OPTIONS,
  bookletHalves,
  bookletOrder,
  bookletPageSlots,
  bookletSheetSize,
  type BookletSide,
} from "@/lib/pdf/booklet";
import { N_UP_MARGINS } from "@/lib/pdf/n-up";

// The byte ceiling the n-up runner's file gate refuses above (Booklet
// shares that runner kind).
const MAX_MB = Math.round(RUNNER_FILE_CEILINGS["n-up"] / (1024 * 1024));

const list = (items: readonly string[], last: "or" | "and") =>
  `${items.slice(0, -1).join(", ")} ${last} ${items.at(-1)}`;

const label = <T extends { id: string; label: string }>(
  table: readonly T[],
  id: T["id"],
) => table.find((t) => t.id === id)!.label;

/** The Sheet size chips, labelled as the runner draws them. */
const PAPER = BOOKLET_SHEETS.filter((s) => s.size).map((s) => s.label);
const PAPER_NAMES = list(PAPER, "or");
const DEFAULT_SHEET = label(BOOKLET_SHEETS, DEFAULT_BOOKLET_OPTIONS.sheet);
const LEFT = label(BOOKLET_BINDINGS, "left");
const SHORT = label(BOOKLET_FLIPS, "short");
const LONG = label(BOOKLET_FLIPS, "long");
const MARGIN_NAMES = list(
  N_UP_MARGINS.map((m) => m.label),
  "or",
);
const DEFAULT_MARGIN = label(N_UP_MARGINS, DEFAULT_BOOKLET_OPTIONS.margin);

/**
 * The worked example: a 10-page PDF, computed by the same function the tool
 * runs, so the page states the order the file will have.
 */
const EXAMPLE_PAGES = 10;
const EXAMPLE = bookletOrder(EXAMPLE_PAGES, DEFAULT_BOOKLET_OPTIONS);
const EXAMPLE_SLOTS = bookletPageSlots(EXAMPLE_PAGES);
const cell = (p: number | null) => (p === null ? "blank" : `${p}`);
const sideText = (s: BookletSide) =>
  `sheet ${s.sheet + 1} ${s.face} ${cell(s.left)} and ${cell(s.right)}`;
const EXAMPLE_TEXT = list(EXAMPLE.map(sideText), "and");

/**
 * How large a page is drawn on the default sheet with the default margin:
 * an upright page of the same paper, and the same page turned landscape.
 */
const DEFAULT_PAPER = BOOKLET_SHEETS.find(
  (s) => s.id === DEFAULT_BOOKLET_OPTIONS.sheet,
)!.size!;
const portraitPage = {
  width: Math.min(DEFAULT_PAPER.width, DEFAULT_PAPER.height),
  height: Math.max(DEFAULT_PAPER.width, DEFAULT_PAPER.height),
};
const landscapePage = {
  width: portraitPage.height,
  height: portraitPage.width,
};
const [half] = bookletHalves(
  bookletSheetSize(DEFAULT_BOOKLET_OPTIONS.sheet, portraitPage),
  N_UP_MARGINS.find((m) => m.id === DEFAULT_BOOKLET_OPTIONS.margin)!.points,
);
const percentIn = (page: { width: number; height: number }) =>
  Math.round(
    Math.min(half!.width / page.width, half!.height / page.height) * 100,
  );
const PORTRAIT_PCT = percentIn(portraitPage);
const LANDSCAPE_PCT = percentIn(landscapePage);

const content: ToolContent = {
  slug: "booklet-pdf",

  seoTitle: "PDF Booklet Maker — Print as a Booklet, No Upload",

  metaDescription: `Put a PDF's pages in booklet order, two to a side on landscape ${list(PAPER.slice(0, 2), "or")} sheets, to print on both sides, fold and staple. Runs in your browser; no upload.`,

  intro: [
    `PDF Booklet Maker reorders a PDF's pages for a folded booklet. Each landscape sheet holds two pages on each side, and the pages are placed so that once the sheets are printed on both sides, stacked in order, folded in half and stapled along the fold, the booklet reads from the first page to the last.`,
    `A booklet needs a multiple of 4 pages, because every sheet carries four. When yours has another count, blank pages are added at the end to make up the difference, and only as many as that takes. Tick “${BOOKLET_BACK_COVER_LABEL}” to put those blanks before your last page instead, so it stays on the outside. For example, a ${EXAMPLE_PAGES}-page PDF becomes ${EXAMPLE_SLOTS} pages on ${EXAMPLE_SLOTS / 4} sheets: ${EXAMPLE_TEXT}.`,
    `It runs in your browser with pdf-lib; the PDF is not uploaded. The file gate refuses PDFs over ${MAX_MB} MB. Pages are placed as vector drawings, not pictures, so text stays sharp. Filled form fields and stamps show as they look, but links and form fields are no longer clickable or editable in the booklet.`,
  ],

  useCases: [
    {
      title: "A zine or a small magazine",
      body: `Lay out a zine as ordinary pages, one after another, and let the tool work out which page goes where. Print it on ${DEFAULT_SHEET} sheets, fold the stack and staple it: each page ends up on half a sheet.`,
    },
    {
      title: "Programmes and orders of service",
      body: "An eight-page event programme prints on two sheets. With the back-cover option, a seven-page programme keeps its last page on the back instead of a blank.",
    },
    {
      title: "Manuals and handouts",
      body: "A short manual reads more easily as a booklet than as a stapled corner, and each page is printed at half the sheet, which suits a pocket guide.",
    },
    {
      title: "Books read from right to left",
      body: `For Arabic, Hebrew or manga, set Binding to ${BOOKLET_RTL_LABEL}: the booklet opens from the other side, with the pages placed to match.`,
    },
  ],

  steps: [
    {
      title: "Open the PDF",
      body: `Drop the PDF on the box or browse for it; it takes one file up to ${MAX_MB} MB. Under Page order, the tool lists which pages go on each side of each sheet, and how many blanks are added.`,
    },
    {
      title: "Choose the sheet and binding",
      body: `Under Sheet size, pick a paper (${PAPER_NAMES}, always turned landscape) or ${BOOKLET_DOUBLE_LABEL}. Under Binding, keep ${LEFT} for most books; ${BOOKLET_RTL_LABEL} is for books read from right to left.`,
    },
    {
      title: "Match your printer",
      body: `Under Flip choose the edge your printer turns the paper on when it prints both sides: ${SHORT} or ${LONG}. Pick a Margin of ${MARGIN_NAMES}, and tick “${BOOKLET_BACK_COVER_LABEL}” if you want it.`,
    },
    {
      title: "Create, print and fold",
      body: `Press “${BOOKLET_RUN_LABEL}”. “${BOOKLET_RESULT_TITLE}” shows the sheets, the blanks added and the size the pages are drawn at; press “Download PDF”, print it on both sides at actual size, fold the stack in half and staple along the fold.`,
    },
  ],

  faqs: [
    {
      q: "Is my PDF uploaded to make the booklet?",
      a: "No. The booklet is made in your browser tab and saved on your device; the PDF is not sent to pdf.xyz.",
    },
    {
      q: `Should I flip on the ${SHORT.toLowerCase()} or the ${LONG.toLowerCase()}?`,
      a: `Choose the edge your printer's two-sided setting uses. ${SHORT} is the usual setting for booklets on landscape sheets. If you print it and the backs come out upside down, choose ${LONG} and create the booklet again: on ${LONG}, the back of every sheet is drawn turned upside down, so the printer's turn puts it the right way up.`,
    },
    {
      q: "Why were blank pages added?",
      a: `Every sheet holds four pages, two on each side, so a booklet needs a multiple of 4. A PDF with another count gets the fewest blanks that make one, at the end, or just before the last page with “${BOOKLET_BACK_COVER_LABEL}” ticked. A PDF whose count is already a multiple of 4 gets none.`,
    },
    {
      q: "Why are my pages smaller in the booklet?",
      a: `Each page is scaled to fit half the sheet with its proportions kept. On ${DEFAULT_SHEET} with the ${DEFAULT_MARGIN.toLowerCase()} margin, an upright ${DEFAULT_SHEET} page is drawn at ${PORTRAIT_PCT}% of its size; a landscape page has to fit the narrow half, so it shrinks to ${LANDSCAPE_PCT}%. The result says the size your pages were drawn at. ${BOOKLET_DOUBLE_LABEL}, under Sheet size, makes each sheet two of your first page wide, so pages of that size keep their full size.`,
    },
    {
      q: "What happens to links, form fields and comments?",
      a: "Their appearance is drawn onto the booklet, so a filled form or a stamp looks the same, but they stop being interactive: a link does not open and a field cannot be edited. A value that has no drawing of its own and cannot be drawn here is named on the result. Keep the original for anything that has to stay clickable.",
    },
  ],

  relatedGuides: ["how-to-print-multiple-pages-per-sheet"],
};

export default content;
