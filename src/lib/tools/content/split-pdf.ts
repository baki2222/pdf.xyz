import type { ToolContent } from "./types";
import { modeUploadsFiles } from "@/lib/tools/processing-split";
import { getToolBySlug } from "@/lib/tools";
import { toolFileCeiling, toolFileCeilingMb } from "@/lib/tools/file-ceilings";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";

/**
 * Where-the-file-goes and the size cap are read from the catalogue and the
 * ceiling registry rather than typed: this page says the split is in-browser,
 * so it refuses to build if the catalogue stops saying "client" or the tool
 * stops resolving to the `split` runner (whose gate is `validatePdfFile` →
 * MAX_PDF_BYTES, the same number its refusal message quotes).
 */
const splitTool = getToolBySlug("split-pdf");
if (!splitTool || modeUploadsFiles(splitTool.processing)) {
  throw new Error(
    "split-pdf content says the file is not uploaded, but the tool is not processing: client",
  );
}
const ceiling = toolFileCeiling(splitTool);
const CEILING_MB = toolFileCeilingMb(splitTool);
if (
  ceiling.tier !== "in-browser" ||
  ceiling.runner !== "split" ||
  CEILING_MB === null
) {
  throw new Error(
    "split-pdf content quotes the split runner's in-browser ceiling, but the tool no longer resolves to it",
  );
}

/** A sibling tool's catalogue name, so a rename cannot leave this page pointing at nothing. */
function toolName(slug: string, processing: "client" | "server"): string {
  const tool = getToolBySlug(slug);
  if (!tool || tool.processing !== processing) {
    throw new Error(
      `split-pdf content names ${slug} as a ${processing} tool, and the catalogue disagrees`,
    );
  }
  return tool.name;
}
const DELETE_PAGES = toolName("remove-pages", "client");
const EXTRACT_PAGES = toolName("extract-pages", "client");
const UNLOCK_PDF = toolName("unlock-pdf", "server");
const LINK_MINUTES = DEFAULT_RETENTION.outputTtlMinutes;

/*
 * Behaviour claims below were checked against the code on 2026-09-27
 * (split-runner.tsx, single-pdf-runner.tsx, use-single-pdf.ts, runner-kit.tsx
 * Dropzone, src/lib/pdf/ranges.ts, engine.ts splitPdf/loadPdf, browser.ts
 * zipFiles) and by running `splitPdf` + `buildSplitParts` on a generated
 * 12-page PDF with a title, author, a filled text field and a rotated page:
 *   - pieces kept page size and per-page rotation; no title/author, no
 *     /AcroForm, but the text field's WIDGET annotation was still on the
 *     copied page (Annots size 1). Whether a reader treats that orphaned
 *     widget as fillable is viewer-dependent, so the copy does not say.
 * SUPERSEDED 2026-10-06 (kept as history): the page assembler (page-copy.ts, subset
 *     state) now carries title/author, page labels, /Lang, the bookmarks
 *     that open a kept page and the kept pages' fields as a fillable
 *     /AcroForm into every piece (probed through splitPdf on
 *     makeStructuredPdf(3)); tool-page-substance.test.ts holds the page;
 *   - names: `report-1-pages-1-3.pdf`, `report-3-page-12.pdf`, and
 *     `report-01-page-1.pdf` once there were 12 parts (pad = digits of count);
 *   - "1-3, 2-4, 12-" produced overlapping pieces without complaint;
 *   - "13" → `This PDF has 12 pages — "13" is out of range.`; "5-3" →
 *     `"5-3" is backwards — start must be ≤ end.`; "0" → `Pages start at 1…`;
 *     "abc" → `"abc" isn't a valid page or range.`
 *   - encrypted input: pdf-lib's load throws for ANY /Encrypt trailer, and
 *     loadPdf maps it to "This PDF is password-protected. Unlock it first, …"
 *     (owner-only and user-password files both probe-verified by the writer).
 *   - Unlock PDF's password field cannot be empty, so an owner-only file needs
 *     its owner password — the same statement unlock-pdf.ts makes.
 * ADDED 2026-10-25 (split-runner.tsx, split-text.ts, merge-contents-split-
 * text.test.ts): "By text" reads every page's text with pdf.js
 * (extractPdfText) the first time it is chosen; a page whose squashed text
 * contains the phrase (white space compared loosely, case only with Match
 * case) starts a file; pages before the first match are a file of their own;
 * a page with no selectable text is named under the field and cannot start a
 * file; the preview labels each file with the page that starts it.
 */
