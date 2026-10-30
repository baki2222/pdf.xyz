import type { ToolContent } from "./types";
import { RUNNER_FILE_CEILINGS } from "@/lib/tools/file-ceilings";
import { N_UP_COUNTS } from "@/lib/pdf/n-up";

// The byte ceiling the n-up runner's file gate refuses above.
const MAX_MB = Math.round(RUNNER_FILE_CEILINGS["n-up"] / (1024 * 1024));
const COUNTS = `${N_UP_COUNTS.slice(0, -1).join(", ")} or ${N_UP_COUNTS.at(-1)}`;

const content: ToolContent = {
  slug: "n-up-pdf",

  seoTitle: "N-up PDF — Multiple Pages per Sheet, No Upload",

  metaDescription: `Put ${COUNTS} PDF pages on each A4 or US Letter sheet, ordered across or down, with margins and optional borders. Runs in your browser; no upload.`,

  intro: [
    `Multiple Pages per Sheet, also called n-up, shrinks several pages of a PDF onto each sheet of a new PDF: ${COUNTS} to a sheet. It is the print dialog's pages-per-sheet setting, saved as a file, so you can send it, check it on screen, or print it on any printer without hunting for that setting.`,
    "The sheet can be A4 or US Letter. Auto orientation picks portrait or landscape, whichever draws the pages largest: two portrait pages sit side by side on a landscape sheet, four fill a portrait sheet in a two-by-two grid. Pages fill the sheet across, then down, like reading a page of text, or down, then across, like newspaper columns. Each page is scaled to fit its cell with its proportions kept, and a page shown turned in a reader lands on the sheet the same way up. A margin keeps space at the sheet's edges and between the pages, and a thin border can outline each one.",
    `It runs in your browser with pdf-lib; the PDF is not uploaded. The file gate refuses PDFs over ${MAX_MB} MB. Pages are placed as vector drawings, not pictures, so text stays sharp and selectable at any zoom. Filled form fields and stamps show on the sheet as they look, but links and form fields are no longer clickable or editable there.`,
  ],

  useCases: [
    {
      title: "Printing slides as handouts",
      body: "A 30-slide presentation exported to PDF prints on 30 sheets. Six to a sheet, ordered across then down, it fits on five, readable enough to follow along.",
    },
    {
      title: "Saving paper on drafts for review",
      body: "Two pages side by side on a landscape sheet halves the paper for a long draft, and the text stays big enough to mark up with a pen.",
    },
    {
      title: "Contact-sheet overviews",
      body: "Nine pages to a sheet gives a quick visual overview of a long document, a portfolio or a set of scans, to spot the page you are looking for.",
    },
    {
      title: "Index cards and small notes",
      body: "Lay four small pages on one A4 or Letter sheet, add borders, and cut along them after printing.",
    },
  ],

  steps: [
    {
      title: "Open the PDF",
      body: `Drop the PDF on the box or browse for it; it takes one file up to ${MAX_MB} MB. Its page count shows next to Pages per sheet with how many sheets that makes.`,
    },
    {
      title: "Choose how many pages per sheet",
      body: `Pick ${COUNTS} per sheet, then the Sheet size (A4 or US Letter) and Orientation; Auto chooses whichever draws the pages largest.`,
    },
    {
      title: "Set the order and spacing",
      body: "Under Order choose Across, then down or Down, then across. Pick a Margin of None, Small or Large, and tick “Draw a thin border around each page” if you want outlines.",
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
      a: "Yes. Each page is placed as its own vector drawing, scaled down, not turned into an image, so text stays selectable and sharp when you zoom in. What changes is its printed size: at nine to a sheet, body text becomes small.",
    },
    {
      q: "What happens to links, form fields and comments?",
      a: "Their appearance is drawn onto the sheet, so a filled form or a stamp looks the same, but they stop being interactive: a link on a sheet does not open and a field cannot be edited. Keep the original for anything that has to stay clickable.",
    },
    {
      q: "What order are the pages placed in?",
      a: "Across, then down fills each row from left to right and then moves to the next row, the way you read. Down, then across fills each column from top to bottom and then moves right. When the last sheet is not full, its remaining cells are left empty.",
    },
    {
      q: "Can I mix page sizes in one file?",
      a: "Yes. Every page is scaled on its own to fit its cell, with its proportions kept, so a landscape page among portrait ones is simply drawn smaller in its cell. Auto orientation is decided from the first page.",
    },
  ],

  relatedGuides: [],
};

export default content;
