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
 */
const content: ToolContent = {
  slug: "split-pdf",

  seoTitle: "Split PDF by Range or Every N Pages — No Upload",

  metaDescription:
    "Split a PDF into separate files by custom page ranges, every N pages, or one file per page. The split runs in your browser, so the file is not uploaded.",

  intro: [
    `Split PDF cuts one document into several smaller PDFs in one of three ways. Custom ranges turns each comma-separated range you type into its own file, so "1-3, 4-9, 10-" gives you three documents. Every N pages chops the file into equal chunks of the size you set, and any pages left over form a shorter final file. Each page makes every page its own PDF. Before anything runs, a preview lists every file the split will create, with its name and page count.`,
    `The cutting is done by pdf-lib, a JavaScript PDF library your browser fetches the moment you add a file, and there is no upload anywhere: reading the pages, building each piece and packing the ZIP all happen on your device. A PDF can be up to ${CEILING_MB} MB; a bigger one is refused on its file size alone, before any of its bytes are read.`,
    `Every piece is a new PDF built from copies of the original pages, so their text, images, page size and rotation come through unchanged. Each piece also keeps the document's title and author, page labels and language, the bookmarks that open one of its pages, and the form fields on its pages, still fillable. An encrypted file is refused as it loads, even one that opens without a password and only restricts printing or copying.`,
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
      body: "Fewer pages usually means a smaller file, but a font or image shared across pages is copied into every piece that uses it. The finished panel shows only the combined size, so check each file in the ZIP before attaching it.",
    },
  ],

  steps: [
    {
      title: "Choose your PDF",
      body: 'Use the "Drop your PDF here, or browse" box, whose caption reads "One PDF · it stays on your device". Dropping several files at once opens just the first. Once it loads, a bar above the options shows the file name, its page count and its size.',
    },
    {
      title: "Pick a split mode",
      body: "Under How to split, choose Custom ranges, Every N pages or Each page.",
    },
    {
      title: "Set the ranges or the chunk size",
      body: "For Custom ranges, edit the Page ranges field; on a document of two or more pages it starts pre-filled with the file cut in half, the first half taking the extra page when the count is odd. For Every N pages, set Pages per file, which starts at 1. The Preview list below redraws on every keystroke.",
    },
    {
      title: "Split and download",
      body: "Press the Split into … files button, whose label carries the exact number of pieces. When the split produced more than one piece, the finished panel offers Download ZIP (N files) for the whole set in one archive; a single piece gets Download PDF.",
    },
  ],

  faqs: [
    {
      q: "How do I type page ranges for a split?",
      a: "Separate files with commas. A single number such as 8 is a one-page file, 2-5 includes both ends, 10- runs to the last page and -3 starts from page 1. An entry that cannot work stops the preview with a message: a page past the end is named along with the PDF's page count, 5-3 is flagged as backwards, and 0 or a word is refused.",
    },
    {
      q: "What happens to pages I leave out of my ranges?",
      a: `They are skipped: a page that appears in no range is in none of the outputs. If you want to keep most of a document and drop a few pages, ${DELETE_PAGES} does that in one file; if you want a hand-picked set of pages combined into one new PDF, ${EXTRACT_PAGES} is the closer fit.`,
    },
    {
      q: "What are the split files called?",
      a: "Each piece takes the original name, a sequence number and its page span, for example report-01-pages-1-3.pdf or report-12-page-40.pdf. With ten or more pieces the number is zero-padded so they sort in order, and the ZIP that holds multiple pieces is named after the original with -split added.",
    },
    {
      q: "Can I split a password-protected PDF?",
      a: `Not in this tool. ${UNLOCK_PDF} removes the encryption when you type a password the file accepts; its password field cannot be left empty, so a file that only restricts printing or copying needs its owner password there. ${UNLOCK_PDF} is not in-browser: the PDF and the password go over TLS to pdf.xyz's secure worker, the input is deleted when the job finishes, the download link expires after ${LINK_MINUTES} minutes, and the stored copy is erased by a daily storage rule after that. The split you do afterwards stays in your browser.`,
    },
  ],

  relatedGuides: ["how-to-split-a-pdf"],
};

export default content;
