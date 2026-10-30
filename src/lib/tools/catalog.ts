import type { Tool } from "./types";
import { MAX_IMAGE_MB, MAX_SOURCE_MB } from "./limits";
import { RASTER_RESOLUTION_DPIS as RESOLUTION_DPIS } from "@/lib/pdf/raster-format";
import { PDF_A_STANDARD } from "@/lib/jobs/pdfa-results";

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
    // A merged document is most often made smaller to send, or numbered.
    next: ["compress-pdf", "page-numbers"],
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
  },
  {
    slug: "organize-pages",
    name: "Organize Pages",
    seoTitle: "Organize PDF Pages — Reorder, Rotate & Delete",
    tagline: "Reorder, rotate, and delete pages visually.",
    description:
      "Rearrange, rotate, duplicate, and delete pages, or insert blank ones, on a visual page board, then export a clean PDF.",
    category: "organize",
    icon: "organize",
    processing: "client",
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: ["organize pdf", "reorder pages", "rearrange pdf", "sort pages"],
    related: ["merge-pdf", "remove-pages", "page-numbers", "rotate-pdf"],
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
  },
  {
    slug: "n-up-pdf",
    name: "Multiple Pages per Sheet",
    tagline: "Put 2, 4, 6 or 9 pages on one sheet.",
    description:
      "Put 2, 4, 6 or 9 PDF pages on each A4 or US Letter sheet, in the order you pick, with optional borders. Runs in your browser.",
    category: "organize",
    icon: "nUp",
    processing: "client",
    badge: "new",
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: ["n-up pdf", "pages per sheet", "2 up pdf"],
    related: ["organize-pages", "resize-pdf", "merge-pdf"],
  },

  // ─────────────────────────────── Optimize ───────────────────────────────
  {
    slug: "compress-pdf",
    name: "Compress PDF",
    tagline: "Analyze size and optimize losslessly.",
    cardSummary:
      "See what makes a PDF large, and repack it without losing quality.",
    description:
      "See exactly what's inflating your PDF and losslessly repack it in your browser. Deep image downsampling runs on a secure, auto-deleting server.",
    category: "optimize",
    icon: "compress",
    processing: "hybrid",
    badge: "popular",
    featured: true,
    accept: ["PDF"],
    outputs: ["PDF", "ZIP"],
    keywords: ["compress pdf", "reduce size", "shrink pdf", "optimize size"],
    related: ["optimize-web", "remove-pages", "repair-pdf"],
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
  },
  {
    slug: "optimize-web",
    // The name carries the head term: it is the <title>, the H1 and the card.
    name: "Optimize PDF for Web",
    tagline: "Fast-loading, linearized PDFs.",
    cardSummary:
      "Let a PDF's first page show while the rest is still downloading.",
    description:
      "Linearize a PDF for Fast Web View, so its first page can show while the rest downloads — not compression. Runs on a server that deletes the input after the job.",
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
    cardSummary: "Turn Word documents into a PDF that's easy to share.",
    description:
      // LibreOffice lays the document out, not Word. Since the wave-1 L03
      // merge the worker image installs metric clones of Calibri, Cambria,
      // Arial, Times New Roman and Courier New (office-conversion/fonts.ts) —
      // substitutes, not the fonts themselves, with none for Aptos, Word's
      // default since 2023, and only in an image rebuilt from that commit.
      // claims-vs-capability.test.ts bans fidelity promises.
      "Convert Word documents to PDF, rendered by LibreOffice on a secure server that deletes the input after the job. Fonts our server lacks are substituted.",
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
      "Convert Excel workbooks and CSV files to PDF — laid out by LibreOffice on a secure server that deletes the input when the job finishes.",
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
      "Convert PowerPoint presentations to PDF, one slide per page — rendered by LibreOffice on a secure server that deletes the input when the job finishes.",
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
      // HISTORY: shipped as "with control over orientation, margins, and page
      // size" over an engine with none of the three; then, from 67e8d0f, the
      // fixed layout ("each centered on its own US Letter portrait page with a
      // half-inch margin"). The controls arrived 2026-10-24
      // (pdf/image-page-layout.ts), so the copy may name them again — and
      // claims-vs-capability.test.ts runs the engine with every page size and
      // margin this copy names, and fails one the runner does not offer.
      "Combine JPG photos into one PDF, or one PDF each — pick the page size (A4, US Letter, fit to image and more), orientation and margin. Files stay on your device.",
    category: "convert-to",
    icon: "jpg",
    processing: "client",
    badge: "popular",
    // Both image runners take PNG and JPEG alike, and the page's "In:" row
    // reads this list (image-to-pdf-accept.test.ts holds it to the gate).
    // WEBP, GIF and BMP since 2026-10-30: decoded in the browser and
    // re-encoded (image-transcode.ts), on both image tools.
    accept: ["JPG", "JPEG", "PNG", "WEBP", "GIF", "BMP"],
    // ZIP: "One PDF per image" delivers the PDFs as one archive.
    outputs: ["PDF", "ZIP"],
    keywords: ["jpg to pdf", "jpeg to pdf", "image to pdf", "photos to pdf"],
    related: ["png-to-pdf", "scan-to-pdf", "pdf-to-jpg", "merge-pdf"],
  },
  {
    slug: "png-to-pdf",
    name: "PNG to PDF",
    tagline: "Turn PNGs into a crisp PDF.",
    description: `Convert PNG images — transparent ones included — into one PDF or one PDF each, up to ${MAX_IMAGE_MB} MB per image, assembled in your browser. Files stay on your device.`,
    category: "convert-to",
    icon: "png",
    processing: "client",
    accept: ["PNG", "JPG", "JPEG", "WEBP", "GIF", "BMP"],
    // ZIP: "One PDF per image" delivers the PDFs as one archive.
    outputs: ["PDF", "ZIP"],
    keywords: ["png to pdf", "image to pdf", "transparent png pdf", "logos"],
    related: ["jpg-to-pdf", "pdf-to-png", "merge-pdf"],
  },
  {
    slug: "scan-to-pdf",
    name: "Scan to PDF",
    tagline: "Photograph pages into one PDF.",
    description:
      "Photograph pages with your phone's camera, or pick photos, and get one PDF with a Document or Black & white clean-up. Runs in your browser.",
    category: "convert-to",
    icon: "scan",
    processing: "client",
    badge: "new",
    accept: ["JPG", "JPEG", "PNG"],
    outputs: ["PDF"],
    keywords: ["scan to pdf", "pdf scanner", "camera to pdf"],
    related: ["jpg-to-pdf", "ocr-pdf", "compress-pdf"],
  },
  {
    slug: "html-to-pdf",
    name: "HTML to PDF",
    tagline: "Render HTML files as PDF.",
    cardSummary: "Turn an HTML file into a PDF.",
    description:
      "Convert an HTML file into PDF with a real Chromium rendering engine on a secure server that deletes the input when the job finishes.",
    category: "convert-to",
    icon: "html",
    processing: "server",
    accept: ["HTML", "HTM"],
    outputs: ["PDF"],
    keywords: ["html to pdf", "render html", "web to pdf", "markup to pdf"],
    related: ["webpage-to-pdf", "markdown-to-pdf", "word-to-pdf"],
  },
  {
    slug: "webpage-to-pdf",
    name: "Webpage to PDF",
    tagline: "Capture a public web page URL as a PDF.",
    description:
      "Enter a URL and capture the fully rendered page as a print-quality PDF — Chromium renders it on a secure server that deletes the input when the job finishes.",
    category: "convert-to",
    icon: "web",
    processing: "server",
    accept: ["URL"],
    outputs: ["PDF"],
    keywords: ["webpage to pdf", "url to pdf", "website to pdf", "save page"],
    related: ["html-to-pdf", "markdown-to-pdf", "compress-pdf"],
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
  },

  // ─────────────────────────────── Convert from PDF ───────────────────────
  {
    slug: "pdf-to-word",
    name: "PDF to Word",
    // Was "Editable DOCX from any PDF" and "while preserving layout and text
    // flow": the engine writes plain paragraphs of selectable text — no
    // styles, tables or columns — and refuses a PDF with none. It wrote one
    // paragraph per line until the wave-1 L03 merge; it now reads poppler's
    // reading order (workers/pdf-text/flow.ts). CHANGED 2026-10-17: it also
    // carries every raster picture between the paragraphs around it
    // (pdf-office-export/docx-layout.ts), so "Images … are not recreated"
    // became false; the tagline was "Editable DOCX from a PDF's text.".
    // `worker-tool-answers.test.ts` and claims-vs-capability.test.ts decode a
    // real export against this copy.
    tagline: "Editable DOCX from a PDF's text and pictures.",
    cardSummary: "Turn a PDF's text and pictures into an editable Word file.",
    description:
      "Turn a PDF's text into editable Word (DOCX) paragraphs in reading order, its pictures placed between them. Fonts and layout are not recreated; scans need OCR first.",
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
    tagline: "Each PDF page as a slide, pictures and text in place.",
    description:
      // Since 2026-10-10 each slide carries the page's pictures where they
      // are, its text as positioned text boxes, and its other drawing as
      // pictures. Until then it said "Text only: images, charts and page
      // layout are not carried over", true of the one-text-box engine; the
      // claims-vs-capability rule is now two-way, decoding the slides: "text
      // only" is required exactly when they carry no pictures.
      // Until 2026-10-09 this said "its own editable PowerPoint slide", served
      // as JSON-LD and in site search, while nobody had edited one: the only
      // PowerPoint check opens the file read-only. That test file's rule
      // "PDF to PowerPoint slides are editable" holds the page and its guides
      // to that, and says what would license the word.
      "Turn each PDF page into a slide in a .pptx file: pictures where the page shows them, text in text boxes at their places, other drawing kept as pictures.",
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
    cardSummary: "Turn each page into a JPG image.",
    description:
      "Export every PDF page, or just the ones you pick, as a high-resolution JPG image in colour or grayscale — rendered right in your browser.",
    category: "convert-from",
    icon: "jpg",
    processing: "client",
    badge: "popular",
    accept: ["PDF"],
    outputs: ["JPG", "ZIP"],
    keywords: ["pdf to jpg", "pdf to image", "pdf to jpeg", "convert pages"],
    related: ["jpg-to-pdf", "pdf-to-png", "extract-images"],
  },
  {
    slug: "pdf-to-png",
    name: "PDF to PNG",
    tagline: "Export pages as lossless PNGs.",
    cardSummary: "Save each page as a sharp PNG image.",
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
  },
  {
    slug: "pdf-to-pdfa",
    name: "PDF to PDF/A",
    tagline: `Archive-oriented ${PDF_A_STANDARD}, made with Ghostscript.`,
    cardSummary:
      "Save a PDF in the PDF/A format, made for long-term archiving.",
    description: `Convert PDFs to ${PDF_A_STANDARD} for long-term archiving — processed by Ghostscript on a secure server that deletes the input when the job finishes.`,
    category: "convert-from",
    icon: "pdfa",
    processing: "server",
    accept: ["PDF"],
    outputs: ["PDF/A"],
    keywords: ["pdf to pdfa", "pdf/a", "archive pdf", "iso 19005"],
    related: ["repair-pdf", "compress-pdf", "flatten-pdf"],
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
  },
  {
    slug: "extract-tables",
    name: "Extract Tables",
    seoTitle: "Extract Tables from PDF to CSV & Excel",
    tagline: "Detected tables into CSV/Excel.",
    // WAS "Copy the tables in a PDF's text into spreadsheet files.": once
    // every card took the summary (2026-10-23), PDF to Excel's page served it
    // in Related tools, and "tables … into spreadsheets" is the promise
    // worker-tool-answers.test.ts holds that page clear of.
    cardSummary:
      "Find the tables in a PDF's text and save them as spreadsheets.",
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
    seoTitle: "Edit PDF — Edit Text, Add Images & Shapes",
    tagline: "Edit text, add images and shapes.",
    description:
      "Click a line of the PDF's own text to retype it, find and replace words, redact, or add text, images, signatures, shapes, highlights and notes, all in your browser.",
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
      "ocr-pdf",
      "redact-pdf",
      "annotate-pdf",
      "sign-pdf",
      "watermark-pdf",
    ],
  },
  {
    slug: "annotate-pdf",
    name: "Annotate PDF",
    tagline: "Highlight, draw, and add notes.",
    description:
      "Highlight, draw, white out and add notes by dragging and clicking on your PDF's pages. Flatten the markups or keep them editable — all in your browser.",
    category: "edit",
    icon: "annotate",
    processing: "client",
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: ["annotate pdf", "highlight pdf", "markup pdf", "draw on pdf"],
    related: ["edit-pdf", "redact-pdf", "sign-pdf"],
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
    tagline: "Stamp a text or image watermark on your pages.",
    description:
      // Text or a PNG/JPEG, in any of nine cells or tiled, on all or listed
      // pages (pdf/watermark.ts). Until 2026-10-24 this said text only, and
      // claims-vs-capability.test.ts held "image" and "tiled" off the page
      // while WatermarkOptions had neither; that rule now checks the output.
      "Stamp a text or image watermark on a PDF in your browser: place it anywhere or tile it, on the pages you pick, with opacity, angle, font and color. No upload.",
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
      "Crop PDF pages in your browser — even margins, per side, or the white margins found for you, on every page or the ones you pick. The file stays on your device.",
    category: "edit",
    icon: "crop",
    processing: "client",
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: ["crop pdf", "trim margins", "cut pdf", "resize pages"],
    related: ["rotate-pdf", "redact-pdf", "organize-pages", "edit-pdf"],
  },
  {
    slug: "resize-pdf",
    name: "Resize PDF",
    // "size" stays out of the tagline and keywords: it is a synonym of
    // "compress" (intents.ts), and a search for compress must not offer this.
    tagline: "Change pages to A4, Letter and more.",
    description:
      "Change a PDF's pages to A4, US Letter, Legal, A3, A5 or a custom size, scaling the content or only the canvas. Runs in your browser.",
    category: "edit",
    icon: "resize",
    processing: "client",
    badge: "new",
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: ["resize pdf", "letter to a4", "scale pdf"],
    related: ["crop-pdf", "n-up-pdf", "rotate-pdf"],
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
  {
    slug: "edit-pdf-metadata",
    name: "Edit PDF Metadata",
    tagline: "Change or remove a PDF's title, author and dates.",
    description:
      "View and edit a PDF's title, author, subject, keywords and dates, or remove them all, XMP included. Runs in your browser.",
    category: "edit",
    icon: "metadata",
    processing: "client",
    badge: "new",
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: ["pdf metadata", "pdf properties", "remove pdf metadata"],
    related: ["protect-pdf", "redact-pdf", "flatten-pdf"],
  },

  // ─────────────────────────────── Sign & Forms ───────────────────────────
  {
    slug: "sign-pdf",
    name: "Sign PDF",
    tagline: "Draw, type, or upload a signature.",
    description:
      "Sign a PDF by drawing, typing, or picking a signature image, then click on the page to place it — on as many pages as you need.",
    category: "sign",
    icon: "sign",
    processing: "client",
    badge: "popular",
    featured: true,
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: ["sign pdf", "esign", "signature", "e-signature", "self sign"],
    related: ["request-signatures", "fill-forms", "annotate-pdf"],
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
      "Password-protect a PDF with AES encryption, so only people with the password can open it. Encryption runs on an auto-deleting secure server.",
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
    related: ["unlock-pdf", "redact-pdf", "edit-pdf-metadata", "flatten-pdf"],
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
  },
  {
    slug: "redact-pdf",
    name: "Redact PDF",
    tagline: "Permanently black out sensitive data.",
    description:
      "Find text or detect personal data and black it out so it is permanently removed: flatten each page to an image, or take out only the text under each box.",
    category: "security",
    icon: "redact",
    processing: "client",
    badge: "new",
    accept: ["PDF"],
    outputs: ["PDF"],
    keywords: [
      "redact pdf",
      "black out",
      "remove sensitive",
      "hide text",
      "find and redact",
    ],
    related: ["flatten-pdf", "ocr-pdf", "annotate-pdf", "protect-pdf"],
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
  },
  {
    slug: "summarize-pdf",
    name: "Summarize PDF",
    tagline: "Key points and TL;DR in seconds.",
    cardSummary: "Get the key points and an outline of a long PDF.",
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
    cardSummary:
      "Pull details like totals and dates from invoices and receipts.",
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
