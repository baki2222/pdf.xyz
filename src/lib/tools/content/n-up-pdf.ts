import type { ToolContent } from "./types";
import { RUNNER_FILE_CEILINGS } from "@/lib/tools/file-ceilings";
import { N_UP_COUNTS, N_UP_RTL_LABEL, N_UP_SHEETS } from "@/lib/pdf/n-up";

// The byte ceiling the n-up runner's file gate refuses above.
const MAX_MB = Math.round(RUNNER_FILE_CEILINGS["n-up"] / (1024 * 1024));
const COUNTS = `${N_UP_COUNTS.slice(0, -1).join(", ")} or ${N_UP_COUNTS.at(-1)}`;
/** The Sheet size chips, labelled as the runner draws them. */
const PAPER = N_UP_SHEETS.filter((s) => s.size).map((s) => s.label);
const PAPER_NAMES = `${PAPER.slice(0, -1).join(", ")} or ${PAPER.at(-1)}`;
const SOURCE_SHEET = N_UP_SHEETS.find((s) => s.id === "source")!.label;
/**
 * "up to 16": the most pages per sheet the runner offers. Not "2 to 16",
 * which reads as every count in between (n-up.test.ts holds this).
 */
const RANGE = `up to ${N_UP_COUNTS.at(-1)}`;

const content: ToolContent = {
  slug: "n-up-pdf",

  seoTitle: "N-up PDF — Multiple Pages per Sheet, No Upload",

  metaDescription: `Put ${RANGE} PDF pages on each ${(["a4", "letter", "a3"] as const).map((id) => N_UP_SHEETS.find((s) => s.id === id)!.label).join(", ")} or other sheet, ordered across or down, with margins and optional borders. Runs in your browser; no upload.`,

  intro: [
    `Multiple Pages per Sheet, also called n-up, shrinks several pages of a PDF onto each sheet of a new PDF: ${COUNTS} to a sheet. It is the print dialog's pages-per-sheet setting, saved as a file, so you can send it, check it on screen, or print it on any printer without hunting for that setting.`,
    `The sheet can be ${PAPER_NAMES}, or "${SOURCE_SHEET}" to make each sheet the size of your first page. Auto orientation picks portrait or landscape, whichever draws the pages largest: two portrait pages sit side by side on a landscape sheet, four fill a portrait sheet in a two-by-two grid. Pages fill the sheet across, then down, like reading a page of text, or down, then across, like newspaper columns. Each page is scaled to fit its cell with its proportions kept, and a page shown turned in a reader lands on the sheet the same way up. A margin keeps space at the sheet's edges and between the pages, and a thin border can outline each one.`,
    `It runs in your browser with pdf-lib; the PDF is not uploaded. The file gate refuses PDFs over ${MAX_MB} MB. Pages are placed as vector drawings, not pictures, so text stays sharp and selectable at any zoom. Filled form fields and stamps are drawn on the sheet as they print, a layer hidden in the original stays hidden, but links and form fields are no longer clickable or editable there.`,
  ],

  useCases: [
    {
      title: "Printing slides as handouts",
      body: "A 30-slide presentation exported to PDF prints on 30 sheets. Six to a sheet, ordered across then down, it fits on five, readable enough to follow along; eight to a sheet fits it on four.",
    },
    {
      title: "Saving paper on drafts for review",
      body: "Two pages side by side on a landscape sheet halves the paper for a long draft, and the text stays big enough to mark up with a pen.",
    },
    {
      title: "Contact-sheet overviews",
      body: "Nine or sixteen pages to a sheet gives a quick visual overview of a long document, a portfolio or a set of scans, to spot the page you are looking for.",
    },
    {
      title: "Index cards and small notes",
      body: "Lay four small pages on one A4 or Letter sheet, add borders, and cut along them after printing. For a proof of an A4 document at full size, put four pages on an A3 sheet.",
    },
  ],

  steps: [
    {
      title: "Open the PDF",
      body: `Drop the PDF on the box or browse for it; it takes one file up to ${MAX_MB} MB. Its page count shows next to Pages per sheet with how many sheets that makes.`,
    },
    {
      title: "Choose how many pages per sheet",
      body: `Pick ${COUNTS} per sheet, then the Sheet size (${PAPER_NAMES}, or "${SOURCE_SHEET}") and Orientation; Auto chooses whichever draws the pages largest.`,
    },
    {
      title: "Set the order and spacing",
      body: `Under Order choose Across, then down or Down, then across. Pick a Margin of None, Small or Large, and tick “Draw a thin border around each page” if you want outlines. For a document read from right to left, tick “${N_UP_RTL_LABEL}”.`,
    },
    {
      title: "Create and download",
      body: "Press “Create sheets”. The result shows how many pages went onto how many sheets, the grid used and the file size. Press “Download PDF” to save it.",
    },
  ],

  faqs: [
    {
      q: "Is my PDF uploaded to put several pages on one sheet?",
      a: "No. The sheets are made in your browser tab and saved on your device; the PDF is not sent to pdf.xyz.",
    },
    {
      q: "Is the text still sharp and searchable on the sheets?",
      a: "Yes. Each page is placed as its own vector drawing, scaled down, not turned into an image, so text stays selectable and sharp when you zoom in. What changes is its printed size: at nine to a sheet body text becomes small, and at sixteen it is for an overview rather than reading.",
    },
    {
      q: "What happens to links, form fields and comments?",
      a: "Anything set to print is drawn onto the sheet as it prints (a comment or stamp set to show on screen only is left off, as printing the original would leave it), so a filled form or a stamp looks the same on paper, including a value filled in by a tool that left the drawing to the viewer (a value that has no drawing of its own and cannot be drawn here, such as Bengali in a form whose font lacks it, is named on the result instead), but they stop being interactive: a link on a sheet does not open and a field cannot be edited. Keep the original for anything that has to stay clickable.",
    },
    {
      q: "What order are the pages placed in?",
      a: `Across, then down fills each row from left to right and then moves to the next row, the way you read. Down, then across fills each column from top to bottom and then moves right. When the last sheet is not full, its remaining cells are left empty. Tick “${N_UP_RTL_LABEL}” and both orders run from the right instead: page one sits top right and page two to its left, so a right-to-left document reads the right way round.`,
    },
    {
      q: "Can I mix page sizes in one file?",
      a: "Yes. Every page is scaled on its own to fit its cell, with its proportions kept, so a landscape page among portrait ones is simply drawn smaller in its cell. Auto orientation is decided from the first page.",
    },
  ],

  relatedGuides: ["how-to-print-multiple-pages-per-sheet"],
};

export default content;
