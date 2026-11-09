import type { ToolContent } from "./types";
import { RUNNER_FILE_CEILINGS } from "@/lib/tools/file-ceilings";
import {
  VIEWER_LIVE_PAGES,
  VIEWER_MAX_MATCHES,
  VIEWER_MAX_TEXT_ITEMS,
  VIEWER_PRINT_DPI,
  VIEWER_PRINT_MAX_PAGES,
} from "@/lib/pdf/viewer-geometry";
import { VIEWER_LINK_SCHEMES } from "@/lib/pdf/viewer-links";
import { VIEWER_LABELS, VIEWER_ZOOM_RANGE } from "@/lib/pdf/viewer-copy";

/**
 * Behaviour claims below were checked against the code on 2026-11-10
 * (src/lib/pdf/viewer.ts, viewer-geometry.ts, viewer-search.ts,
 * viewer-links.ts, viewer-copy.ts, components/tools/runner/viewer/*,
 * viewer-runner.tsx, single-pdf-runner.tsx) and proved by
 * `viewer.pdfjs.test.ts` (text, links, bookmarks, refusals),
 * `viewer-geometry.test.ts` (canvas cap, visible window, zoom anchoring,
 * print plan), `viewer-search.test.ts`, `viewer-links.test.ts`, the DOM
 * tests in `viewer/pdf-viewer.test.tsx`, the hostile files in
 * src/tests/hostile/pdfjs-guard-bounds.test.ts, and the browser proof in
 * e2e/client-proof/cases.ts (download bytes equal the input).
 *
 * Every figure is read from the constant it states. Never claimed: a
 * vector or exact print (print draws images), that nothing is ever
 * fetched (the engine arrives in parts: see the derived offline answer),
 * a page count it can open (the size ceiling is the one stated limit).
 */
const ceilingMb = Math.round(RUNNER_FILE_CEILINGS.view / (1024 * 1024));
const L = VIEWER_LABELS;
const schemes = VIEWER_LINK_SCHEMES.map((s) => s.replace(":", "")).join(", ");

const content: ToolContent = {
  slug: "pdf-viewer",

  seoTitle: "PDF Viewer — View PDF Online, No Upload",

  metaDescription:
    "Open a PDF and read it in your browser: scroll, zoom, search the text, follow links and bookmarks, print or download it. The file is not uploaded.",

  intro: [
    "PDF Viewer opens a PDF in this browser tab so you can read it: every page in one scrolling column, with zoom, page thumbnails, the document's bookmarks, search with the matches highlighted, and its links. Text you can select in the PDF can be selected and copied here too.",
    `The file is read on your device with pdf.js and is not uploaded to pdf.xyz. It takes PDFs of up to ${ceilingMb} MB. A file whose author restricted printing or editing, but that opens without a password, opens here as it does in any viewer. Only a file that needs a password to open is refused, with a link to Unlock PDF if you know the password.`,
    `Only the pages near the one you are reading are drawn, at most ${VIEWER_LIVE_PAGES} at a time, so a long document stays quick to scroll. The viewer never changes your file: ${L.rotate} turns the pages on screen only, and ${L.download} saves the same file you opened, byte for byte.`,
  ],

  useCases: [
    {
      title: "Read a PDF on a computer without a PDF reader",
      body: "Open the file here instead of installing anything. It is read in this tab and stays on your device.",
    },
    {
      title: "Find a word in a long document",
      body: `Press ${L.search}, type the word, and every match on every page is highlighted; ${L.nextMatch} and ${L.previousMatch} step through them.`,
    },
    {
      title: "Check a file before you send or edit it",
      body: "Look through the pages, then carry the same file on to Annotate PDF, Edit PDF, Sign PDF or Compress PDF from the Do more with this PDF list, without picking it again.",
    },
    {
      title: "Read a scan that is sideways",
      body: `${L.rotate} turns every page a quarter turn on screen. To save the turn in the file, use Rotate PDF.`,
    },
  ],

  steps: [
    {
      title: "Open your PDF",
      body: `Drag the PDF into the drop area, or click it to pick the file from your device. It takes one file of up to ${ceilingMb} MB.`,
    },
    {
      title: "Move through the pages",
      body: `Scroll the column, use ${L.previous} and ${L.next}, or type a number in the page box and press Enter. With the pages focused, Page Up and Page Down step a page, and Home and End go to the first and last. ${L.thumbnails} and ${L.bookmarks} open a side panel to jump to a page.`,
    },
    {
      title: "Zoom, turn and search",
      body: `${L.zoomIn} and ${L.zoomOut} step from ${VIEWER_ZOOM_RANGE}; the zoom menu also has ${L.fitWidth} and ${L.fitPage}, and the page you are reading stays in view as the zoom changes. ${L.rotate} turns the pages on screen. ${L.search} finds text and highlights every match.`,
    },
    {
      title: "Print, download or carry on",
      body: `${L.print} opens your browser's print dialog, ${L.download} saves the file unchanged, and ${L.doMore} carries it to another tool.`,
    },
  ],

  faqs: [
    {
      q: "Is my PDF uploaded?",
      a: "No upload: the file is read and drawn in your browser tab and is not sent to pdf.xyz. Download saves the copy already on your device.",
    },
    {
      q: "Why does search find nothing on some pages?",
      a: `Search reads the text stored in the PDF, the same text you can select. A scanned page is a picture of text with none stored, so it cannot be searched; the search says how many pages had no text, and OCR PDF can add a text layer to them. A search highlights at most ${VIEWER_MAX_MATCHES.toLocaleString("en-US")} matches, and a page with more than ${VIEWER_MAX_TEXT_ITEMS.toLocaleString("en-US")} pieces of text is searched and selectable only in its first part; the viewer says when either happens.`,
    },
    {
      q: "Does rotating here change the file?",
      a: `No. ${L.rotate} turns the pages on screen only, and the file you download is the one you opened. To save a rotation, use Rotate PDF.`,
    },
    {
      q: "How does printing work?",
      a: `${L.print} draws each page as an image at ${VIEWER_PRINT_DPI} dpi and opens your browser's print dialog on them, so text prints a little less crisp than from a desktop PDF reader. One print sends at most ${VIEWER_PRINT_MAX_PAGES} pages, and fewer when the pages are large; the viewer says before printing when a document is longer than that. Print always uses the pages as the file shows them, not a view-only turn.`,
    },
    {
      q: "Are links in the PDF safe to click?",
      a: `A link to another page of the document scrolls there. A link to a web or e-mail address (${schemes}) opens in a new tab without passing on this page's address. Links of any other kind, such as a script, are not shown at all, and the viewer never runs JavaScript stored in a PDF.`,
    },
    {
      q: "Can I fill in a form or add notes here?",
      a: "No, this viewer only shows the file: form fields appear as they are drawn in the PDF. To type into a form use Fill Forms, and to add highlights and notes use Annotate PDF.",
    },
  ],

  relatedGuides: [],
};

export default content;