const content: ToolContent = {
  slug: "split-pdf",

  seoTitle: "Split PDF by Pages, Bookmarks or Text — No Upload",

  metaDescription:
    "Split a PDF by page ranges, every N pages, each page, a maximum file size, its bookmarks or a word on the page. It runs in your browser; no upload.",

  intro: [
    `Split PDF cuts one document into several smaller PDFs in one of six ways. Custom ranges turns each comma-separated range you type into its own file, so "1-3, 4-9, 10-" gives you three documents, or, with "Merge selected ranges into one file" ticked, one document holding those pages in the order you typed them. Every N pages chops the file into equal chunks of the size you set, and any pages left over form a shorter final file. Each page makes every page its own PDF. By file size packs consecutive pages into each file until the next page would take it over the megabytes you set. By bookmarks starts a new file at the page of each top-level bookmark; it is greyed out, with the reason shown, for a PDF that has none. By text starts a new file at every page that contains a word or phrase you type, such as "Invoice number", with Match case when capitals matter. Except for By file size, whose pieces are only known once they are built, a preview lists every file the split will create, with its name and page count, before anything runs.`,
    `The cutting is done by pdf-lib, a JavaScript PDF library your browser fetches the moment you add a file, and By text reads each page's text with pdf.js, shipped with the page. There is no upload anywhere: reading the pages, building each piece and, when there is more than one, packing them into a ZIP all happen on your device. A PDF can be up to ${CEILING_MB} MB; a bigger one is refused on its file size alone, before any of its bytes are read.`,
    `Every piece is a new PDF built from copies of the original pages, so their text, images, page size and rotation come through unchanged. Each piece also keeps the document's title, author, subject and keywords, its page labels and language, the bookmarks that open one of its pages, and the form fields on its pages, still fillable. Attached files, XMP metadata and the accessibility tags of a tagged PDF are not carried into the pieces. An encrypted file is refused as it loads, even one that opens without a password and only restricts printing or copying.`,
  ],

  useCases: [
    {
      title: "Separate a batch scan into its documents",
      body: "Twenty two-page forms scanned into one long PDF come apart with Every N pages set to 2: twenty files, numbered in scan order.",
    },
    {
      title: "Send only the chapter someone needs",
      body: "Type chapter boundaries as custom ranges, such as 1-12, 13-40, 41-, and each chapter becomes a PDF you can attach without mailing the whole manual.",
    },
    {
      title: "One file per invoice or receipt",
      body: "When a statement holds one invoice per page, Each page makes every page a standalone PDF, numbered so that a folder lists them in page order.",
    },
    {
      title: "Overlapping handouts from one deck",
      body: "Ranges are allowed to overlap. Entering 1-6, 5-10 gives two files that both carry pages 5 and 6, which suits handouts that need a shared recap page.",
    },
    {
      title: "Get under an attachment size limit",
      body: "Choose By file size and enter the limit your mail service or portal sets, in MB. Each piece is built and weighed before the next page is added, so a font or image shared across pages, which is copied into every piece that uses it, is counted rather than guessed. A single page that is bigger than the limit by itself still becomes its own piece, and the finished panel names it.",
    },
    {
      title: "One file per chapter of a bookmarked report",
      body: "When a report's bookmarks panel lists its chapters, By bookmarks cuts at each top-level bookmark's page, so every chapter becomes its own PDF without typing a single range.",
    },
  ],

  steps: [
    {
      title: "Choose your PDF",
      body: 'Use the "Drop your PDF here, or browse" box, whose caption reads "One PDF · it stays on your device". Dropping several files at once opens just the first. Once it loads, a bar above the options shows the file name, its page count and its size.',
    },
    {
      title: "Pick a split mode",
      body: "Under How to split, choose Custom ranges, Every N pages, Each page, By file size, By bookmarks or By text.",
    },
    {
      title: "Set the ranges or the chunk size",
      body: "For Custom ranges, edit the Page ranges field; on a document of two or more pages it starts pre-filled with the file cut in half, the first half taking the extra page when the count is odd. Tick “Merge selected ranges into one file” to get one PDF instead of one per range. For Every N pages, set Pages per file, which starts at 1. For By file size, set the maximum size per file in MB, which starts at about half the file's size. For By text, type the words in “Start a new file at every page containing”. The Preview list below redraws on every keystroke.",
    },
    {
      title: "Split and download",
      body: "Press the Split into … files button, whose label carries the exact number of pieces. When the split produced more than one piece, the finished panel offers Download ZIP (N files) for the whole set in one archive; a single piece gets Download PDF.",
    },
  ],

  faqs: [
    {
      q: "How does splitting by file size work?",
      a: "Enter a maximum size in MB. Starting from page 1, each file takes as many consecutive pages as fit: candidate files are actually built and their size measured, so the number is the downloaded file's real size, not an estimate. Pages are never reordered. A page that is over the limit by itself cannot be made smaller by splitting, so it becomes a file of its own above the limit, and the finished panel names that page; Compress PDF is the tool that can shrink it.",
    },
    {
      q: "Can I split a PDF into its chapters?",
      a: "Yes, when its chapters are bookmarked: choose By bookmarks, and a new file starts at the page each top-level bookmark opens; nested bookmarks do not cut, and neither does a bookmark to a web address. Pages before the first bookmark become a file of their own, and two bookmarks on one page start one file. The preview shows which bookmark begins each file. If the PDF has no bookmarks that open a page, the option is greyed out with that reason.",
    },
    {
      q: "Can I start a new file at every page with a certain word on it?",
      a: "Yes: choose By text and type the word or phrase. Every page whose text contains it starts a new file, and pages before the first one become a file of their own; the preview names the page that starts each file. Spaces and line breaks are compared loosely, so a phrase that wraps onto a second line still matches, and capitals are ignored unless Match case is ticked. It reads the PDF's own text, so a scanned page with no text layer cannot start a file — it is named under the field and stays with the pages before it. OCR PDF adds a text layer first.",
    },
    {
      q: "How do I type page ranges for a split?",
      a: `Separate files with commas. A single number such as 8 is a one-page file, 2-5 includes both ends, 10- runs to the last page and -3 starts from page 1. An entry that cannot work stops the preview with a message: a page past the end is named along with the PDF's page count, 5-3 is flagged as backwards, and 0 or a word is refused. A page you leave out of every range is in none of the outputs. To keep most of a document and drop a few pages, ${DELETE_PAGES} does that in one file; for a hand-picked set of pages combined into one new PDF, ${EXTRACT_PAGES} is the closer fit.`,
    },
    {
      q: "What are the split files called?",
      a: "Each piece takes the original name, a sequence number and its page span, for example report-01-pages-1-3.pdf or report-12-page-40.pdf, in every mode. With ten or more pieces the number is zero-padded so they sort in order, and the ZIP that holds multiple pieces is named after the original with -split added. Ranges merged into one file download as that one PDF, named after the original with -split added.",
    },
    {
      q: "Can I split a password-protected PDF?",
      a: `Not in this tool. ${UNLOCK_PDF} removes the encryption when you type a password the file accepts; its password field cannot be left empty, so a file that only restricts printing or copying needs its owner password there. ${UNLOCK_PDF} is not in-browser: the PDF and the password go over TLS to pdf.xyz's secure worker, the input is deleted when the job finishes, the download link expires after ${LINK_MINUTES} minutes, and the stored copy is erased by a daily storage rule after that. The split you do afterwards stays in your browser.`,
    },
  ],

  relatedGuides: ["how-to-split-a-pdf"],
};

export default content;
