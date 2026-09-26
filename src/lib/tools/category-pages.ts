import type { ToolCategoryId } from "./types";

/**
 * Copy for the eight category landing pages at `/tools/category/[category]`.
 *
 * Each entry is written for the query a person types when they want that KIND
 * of tool rather than one tool: "PDF converter", "AI PDF tools", "PDF security
 * tools". The name on `categories.ts` stays the short navigation label; this is
 * the landing-page voice for the same set.
 *
 * WHAT IS NOT HERE, on purpose: where the tools run, and how many there are.
 * Both are rendered from the catalogue on the page itself (each tool's own
 * processing mode, counted), so a tool that moves from the browser to a worker
 * changes the landing page without anyone editing a sentence. A hand-typed
 * "every tool here runs in your browser" would be true on the day it was
 * written and silently false the day one tool moved.
 *
 * `Record<ToolCategoryId, …>` makes a ninth category a compile error until it
 * has copy, and `category-pages.test.ts` holds the H1s and titles unique.
 */
export interface CategoryPageCopy {
  /** `<title>` (the layout appends " — pdf.xyz"). */
  readonly title: string;
  /** The page's one H1. */
  readonly heading: string;
  /** Meta description. */
  readonly description: string;
  /** Lead paragraph under the H1. */
  readonly intro: string;
  /** Extra meta keywords for the category's search intent. */
  readonly keywords: readonly string[];
}

export const categoryPageCopy: Record<ToolCategoryId, CategoryPageCopy> = {
  organize: {
    title: "Organize PDF pages: merge, split, reorder",
    heading: "Organize PDF pages",
    description:
      "Merge PDFs into one file, split a PDF by page range, and reorder, rotate, extract or delete pages. Each tool shows where it runs before you add a file.",
    intro:
      "Put the pages of a PDF in the order you need. Combine several files into one, split a long document into parts, pull out the pages you want, delete the ones you don't, and turn anything that was scanned sideways.",
    keywords: [
      "organize pdf",
      "merge and split pdf",
      "reorder pdf pages",
      "pdf page tools",
    ],
  },
  "convert-to": {
    title: "PDF converter: Word, Excel, JPG and more to PDF",
    heading: "PDF converter: turn files into PDF",
    description:
      "Convert Word, Excel, PowerPoint, JPG, PNG, HTML, web pages, Markdown and plain text to PDF. Each tool shows whether it runs in your browser or on a secure worker.",
    intro:
      "Start from the file you have and finish with a PDF anyone can open. Office documents, images, web pages, Markdown and plain text each have their own converter, so the settings fit the source instead of one form trying to fit them all.",
    keywords: ["pdf converter", "convert to pdf", "file to pdf", "create pdf"],
  },
  "convert-from": {
    title: "PDF converter: PDF to Word, Excel, JPG and more",
    heading: "PDF converter: turn PDFs into other formats",
    description:
      "Convert PDF to Word, Excel, PowerPoint, JPG, PNG, PDF/A, Markdown or plain text, and pull tables out into CSV. Each tool shows where it runs.",
    intro:
      "Get your content back out of a PDF in a format you can work with: a Word document, a spreadsheet, slides, page images, plain text or Markdown, or an archival PDF/A copy for long-term storage.",
    keywords: [
      "pdf converter",
      "convert pdf",
      "pdf to other formats",
      "export pdf",
    ],
  },
  edit: {
    title: "Edit PDF: annotate, watermark, add page numbers",
    heading: "Edit and annotate PDFs",
    description:
      "Add text, images and shapes, highlight and annotate, crop pages, and stamp watermarks, headers, footers or page numbers onto a PDF.",
    intro:
      "Add to what is already on the page without rebuilding the document: write on it, mark it up, trim its margins, or stamp every page with a watermark, a running header or page numbers.",
    keywords: ["edit pdf", "pdf editor", "annotate pdf", "pdf markup tools"],
  },
  sign: {
    title: "Sign PDF and fill PDF forms",
    heading: "Sign PDFs and fill forms",
    description:
      "Sign a PDF with a drawn, typed or uploaded signature, fill in a PDF form, turn a flat PDF into a fillable one, or request signatures from other people.",
    intro:
      "Finish the paperwork step: put your signature on a document, complete the fields in a PDF form, add form fields to a PDF that has none, or ask other people to sign.",
    keywords: ["sign pdf", "pdf signature", "fill pdf form", "pdf forms"],
  },
  security: {
    title: "PDF security tools: protect, unlock, redact",
    heading: "PDF security tools",
    description:
      "Password-protect a PDF, remove a password you know, black out sensitive information, flatten form fields, and compare two versions of a document.",
    intro:
      "Decide who can open a document and what it gives away. Add a password or remove one you know, black out information before you share, lock form fields into the page, or compare two versions to see exactly what changed.",
    keywords: [
      "pdf security",
      "protect pdf",
      "redact pdf",
      "pdf password tools",
    ],
  },
  optimize: {
    title: "Optimize PDF: compress, OCR, repair",
    heading: "Compress and optimize PDFs",
    description:
      "Compress a PDF, make a scanned PDF searchable with OCR, repair a damaged file, prepare a PDF for fast web viewing, or convert it to grayscale.",
    intro:
      "Work on the file rather than its contents: compress it, add a searchable text layer to a scan, recover what can be recovered from a damaged document, or prepare it to open quickly in a browser.",
    keywords: ["optimize pdf", "compress pdf", "ocr pdf", "reduce pdf size"],
  },
  ai: {
    title: "AI PDF tools: chat, summarize, translate",
    heading: "AI PDF tools",
    description:
      "Ask a PDF questions, summarize it, translate its text into another language, or extract structured data from it with AI.",
    intro:
      "Read less and find more: ask a document questions and get answers that point back to the source, get a summary of the key points, translate the text into another language, or pull named fields out into structured data.",
    keywords: ["ai pdf tools", "ai pdf", "pdf ai", "chat with pdf"],
  },
};
