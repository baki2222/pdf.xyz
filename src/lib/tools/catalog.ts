import type { Tool } from "./types";
import { MAX_IMAGE_MB, MAX_SOURCE_MB } from "./limits";
import { US_LETTER_LABEL } from "@/lib/pdf/page-geometry";
import {
  RASTER_RESOLUTION_CHOICES as RESOLUTION_CHOICES,
  RASTER_PREVIEW_LIMIT,
  RASTER_RESOLUTION_DPIS as RESOLUTION_DPIS,
} from "@/lib/pdf/pdf-to-image";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { PDF_A_STANDARD } from "@/lib/jobs/pdfa-results";
import {
  MAX_REQUEST_SIGNERS,
  REQUEST_PACKAGE_FILES,
} from "@/lib/jobs/request-signatures";

/**
 * The pdf.xyz tool catalog — the single source of truth for every tool.
 * Adding a tool here automatically wires up: the homepage grid, the /tools
 * index, the dynamic /tools/[slug] page, search, sitemap, and footer links.
 *
 * `processing` is set honestly per tool so the UI can tell users exactly what
 * runs in their browser vs. on ephemeral, auto-deleting workers.
 */
export const tools: Tool[] = [
  // ─────────────────────────────── Organize ───────────────────────────────
  {
    slug: "merge-pdf",
    name: "Merge PDF",
    tagline: "Combine PDFs into one, in any order.",
    description:
      "Combine multiple PDF files into a single document. Drag to reorder, then export — all in your browser.",
    category: "organize",
    icon: "merge",
    processing: "client",
    badge: "popular",
    featured: true,
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: ["merge pdf", "combine pdf", "join pdf", "concatenate pdf"],
    related: [
      "split-pdf",
      "organize-pages",
      "unlock-pdf",
      "page-numbers",
      "compress-pdf",
    ],
    how: [
      "Add two or more PDF files.",
      "Drag files, or use each row's move buttons, to set the order you want.",
      "Merge and download your combined PDF.",
    ],
  },
  {
    slug: "split-pdf",
    name: "Split PDF",
    tagline: "Split one PDF into many by range.",
    description:
      "Split a PDF into separate files by page range, fixed intervals, or one file per page.",
    category: "organize",
    icon: "split",
    processing: "client",
    badge: "popular",
    featured: true,
    accept: ["PDF"],
    outputs: ["PDF", "ZIP"],
    keywords: ["split pdf", "separate pdf", "extract range", "divide pdf"],
    related: ["merge-pdf", "extract-pages", "organize-pages"],
    how: [
      "Pick the PDF you want to split — it stays on your device.",
      "Choose page ranges or a split-every-N-pages rule.",
      "Download the result — a single piece saves as a PDF, and several arrive together as one ZIP.",
    ],
  },
  {
    slug: "organize-pages",
    name: "Organize Pages",
    seoTitle: "Organize PDF Pages — Reorder, Rotate & Delete",
    tagline: "Reorder, rotate, and delete pages visually.",
    description:
      "Rearrange, rotate, duplicate, and delete pages on a visual page board, then export a clean PDF.",
    category: "organize",
    icon: "organize",
    processing: "client",
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: ["organize pdf", "reorder pages", "rearrange pdf", "sort pages"],
    related: ["merge-pdf", "remove-pages", "page-numbers", "rotate-pdf"],
    how: [
      "Pick your PDF — every page opens as a tile on a page board, and the file stays on your device.",
      "Drag tiles into a new order, or use each tile's move buttons; rotate, duplicate or delete any page from its tile.",
      "Change your mind with “Undo” and “Redo” (Ctrl/⌘+Z and Ctrl/⌘+Shift+Z), or start over with “Reset”.",
      "Click “Apply & export”, then “Download organized PDF”.",
    ],
  },
  {
    slug: "extract-pages",
    name: "Extract Pages",
    seoTitle: "Extract Pages from a PDF",
    tagline: "Pull specific pages into a new PDF.",
    description:
      "Pick pages by clicking thumbnails or typing a range like 1-3, 5, then export them as a brand-new PDF — right in your browser. The file stays on your device.",
    category: "organize",
    icon: "extractPages",
    processing: "client",
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: ["extract pages", "pick pages", "save pages", "pdf pages"],
    related: ["split-pdf", "remove-pages", "organize-pages"],
  },
  {
    slug: "remove-pages",
    name: "Delete Pages",
    seoTitle: "Delete Pages from a PDF",
    tagline: "Remove unwanted pages in seconds.",
    description:
      "Delete pages by clicking thumbnails or typing a range like 1-3, 5, then download the trimmed PDF — right in your browser. The file stays on your device.",
    category: "organize",
    icon: "removePages",
    processing: "client",
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: ["delete pages", "remove pages", "trim pdf", "cut pages"],
    related: ["extract-pages", "organize-pages", "split-pdf"],
    how: [
      "Pick your PDF — a thumbnail of every page appears, and the file stays on your device.",
      "Click the pages to delete, Shift-click to select a run of pages, or type a list like 2-4, 9 and press “Select”.",
      "Click “Delete” to remove them — at least one page has to stay.",
      "Click “Download PDF” to save the trimmed copy.",
    ],
  },
  {
    slug: "rotate-pdf",
    name: "Rotate PDF",
    tagline: "Rotate pages to the correct orientation.",
    description:
      "Rotate individual pages or the whole document 90°, 180°, or 270°, left or right — all in your browser, and the file stays on your device.",
    category: "organize",
    icon: "rotate",
    processing: "client",
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: ["rotate pdf", "turn pages", "orientation", "landscape pdf"],
    related: ["organize-pages", "crop-pdf", "merge-pdf"],
    how: [
      "Pick your PDF — every page appears as a thumbnail, and the file stays on your device.",
      "Select the pages to turn, or select none to turn them all; Shift-click selects a run.",
      "Turn them with “Left”, “Right” or “180°”, or with the arrows on a single page.",
      "Click “Apply rotation”, then “Download rotated PDF”.",
    ],
  },
  {
    slug: "extract-images",
    name: "Extract Images",
    seoTitle: "Extract Images from a PDF",
    tagline: "Save the images embedded in a PDF.",
    description:
      "Pull embedded JPEG and RGB/grayscale images out of a PDF at their original resolution — real image files, not page screenshots. Unsupported formats are skipped.",
    category: "organize",
    icon: "extractImages",
    processing: "client",
    accept: ["PDF"],
    outputs: ["JPG", "PNG", "ZIP"],
    keywords: ["extract images", "save images", "pdf images", "get pictures"],
    related: ["pdf-to-jpg", "pdf-to-png", "compress-pdf"],
    how: [
      "Add your PDF — every page is scanned for embedded images, right in your browser.",
      "Embedded JPEGs are saved as-is; RGB and grayscale images are rebuilt losslessly as PNGs at native size.",
      "Download the images individually or as one ZIP; anything in an unsupported format is listed as skipped.",
    ],
  },

  // ─────────────────────────────── Optimize ───────────────────────────────
  {
    slug: "compress-pdf",
    name: "Compress PDF",
    tagline: "Analyze size and optimize losslessly.",
    description:
      "See exactly what's inflating your PDF and losslessly repack it in your browser. Deep image downsampling runs on a secure, auto-deleting worker.",
    category: "optimize",
    icon: "compress",
    processing: "hybrid",
    badge: "popular",
    featured: true,
    accept: ["PDF"],
    outputs: ["PDF", "ZIP"],
    keywords: ["compress pdf", "reduce size", "shrink pdf", "optimize size"],
    related: ["optimize-web", "remove-pages", "repair-pdf"],
    how: [
      "Add your PDF — it's analyzed privately, right in your browser.",
      "Review the size breakdown and download a lossless-optimized copy.",
      "For image-heavy files, deep image compression runs on a secure, auto-deleting worker — the page checks one is available before anything leaves your device.",
    ],
  },
  {
    slug: "ocr-pdf",
    name: "OCR PDF",
    tagline: "Make scanned PDFs searchable and selectable.",
    description:
      "Run optical character recognition to add a searchable, copyable text layer to scanned PDFs.",
    category: "optimize",
    icon: "ocr",
    processing: "server",
    badge: "new",
    accept: ["PDF", "JPG", "PNG"],
    outputs: ["PDF", "TXT"],
    keywords: ["ocr pdf", "searchable pdf", "recognize text", "scan to text"],
    related: ["pdf-to-text", "extract-tables", "compare-pdf", "compress-pdf"],
  },
  {
    slug: "repair-pdf",
    name: "Repair PDF",
    tagline: "Recover data from damaged files.",
    description:
      "Attempt to repair a corrupted or unreadable PDF and recover as much content as possible.",
    category: "optimize",
    icon: "repair",
    processing: "server",
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: ["repair pdf", "fix pdf", "recover pdf", "corrupt pdf"],
    related: ["compress-pdf", "optimize-web", "pdf-to-pdfa"],
    how: [
      "Upload the damaged PDF over an encrypted connection — it only has to start like a PDF, so a truncated file is taken in.",
      "Press “Repair on the worker”: qpdf rewrites the file's structure on the secure worker, which deletes the input when the job finishes.",
      `Download the repaired PDF — the link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes. If the file had to be rebuilt, a list above the download says what was reconstructed.`,
    ],
  },
  {
    slug: "optimize-web",
    // The name carries the head term: it is the <title>, the H1 and the card.
    name: "Optimize PDF for Web",
    tagline: "Fast-loading, linearized PDFs.",
    description:
      "Linearize a PDF for Fast Web View, so its first page can show while the rest downloads — not compression. Runs on a worker that deletes the input after the job.",
    category: "optimize",
    icon: "speed",
    processing: "server",
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: ["optimize pdf", "linearize", "fast web view", "web pdf"],
    related: ["compress-pdf", "split-pdf", "repair-pdf"],
  },
  {
    slug: "grayscale-pdf",
    name: "Grayscale PDF",
    tagline: "Convert to black & white to save ink.",
    description:
      "Convert a PDF to grayscale for printing, right in your browser. Pages become images: text is no longer selectable, and text-based PDFs usually get larger.",
    category: "optimize",
    icon: "grayscale",
    processing: "client",
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: ["grayscale pdf", "black and white", "desaturate", "printer pdf"],
    related: ["compress-pdf", "optimize-web", "watermark-pdf"],
  },

  // ─────────────────────────────── Convert to PDF ─────────────────────────
  {
    slug: "word-to-pdf",
    name: "Word to PDF",
    tagline: "DOCX and DOC into a shareable PDF.",
    description:
      // LibreOffice lays the document out, not Word. Since the wave-1 L03
      // merge the worker image installs metric clones of Calibri, Cambria,
      // Arial, Times New Roman and Courier New (office-conversion/fonts.ts) —
      // substitutes, not the fonts themselves, with none for Aptos, Word's
      // default since 2023, and only in an image rebuilt from that commit.
      // claims-vs-capability.test.ts bans fidelity promises.
      "Convert Word documents to PDF, rendered by LibreOffice on a secure worker that deletes the input after the job. Fonts the worker lacks are substituted.",
    category: "convert-to",
    icon: "word",
    processing: "server",
    badge: "popular",
    accept: ["DOCX", "DOC"],
    outputs: ["PDF"],
    keywords: ["word to pdf", "docx to pdf", "doc to pdf", "convert word"],
    related: ["pdf-to-word", "excel-to-pdf", "powerpoint-to-pdf"],
  },
  {
    slug: "excel-to-pdf",
    name: "Excel to PDF",
    tagline: "Spreadsheets into clean PDF tables.",
    description:
      "Convert Excel workbooks and CSV files to PDF — laid out by LibreOffice on a secure worker that deletes the input when the job finishes.",
    category: "convert-to",
    icon: "excel",
    processing: "server",
    accept: ["XLSX", "XLS", "CSV"],
    outputs: ["PDF"],
    keywords: ["excel to pdf", "xlsx to pdf", "spreadsheet to pdf", "csv pdf"],
    related: ["pdf-to-excel", "word-to-pdf", "extract-tables"],
  },
  {
    slug: "powerpoint-to-pdf",
    name: "PowerPoint to PDF",
    tagline: "Slides into shareable PDF decks.",
    description:
      "Convert PowerPoint presentations to PDF, one slide per page — rendered by LibreOffice on a secure worker that deletes the input when the job finishes.",
    category: "convert-to",
    icon: "powerpoint",
    processing: "server",
    accept: ["PPTX", "PPT"],
    outputs: ["PDF"],
    keywords: ["powerpoint to pdf", "pptx to pdf", "slides to pdf", "ppt pdf"],
    related: ["pdf-to-powerpoint", "word-to-pdf", "excel-to-pdf"],
  },
  {
    slug: "jpg-to-pdf",
    name: "JPG to PDF",
    tagline: "Images into a single tidy PDF.",
    description:
      // Was "with control over orientation, margins, and page size" — the
      // engine has none of the three. The layout is FIXED (pdf/image-to-pdf.ts
      // via pdf/page-geometry.ts): one US Letter portrait page per image and a
      // 36pt margin. claims-vs-capability.test.ts decodes the output PDF and
      // checks every paper size and margin this copy names.
      `Combine JPG images into one PDF — each centered on its own ${US_LETTER_LABEL} portrait page with a half-inch margin. Files stay on your device.`,
    category: "convert-to",
    icon: "jpg",
    processing: "client",
    badge: "popular",
    accept: ["JPG", "JPEG"],
    outputs: ["PDF"],
    keywords: ["jpg to pdf", "jpeg to pdf", "image to pdf", "photos to pdf"],
    related: ["png-to-pdf", "pdf-to-jpg", "merge-pdf"],
    // Authored because the runner takes MANY images, and the default steps
    // say "pick your file" (tool-page-content.test.ts discovers multi-file
    // runners and requires their own steps).
    how: [
      "Pick one or more JPG or JPEG photos — they stay on your device.",
      "Put them in page order with each image's “Move up” and “Move down” buttons.",
      `Click “Create PDF” — each image is centered on its own ${US_LETTER_LABEL} portrait page, assembled in your browser.`,
      "Click “Download PDF” to save it.",
    ],
  },
  {
    slug: "png-to-pdf",
    name: "PNG to PDF",
    tagline: "Turn PNGs into a crisp PDF.",
    description: `Convert PNG images — transparent ones included — into a single PDF, up to ${MAX_IMAGE_MB} MB per image, assembled right in your browser. Files stay on your device.`,
    category: "convert-to",
    icon: "png",
    processing: "client",
    accept: ["PNG"],
    outputs: ["PDF"],
    keywords: ["png to pdf", "image to pdf", "transparent png pdf", "logos"],
    related: ["jpg-to-pdf", "pdf-to-png", "merge-pdf"],
    how: [
      "Pick one or more PNG images — they stay on your device.",
      "Put them in page order with each image's “Move up” and “Move down” buttons.",
      "Click “Create PDF” — each image goes on its own page, assembled in your browser.",
      "Click “Download PDF” to save it.",
    ],
  },
  {
    slug: "html-to-pdf",
    name: "HTML to PDF",
    tagline: "Render HTML files as PDF.",
    description:
      "Convert an HTML file into PDF with a real Chromium rendering engine on a secure worker that deletes the input when the job finishes.",
    category: "convert-to",
    icon: "html",
    processing: "server",
    accept: ["HTML", "HTM"],
    outputs: ["PDF"],
    keywords: ["html to pdf", "render html", "web to pdf", "markup to pdf"],
    related: ["webpage-to-pdf", "markdown-to-pdf", "word-to-pdf"],
    how: [
      "Upload one .html or .htm file over an encrypted connection.",
      "Select Render PDF — Chromium renders it on a secure worker that deletes the input when the job finishes.",
      `Download the PDF — the link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes.`,
    ],
  },
  {
    slug: "webpage-to-pdf",
    name: "Webpage to PDF",
    tagline: "Capture a public web page URL as a PDF.",
    description:
      "Enter a URL and capture the fully rendered page as a print-quality PDF — Chromium renders it on a secure worker that deletes the input when the job finishes.",
    category: "convert-to",
    icon: "web",
    processing: "server",
    accept: ["URL"],
    outputs: ["PDF"],
    keywords: ["webpage to pdf", "url to pdf", "website to pdf", "save page"],
    related: ["html-to-pdf", "markdown-to-pdf", "compress-pdf"],
    how: [
      "Paste a public http(s) URL.",
      "Select Render PDF — Chromium captures the page on a secure worker.",
      `Download the PDF — the link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes.`,
    ],
  },
  {
    slug: "markdown-to-pdf",
    name: "Markdown to PDF",
    tagline: "Beautiful PDFs from Markdown.",
    description:
      // Block kinds the renderer actually implements (MarkdownBlock in
      // src/lib/pdf/markdown-to-pdf.ts): heading, paragraph, list-item, quote,
      // code. There is no table kind — a GFM table falls through to a
      // paragraph — so this must not promise one.
      `Convert Markdown into a styled PDF — headings, lists, quotes, and code fences, typeset right in your browser from sources up to ${MAX_SOURCE_MB} MB. The file stays on your device.`,
    category: "convert-to",
    icon: "markdown",
    // Client, not hybrid: the only implementation is the in-browser runner
    // (`markdown-to-pdf-runner`), which never calls the API, and no worker
    // processor claims this tool. Declaring `hybrid` promised a secure-worker
    // fallback that did not exist — it told users their file might be uploaded
    // when it never is, and made the job API accept jobs that could only fail
    // with `not_implemented`. Guarded by `processor/catalog-coverage.test.ts`.
    processing: "client",
    badge: "new",
    accept: ["MD", "MARKDOWN"],
    outputs: ["PDF"],
    keywords: ["markdown to pdf", "md to pdf", "readme to pdf", "docs to pdf"],
    related: ["pdf-to-markdown", "html-to-pdf", "text-to-pdf"],
    how: [
      "Paste Markdown into the editor, or pick a .md file — it stays on your device.",
      "Click “Create PDF” — the Markdown is typeset into pages in your browser.",
      "Click “Download PDF” to save it.",
    ],
  },
  {
    slug: "text-to-pdf",
    name: "Text to PDF",
    tagline: "Plain text into a formatted PDF.",
    description: `Turn plain .txt files into a clean, paginated PDF with sensible typography — sources up to ${MAX_SOURCE_MB} MB, typeset right in your browser. The file stays on your device.`,
    category: "convert-to",
    icon: "text",
    processing: "client",
    accept: ["TXT"],
    outputs: ["PDF"],
    keywords: ["text to pdf", "txt to pdf", "notes to pdf", "plain text pdf"],
    related: ["markdown-to-pdf", "word-to-pdf", "pdf-to-text"],
    how: [
      "Paste or type your text, or pick a .txt file — it stays on your device.",
      "Click “Create PDF” — the text is paginated in your browser.",
      "Click “Download PDF” to save it.",
    ],
  },

  // ─────────────────────────────── Convert from PDF ───────────────────────
  {
    slug: "pdf-to-word",
    name: "PDF to Word",
    // Was "Editable DOCX from any PDF" and "while preserving layout and text
    // flow": the engine writes plain paragraphs of selectable text — no
    // styles, images, tables or columns — and refuses a PDF with none. It
    // wrote one paragraph per line until the wave-1 L03 merge; it now reads
    // poppler's reading order (workers/pdf-text/flow.ts).
    // `worker-tool-answers.test.ts` and claims-vs-capability.test.ts decode a
    // real export against this copy.
    tagline: "Editable DOCX from a PDF's text.",
    description:
      "Turn a PDF's selectable text into editable Word (DOCX) paragraphs, in reading order. Images, fonts, tables and layout are not recreated; scans need OCR first.",
    category: "convert-from",
    icon: "word",
    processing: "server",
    badge: "popular",
    featured: true,
    accept: ["PDF"],
    outputs: ["DOCX"],
    keywords: ["pdf to word", "pdf to docx", "editable word", "convert pdf"],
    related: ["word-to-pdf", "pdf-to-text", "ocr-pdf"],
  },
  {
    slug: "pdf-to-excel",
    name: "PDF to Excel",
    // Was "Convert tables … with rows and columns intact": the engine does not
    // pull tables out. Until the wave-1 L03 merge it split each line at tabs,
    // wide gaps and COMMAS, so "1,250" landed in two cells; it now places
    // each run of text in the column it sits in (layout-grid.ts). Every break
    // named here is one the engine makes, and every one it makes is named —
    // checked on a decoded XLSX by claims-vs-capability.test.ts.
    tagline: "A PDF's text, line by line, in a sheet.",
    description:
      "A PDF’s selectable text in an XLSX sheet: a row per line, cells split at tabs and wide gaps and kept in their column. For tables, use Extract Tables.",
    category: "convert-from",
    icon: "excel",
    processing: "server",
    accept: ["PDF"],
    outputs: ["XLSX"],
    keywords: [
      "pdf to excel",
      "pdf to xlsx",
      "pdf text to excel",
      "convert pdf",
    ],
    related: ["extract-tables", "ocr-pdf", "excel-to-pdf", "pdf-to-word"],
  },
  {
    slug: "pdf-to-powerpoint",
    name: "PDF to PowerPoint",
    tagline: "Each PDF page's text on its own slide.",
    description:
      // Each slide is ONE unpositioned text box — no pictures, no layout.
      // claims-vs-capability.test.ts decodes the slides and requires the
      // "text only" qualifier for as long as that holds.
      "Put each PDF page’s selectable text on its own editable PowerPoint slide. Text only: images, charts and page layout are not carried over.",
    category: "convert-from",
    icon: "powerpoint",
    processing: "server",
    accept: ["PDF"],
    outputs: ["PPTX"],
    keywords: ["pdf to powerpoint", "pdf to pptx", "pdf to slides", "convert"],
    related: ["powerpoint-to-pdf", "ocr-pdf", "pdf-to-word", "pdf-to-jpg"],
  },
  {
    slug: "pdf-to-jpg",
    name: "PDF to JPG",
    tagline: "Render pages as JPG images.",
    description:
      "Export each PDF page as a high-resolution JPG image — rendered right in your browser.",
    category: "convert-from",
    icon: "jpg",
    processing: "client",
    badge: "popular",
    accept: ["PDF"],
    outputs: ["JPG", "ZIP"],
    keywords: ["pdf to jpg", "pdf to image", "pdf to jpeg", "convert pages"],
    related: ["jpg-to-pdf", "pdf-to-png", "extract-images"],
    how: [
      "Pick your PDF — it stays on your device.",
      `Choose a resolution: ${RESOLUTION_CHOICES}.`,
      "Click “Render” — every page becomes a JPG image, in your browser.",
      `Download the result — several pages arrive together as one ZIP, and each of the first ${RASTER_PREVIEW_LIMIT} pages can also be saved on its own from its preview.`,
    ],
  },
  {
    slug: "pdf-to-png",
    name: "PDF to PNG",
    tagline: "Export pages as lossless PNGs.",
    description:
      // Was "with a transparent or white background": every page is rendered
      // onto white (render.ts), and the runner offers no transparent option;
      // claims-vs-capability.test.ts goes red the day that changes.
      `Render PDF pages as crisp, lossless PNG images on a white background, at ${RESOLUTION_DPIS} DPI — right in your browser, so the file stays on your device.`,
    category: "convert-from",
    icon: "png",
    processing: "client",
    accept: ["PDF"],
    outputs: ["PNG", "ZIP"],
    keywords: ["pdf to png", "pdf to image", "lossless png", "convert pages"],
    related: ["png-to-pdf", "pdf-to-jpg", "extract-images"],
    how: [
      "Pick your PDF — it stays on your device.",
      `Choose a resolution: ${RESOLUTION_CHOICES}.`,
      "Click “Render” — every page becomes a PNG image, in your browser.",
      `Download the result — several pages arrive together as one ZIP, and each of the first ${RASTER_PREVIEW_LIMIT} pages can also be saved on its own from its preview.`,
    ],
  },
  {
    slug: "pdf-to-pdfa",
    name: "PDF to PDF/A",
    tagline: `Archive-oriented ${PDF_A_STANDARD}, made with Ghostscript.`,
    description: `Convert PDFs to ${PDF_A_STANDARD} for long-term archiving — processed by Ghostscript on a secure worker that deletes the input when the job finishes.`,
    category: "convert-from",
    icon: "pdfa",
    processing: "server",
    accept: ["PDF"],
    outputs: ["PDF/A"],
    keywords: ["pdf to pdfa", "pdf/a", "archive pdf", "iso 19005"],
    related: ["repair-pdf", "compress-pdf", "flatten-pdf"],
    how: [
      "Upload your PDF over an encrypted connection.",
      `Press “Convert to PDF/A”: Ghostscript converts it to ${PDF_A_STANDARD} on the secure worker, which deletes the input when the job finishes.`,
      `Download the result — the link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes. Anything the conversion had to remove is listed with the download.`,
    ],
  },
  {
    slug: "pdf-to-markdown",
    name: "PDF to Markdown",
    tagline: "Clean Markdown from PDF content.",
    description:
      "Convert a PDF's selectable text into clean Markdown locally, keeping paragraphs and obvious list lines. Scanned pages need OCR first.",
    category: "convert-from",
    icon: "markdown",
    processing: "client",
    badge: "new",
    accept: ["PDF"],
    outputs: ["MD"],
    keywords: [
      "pdf to markdown",
      "pdf to md",
      "extract markdown",
      "selectable text",
    ],
    related: ["markdown-to-pdf", "ocr-pdf", "extract-tables", "pdf-to-text"],
    how: [
      "Pick your PDF — it stays on your device.",
      "Select Create Markdown to convert its selectable text in your browser.",
      "Preview the Markdown on the page.",
      "Download the .md file.",
    ],
  },
  {
    slug: "pdf-to-text",
    name: "PDF to Text",
    tagline: "Extract selectable text from a PDF to .txt.",
    description:
      "Extract a PDF’s selectable text as a plain .txt file, right in your browser — the file stays on your device. Scanned PDFs need OCR first.",
    category: "convert-from",
    icon: "align",
    processing: "client",
    accept: ["PDF"],
    outputs: ["TXT"],
    keywords: ["pdf to text", "extract text", "pdf to txt", "copy text"],
    related: ["ocr-pdf", "compare-pdf", "pdf-to-markdown", "pdf-to-word"],
    how: [
      "Pick your PDF — it stays on your device.",
      "Select Extract text.",
      "Preview the extracted text on the page.",
      "Download it as a .txt file.",
    ],
  },
  {
    slug: "extract-tables",
    name: "Extract Tables",
    seoTitle: "Extract Tables from PDF to CSV & Excel",
    tagline: "Detected tables into CSV/Excel.",
    description:
      "Detect aligned tables inside a PDF's selectable text and export them to clean CSV files plus a combined Excel workbook. Scanned PDFs need OCR first.",
    category: "convert-from",
    icon: "table",
    processing: "server",
    badge: "new",
    accept: ["PDF"],
    outputs: ["CSV", "XLSX", "ZIP"],
    keywords: [
      "extract tables",
      "pdf tables",
      "table to csv",
      "table to excel",
    ],
    related: ["pdf-to-excel", "ocr-pdf", "ai-extract", "pdf-to-markdown"],
  },

  // ─────────────────────────────── Edit & Annotate ────────────────────────
  {
    slug: "edit-pdf",
    name: "Edit PDF",
    seoTitle: "Edit PDF — Add Text, Images & Shapes",
    tagline: "Add text, images, and shapes.",
    description:
      "Add new text, images, boxes, and lines to a PDF, then export a flattened copy — placed by coordinates in your browser. It doesn't rewrite the file's existing text.",
    category: "edit",
    icon: "edit",
    processing: "client",
    badge: "popular",
    featured: true,
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: [
      "edit pdf",
      "pdf editor",
      "add text to pdf",
      "insert image in pdf",
    ],
    related: [
      "pdf-to-word",
      "redact-pdf",
      "annotate-pdf",
      "sign-pdf",
      "watermark-pdf",
    ],
    how: [
      "Open your PDF — its pages are preserved exactly.",
      "Add text, images, boxes, or lines by page and position.",
      "Export a flattened PDF with your additions baked in.",
    ],
  },
  {
    slug: "annotate-pdf",
    name: "Annotate PDF",
    tagline: "Highlight, box, note, and draw.",
    description:
      "Add highlight boxes, outlines, text notes, and lines or arrows onto a PDF. Markups are flattened into the page as vector content — all in your browser.",
    category: "edit",
    icon: "annotate",
    processing: "client",
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: ["annotate pdf", "highlight pdf", "markup pdf", "draw on pdf"],
    related: ["edit-pdf", "redact-pdf", "sign-pdf"],
    how: [
      "Open your PDF and pick a markup: highlight, box, note, or line.",
      "Place it by page and coordinates (PDF points from the bottom-left).",
      "Apply to flatten the markups in and download the annotated PDF.",
    ],
  },
  {
    slug: "page-numbers",
    name: "Add Page Numbers",
    seoTitle: "Add Page Numbers to a PDF",
    tagline: "Insert page numbers your way.",
    description:
      // Count-free deliberately: the runner ships four presets AND a free-form
      // template field, so any number here is both wrong and drift-prone.
      "Add page numbers right in your browser — preset or custom number formats, with position, starting value, and typography. The file stays on your device.",
    category: "edit",
    icon: "pageNumbers",
    processing: "client",
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: ["page numbers", "number pages", "pagination", "bates"],
    related: ["header-footer", "overlay-pdf", "watermark-pdf", "edit-pdf"],
  },
  {
    slug: "watermark-pdf",
    name: "Add Watermark",
    seoTitle: "Add a Watermark to a PDF",
    tagline: "Stamp a text watermark on every page.",
    description:
      // Text only, drawn once per page (pdf/watermark.ts): no image input, no
      // tiling. claims-vs-capability.test.ts reads WatermarkOptions and goes
      // red the day an image or tile option lands, so the copy moves with it.
      "Stamp a text watermark on every page of a PDF in your browser — set the text, opacity, angle, size and color. The file never leaves your device.",
    category: "edit",
    icon: "watermark",
    processing: "client",
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: ["watermark pdf", "stamp pdf", "brand pdf", "confidential"],
    related: [
      "overlay-pdf",
      "grayscale-pdf",
      "header-footer",
      "page-numbers",
      "edit-pdf",
    ],
  },
  {
    slug: "crop-pdf",
    name: "Crop PDF",
    tagline: "Trim margins and crop pages.",
    description:
      "Crop PDF pages right in your browser — uniform margins or per-side control, applied to every page or only the ones you select. The file stays on your device.",
    category: "edit",
    icon: "crop",
    processing: "client",
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: ["crop pdf", "trim margins", "cut pdf", "resize pages"],
    related: ["rotate-pdf", "redact-pdf", "organize-pages", "edit-pdf"],
    how: [
      "Open the PDF you want to crop.",
      "Set the crop margins and choose which pages to apply them to.",
      "Download your cropped PDF.",
    ],
  },
  {
    slug: "header-footer",
    // The name carries the head term: it is the <title>, the H1 and the card.
    name: "PDF Header & Footer",
    tagline: "Add running headers and footers.",
    description:
      // The runner offers ONE text field per band with a Left/Center/Right
      // picker (not three slots at once) and the {n}/{total}/{date} buttons;
      // tool-page-content.test.ts pins the steps to those exports.
      "Add a header and footer to every page of a PDF in your browser — your own text plus the page number, page count or today's date, aligned left, center or right.",
    category: "edit",
    icon: "headerFooter",
    processing: "client",
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: [
      "add header and footer to pdf",
      "pdf footer",
      "running head",
      "date stamp",
    ],
    related: ["page-numbers", "overlay-pdf", "watermark-pdf", "edit-pdf"],
    how: [
      "Open the PDF you want to label — it stays on your device.",
      "Type your header text, footer text, or both — {n}, {total} and {date} insert the page number, the page count and today's date.",
      "Choose Left, Center or Right alignment for each.",
      "Download your PDF.",
    ],
  },
  {
    slug: "overlay-pdf",
    // The name carries the head term: it is the <title>, the H1 and the card.
    name: "Overlay PDF",
    tagline: "Stamp one PDF on top of another.",
    description:
      "Overlay a letterhead, stamp or template PDF on every page of another PDF, with adjustable scale and opacity — right in your browser. Both files stay on your device.",
    category: "edit",
    icon: "overlay",
    processing: "client",
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: [
      "overlay pdf",
      "add letterhead to pdf",
      "stamp pdf",
      "template overlay",
    ],
    related: ["watermark-pdf", "header-footer", "merge-pdf", "edit-pdf"],
  },

  // ─────────────────────────────── Sign & Forms ───────────────────────────
  {
    slug: "sign-pdf",
    name: "Sign PDF",
    tagline: "Draw, type, or upload a signature.",
    description:
      "Sign a PDF by drawing, typing, or picking a signature image, and place it precisely.",
    category: "sign",
    icon: "sign",
    processing: "client",
    badge: "popular",
    featured: true,
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: ["sign pdf", "esign", "signature", "e-signature", "self sign"],
    related: ["request-signatures", "fill-forms", "annotate-pdf"],
    how: [
      "Open the PDF you need to sign.",
      "Create a signature by drawing, typing, or picking an image.",
      "Place it, then export your signed PDF.",
    ],
  },
  {
    slug: "request-signatures",
    name: "Request Signatures",
    seoTitle: "Request Signatures — Prepare a PDF to Sign",
    // Was "Collect legally-binding e-signatures" and "Send a document to
    // others, track status": the engine prepares a package, and with no
    // e-signature provider wired (workers/request-signatures/native.ts) it
    // sends nothing and tracks nothing. claims-vs-capability.test.ts calls
    // the production deps and goes red the day a delivery provider is
    // wired. The tagline also renders on Sign PDF's related-tools card.
    tagline: "Prepare a PDF for others to sign.",
    description:
      "Add a fillable signature field (and an optional date) for each signer, then download a ZIP with the prepared PDF, a signer manifest and an audit trail. You send it.",
    category: "sign",
    icon: "requestSign",
    processing: "server",
    accept: ["PDF"],
    outputs: ["PDF", "JSON", "ZIP"],
    keywords: ["request signature", "prepare pdf for signing", "sign request"],
    related: ["sign-pdf", "fill-forms", "create-forms"],
    how: [
      "Upload your PDF over an encrypted connection.",
      `Add up to ${MAX_REQUEST_SIGNERS} signers — a name and an email each — with “Add signer”, then choose the “Signing order”, the “Signature page” their fields go on, and whether each signature gets a date field beside it.`,
      "Press “Prepare signature request”: the secure worker adds a named, fillable field for each signer and deletes the input when the job finishes.",
      `Download the ZIP — the link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes — and send ${REQUEST_PACKAGE_FILES.prepared} to your signers yourself: pdf.xyz does not email it or track who has signed.`,
    ],
  },
  {
    slug: "fill-forms",
    name: "Fill Forms",
    seoTitle: "Fill PDF Forms — Text, Checkboxes & Dropdowns",
    tagline: "Complete a PDF's existing form fields.",
    description:
      "Fill a PDF's existing AcroForm fields — text, checkboxes, radio buttons, dropdowns, and lists — right in your browser.",
    category: "sign",
    icon: "fillForm",
    processing: "client",
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: [
      "fill form",
      "pdf form",
      "complete form",
      "acroform",
      "form filler",
    ],
    related: ["create-forms", "edit-pdf", "sign-pdf", "flatten-pdf"],
  },
  {
    slug: "create-forms",
    name: "Create Fillable Forms",
    seoTitle: "Create Fillable PDF Forms",
    tagline: "Turn a PDF into a fillable form.",
    description:
      "Add text fields, checkboxes, dropdowns, radio groups, and lists by position to build a reusable fillable AcroForm PDF — right in your browser.",
    category: "sign",
    icon: "createForm",
    processing: "client",
    badge: "beta",
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: [
      "create form",
      "fillable pdf",
      "form builder",
      "add fields",
      "acroform",
    ],
    related: ["fill-forms", "sign-pdf", "request-signatures", "edit-pdf"],
  },

  // ─────────────────────────────── Security ───────────────────────────────
  {
    slug: "protect-pdf",
    name: "Protect PDF",
    seoTitle: "Password Protect PDF — AES Encryption",
    tagline: "Encrypt with a password.",
    description:
      "Password-protect a PDF with AES encryption, so only people with the password can open it. Encryption runs on an encrypted, auto-deleting secure worker.",
    category: "security",
    icon: "protect",
    processing: "server",
    badge: "popular",
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: [
      "password protect pdf",
      "encrypt pdf",
      "add password to pdf",
      "protect pdf",
    ],
    related: ["unlock-pdf", "redact-pdf", "flatten-pdf"],
  },
  {
    slug: "unlock-pdf",
    name: "Unlock PDF",
    tagline: "Remove a password you know.",
    description:
      "Remove a password you know: the one that opens the PDF, or the owner (permissions) password of a file that only locks editing. It never bypasses a password.",
    category: "security",
    icon: "unlock",
    processing: "server",
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: [
      "unlock pdf",
      "remove password from pdf",
      "decrypt pdf",
      "open pdf",
    ],
    related: ["protect-pdf", "flatten-pdf", "compress-pdf"],
    how: [
      "Upload the password-protected PDF over an encrypted connection.",
      "Type the password that currently opens it.",
      "The secure worker removes the encryption and deletes the input when the job finishes.",
      `Download the unlocked copy — the link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes.`,
    ],
  },
  {
    slug: "redact-pdf",
    name: "Redact PDF",
    tagline: "Permanently black out sensitive data.",
    description:
      "Cover sensitive areas with solid boxes, then rebuild each page as a flattened image so the text and vectors underneath are permanently removed — not just hidden.",
    category: "security",
    icon: "redact",
    processing: "client",
    badge: "new",
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: ["redact pdf", "black out", "remove sensitive", "hide text"],
    related: ["flatten-pdf", "ocr-pdf", "annotate-pdf", "protect-pdf"],
    how: [
      "Add your PDF — everything runs privately in your browser.",
      "Add redaction boxes by page and position, in PDF points from the bottom-left.",
      "Download a rasterized PDF whose pages are flattened images with the content erased under each box.",
    ],
  },
  {
    slug: "flatten-pdf",
    name: "Flatten PDF",
    seoTitle: "Flatten PDF Forms — Lock Filled Fields",
    tagline: "Lock fillable form fields into the page.",
    description:
      "Flatten a filled PDF form in your browser, so its answers become part of the page and can't be edited. Comments and layers are kept as they are.",
    category: "security",
    icon: "flatten",
    processing: "client",
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: [
      "flatten pdf",
      "flatten form",
      "lock form fields",
      "lock content",
    ],
    related: ["fill-forms", "redact-pdf", "protect-pdf"],
    how: [
      "Open a PDF with fillable form fields.",
      "Select Flatten form fields — each field's current value is drawn into the page.",
      "Download a PDF whose field values can no longer be edited.",
    ],
  },
  {
    slug: "compare-pdf",
    name: "Compare PDF",
    tagline: "Compare two PDFs locally.",
    description:
      "Compare two PDFs in your browser by page count, file size, and selectable text. Scanned pages need OCR first; this is not a pixel-perfect visual diff.",
    category: "security",
    icon: "compare",
    processing: "client",
    badge: "new",
    accept: ["PDF"],
    outputs: ["TXT"],
    keywords: ["compare pdf", "pdf diff", "text difference", "version compare"],
    related: ["ocr-pdf", "pdf-to-text", "redact-pdf", "annotate-pdf"],
    // Two files, in an order that matters: compare-pdf.ts reports lines only
    // in the FIRST as removed and lines only in the SECOND as added.
    how: [
      "Pick two PDFs — the first is treated as the original, the second as the revised version. Both stay on your device.",
      "Select Compare PDFs to compare their page count, file size and selectable text.",
      "Review the lines marked removed (-) and added (+), then download the comparison report as a .txt file.",
    ],
  },

  // ─────────────────────────────── AI Tools ───────────────────────────────
  {
    slug: "chat-with-pdf",
    name: "Chat with PDF",
    tagline: "Ask questions, get cited answers.",
    // One PDF per conversation: the job contract, the engine and the panel all take a
    // single document. This used to promise "one or many", which nothing could deliver.
    description:
      "Ask questions about a PDF and get answers grounded in the document, with page citations and follow-ups.",
    category: "ai",
    icon: "chat",
    processing: "ai",
    badge: "ai",
    featured: true,
    accept: ["PDF"],
    outputs: ["MD", "TXT", "ZIP"],
    keywords: ["chat pdf", "ask pdf", "pdf q&a", "ai pdf", "talk to pdf"],
    related: ["summarize-pdf", "extract-tables", "ai-extract"],
    how: [
      "Upload your PDF.",
      "Ask a question in plain language.",
      "Get a grounded answer with page-level citations, then ask follow-ups.",
    ],
  },
  {
    slug: "summarize-pdf",
    name: "Summarize PDF",
    tagline: "Key points and TL;DR in seconds.",
    description:
      "Generate concise summaries, bullet takeaways, and section outlines from long PDFs.",
    category: "ai",
    icon: "summarize",
    processing: "ai",
    badge: "ai",
    accept: ["PDF"],
    outputs: ["TXT", "MD", "ZIP"],
    keywords: ["summarize pdf", "tldr pdf", "ai summary", "key points"],
    related: ["chat-with-pdf", "translate-pdf", "pdf-to-markdown"],
  },
  {
    slug: "translate-pdf",
    name: "Translate PDF",
    tagline: "Translate a PDF's text into another language.",
    description:
      "Translate a PDF's selectable text into another language with AI, packaged as translated Markdown and plain text.",
    category: "ai",
    icon: "translate",
    processing: "ai",
    badge: "ai",
    accept: ["PDF"],
    outputs: ["MD", "TXT", "ZIP"],
    keywords: ["translate pdf", "pdf translation", "ai translate", "language"],
    // Translate writes Markdown, so the tool that typesets Markdown into a PDF
    // is the next step a reader needs; it had no link from here.
    related: ["markdown-to-pdf", "summarize-pdf", "ocr-pdf"],
  },
  {
    slug: "ai-extract",
    name: "AI Data Extraction",
    seoTitle: "Extract Data from PDF to JSON with AI",
    tagline: "Pull structured fields from PDFs.",
    description:
      "Extract fields from PDF invoices, receipts and contracts into clean JSON with AI — read from the PDF's selectable text.",
    category: "ai",
    icon: "aiExtract",
    processing: "ai",
    badge: "ai",
    accept: ["PDF"],
    outputs: ["JSON", "MD", "ZIP"],
    keywords: [
      "extract data from pdf",
      "pdf to json",
      "invoice data extraction",
      "ai extraction",
    ],
    related: ["extract-tables", "ocr-pdf", "chat-with-pdf", "pdf-to-excel"],
  },
];
