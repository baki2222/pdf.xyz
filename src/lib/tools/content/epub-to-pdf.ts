import type { ToolContent } from "./types";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { getToolBySlug } from "@/lib/tools";
import { toolFileCeiling } from "@/lib/tools/file-ceilings";
import { formatBytes } from "@/lib/utils";
import {
  DEFAULT_EPUB_RENDER_OPTIONS,
  EPUB_MARGINS,
  EPUB_PAGE_SIZES,
} from "@/lib/jobs/epub-render-options";
import {
  EPUB_MAX_ENTRIES,
  EPUB_MAX_SPINE_ITEMS,
  EPUB_MAX_UNPACKED_BYTES,
} from "@/lib/workers/epub/native-config";
import { resolveNativeHtmlRenderConfig } from "@/lib/workers/html-render/native-config";
import { workerBatchPageSentence } from "@/lib/batch/worker-copy";

/**
 * Every claim below was read off the implementation (2026-11-06):
 *  - controls and labels: src/components/tools/html-render-worker-panel.tsx in
 *    its "epub" mode (Dropzone title "Add an EPUB file, or", accept .epub,
 *    one file, "Remove", the "Convert to PDF" button, busy label
 *    jobBusyLabel(job.phase, "Converting to PDF…"), "Your PDF is ready.",
 *    "Download <name>") and src/components/tools/epub-layout-options.tsx
 *    (Page layout: Page size and Margins, from
 *    src/lib/jobs/epub-render-options.ts; A5 and Normal by default);
 *  - the book: src/lib/workers/epub/package.ts reads mimetype → container →
 *    package → spine (linear items only) → the EPUB 3 nav, else the NCX; a
 *    DRM'd book (encryption.xml naming anything but the two font-obfuscation
 *    algorithms) is refused; obfuscated fonts are never served, so the book
 *    prints in fallback fonts; a fixed-layout page with a viewport prints at
 *    that size, edge to edge, its first page only (engine.ts
 *    fixedLayoutPrintParams);
 *  - the print: src/lib/workers/html-render/native.ts drivePackage — one tab
 *    per chapter, page scripts disabled, requests answered only from the
 *    book's own files, every other request refused before any fetch
 *    (proven in epub.chromium.test.ts: the remote image is asked for and
 *    the network seam is never called);
 *  - the joining: engine.ts joinChapters — Page copy, the book's title and
 *    language on the PDF, a bookmark per table-of-contents entry opening its
 *    chapter's FIRST page (not the heading inside it), links to other
 *    chapters pointed at that chapter's first page, links to other files of
 *    the book removed;
 *  - limits: ./native-config.ts and the HTML renderer's time bound
 *    (resolveNativeHtmlRenderConfig().timeoutMs, overridable on the worker by
 *    PDFXYZ_HTML_RENDER_TIMEOUT_MS; production's env was not read).
 */

const LINK_MINUTES = DEFAULT_RETENTION.outputTtlMinutes;
const INPUT_MINUTES = DEFAULT_RETENTION.inputTtlMinutes;
const CEILING = toolFileCeiling(getToolBySlug("epub-to-pdf")!);
const CEILING_TEXT = formatBytes(CEILING.bytes ?? 0);
const SECONDS = Math.round(resolveNativeHtmlRenderConfig({}).timeoutMs / 1000);
const MIB = 1024 * 1024;

const list = (items: readonly string[]) =>
  new Intl.ListFormat("en", { type: "conjunction" }).format(items);
const SIZES = list(EPUB_PAGE_SIZES.map((s) => s.label));
const MARGINS = list(EPUB_MARGINS.map((m) => m.label));
const DEFAULT_SIZE_INFO = EPUB_PAGE_SIZES.find(
  (s) => s.id === DEFAULT_EPUB_RENDER_OPTIONS.pageSize,
)!;
const DEFAULT_SIZE = DEFAULT_SIZE_INFO.label;
const DEFAULT_MM = (DEFAULT_SIZE_INFO.inches ?? [])
  .map((inches) => Math.round(inches * 25.4))
  .join(" × ");
const DEFAULT_MARGIN = EPUB_MARGINS.find(
  (m) => m.id === DEFAULT_EPUB_RENDER_OPTIONS.margin,
)!.label;

const content: ToolContent = {
  slug: "epub-to-pdf",

  seoTitle: "EPUB to PDF: Convert an E-book to PDF",

  metaDescription:
    "Convert a DRM-free EPUB to one PDF: every chapter in reading order, the table of contents as bookmarks, A5 pages by default. Input deleted after the job.",

  intro: [
    "EPUB to PDF takes one .epub file and prints the whole book as a single PDF. It reads the book the way an e-reader does, following its reading order rather than its file names, and prints each chapter with the book's own stylesheets and pictures in headless Chromium, the open-source engine behind Chrome. Each chapter starts on a new page, and the book's table of contents becomes the PDF's bookmarks.",
    `Chromium does not run in your browser, so this is an upload: the book goes over TLS to pdf.xyz's secure server, which deletes it when the job finishes (and within ${INPUT_MINUTES} minutes in any case). While the book prints, scripts inside it do not run and nothing is fetched from the web: only the files inside the .epub are used. The PDF's download link lasts ${LINK_MINUTES} minutes.`,
    "Books sold with DRM (copy protection) cannot be converted: their chapters are encrypted, and the job stops and says so. DRM-free books, such as those from many independent publishers and public-domain libraries, convert.",
  ],

  useCases: [
    {
      title: "Several files at once",
      body: workerBatchPageSentence("epub-to-pdf"),
    },
    {
      title: "Print a book or a chapter on paper",
      body: `An e-reader reflows text for its screen; a printer needs pages. The PDF has fixed ${DEFAULT_SIZE} pages by default, about the size of a paperback, or Letter or A4 if you want to print on ordinary office paper.`,
    },
    {
      title: "Read on a device without an EPUB app",
      body: "Every computer and phone opens a PDF. The bookmarks panel of any PDF reader lists the book's chapters, so you can still jump around the book.",
    },
    {
      title: "Annotate, sign or share a document that came as an e-book",
      body: "Reports, manuals and course readers are sometimes distributed as EPUB. Once it is a PDF, the other tools here can add comments, page numbers, a watermark or a signature.",
    },
  ],

  steps: [
    {
      title: "Add your EPUB file",
      body: "Drag one .epub file onto the dashed drop zone, or click it to pick one. The name then appears with a Remove button. The file is sent only when you press Convert to PDF, and that button stays off until a secure server is ready.",
    },
    {
      title: "Choose the page size and margins, if you want to",
      body: `Under Page layout, pick a Page size (${SIZES}) and the Margins (${MARGINS}). Left alone, the book prints on ${DEFAULT_SIZE} pages with ${DEFAULT_MARGIN} margins.`,
    },
    {
      title: "Click Convert to PDF",
      body: "Its label follows the job: “Uploading your file…”, then “Waiting for our server…” if the queue is busy, “Converting to PDF…” while the chapters print, and “Downloading the result…”. A Cancel button below it stops the job at any point.",
    },
    {
      title: "Download the PDF",
      body: "When “Your PDF is ready.” appears, click the button reading Download plus the file name. The PDF is named after your file, ending in .pdf instead of .epub. A book that cannot be converted shows a note saying why.",
    },
  ],

  faqs: [
    {
      q: "Can it convert a book I bought with DRM?",
      a: "No. A book with DRM has its chapters encrypted, and the job is refused with a note saying the book is protected. Nothing tries to remove the protection. A book whose only scrambled files are its embedded fonts (font obfuscation, which many publishers use) is not DRM: it converts, but those fonts are left out, so its text prints in standard fonts.",
    },
    {
      q: "Are the chapters in the right order, and is there a table of contents?",
      a: "The chapters follow the book's reading order, the order an e-reader pages through, and each starts on a new page. The book's table of contents (the EPUB 3 navigation document, or the older NCX file) becomes the PDF's bookmarks; a bookmark opens the first page of the chapter file it points to, not the exact heading inside it. A link from one chapter to another opens that chapter's first page.",
    },
    {
      q: "What page size is the PDF?",
      a: `${DEFAULT_SIZE} (${DEFAULT_MM} mm) with ${DEFAULT_MARGIN} margins unless you choose otherwise under Page layout: ${SIZES}, with ${MARGINS} margins. A fixed-layout book, one whose pages are drawn to an exact size as in many comics and picture books, ignores both: each of its pages becomes one PDF page at the size the page declares, with no margins, and anything drawn outside that size is cut.`,
    },
    {
      q: "Is anything fetched from the internet?",
      a: "No. Only the files inside your .epub are used. A picture or font the book links from a web address is left out, scripts in the book do not run, and the book is never shown to any other site. Links to web pages stay clickable in the PDF.",
    },
    {
      q: "Is my book uploaded, and how long is it kept?",
      a: `Yes, over TLS, because Chromium runs on our secure server. The upload is removed when the job ends, success or failure, and within ${INPUT_MINUTES} minutes regardless. The download link works for ${LINK_MINUTES} minutes; a daily storage rule then erases the stored PDF, typically a few hours later.`,
    },
    {
      q: "How large a book can it convert?",
      a: `One .epub of up to ${CEILING_TEXT}; a larger one is refused as soon as you pick it, before anything is uploaded. Inside it, at most ${EPUB_MAX_SPINE_ITEMS} chapter files, ${EPUB_MAX_ENTRIES.toLocaleString("en-US")} files in all and ${EPUB_MAX_UNPACKED_BYTES / MIB} MB once unpacked; a book over any of these is refused with a note naming the limit. Printing has ${SECONDS} seconds; a book that takes longer is stopped, and converting it in parts helps.`,
    },
  ],

  relatedGuides: [],
};

export default content;
