/**
 * The guides catalogue — every how-to article, as data.
 *
 * House rules for this file, enforced by the walls it is registered into
 * (copy-surface, the numbers census, legal-pages' overclaim scan,
 * capability-hedges, and its own catalog.test.ts):
 *
 *  - No hand-written figures. Every number with a unit is interpolated from
 *    the constant that governs the behavior, so the prose cannot go stale
 *    under a changed cap. No trailing unit comments either — only full-line
 *    comments are stripped by the copy walls.
 *  - Claims are grounded in the tools catalogue and tool-facts. Each guide
 *    was drafted from those sources and adversarially verified against them
 *    (two lenses per draft, plus a re-check after revision) before assembly.
 *  - Steps tell the truth about where the primary tool runs: in-browser
 *    guides never say upload; worker-backed guides always do.
 */
import { getToolBySlug } from "@/lib/tools";
import { STAMP_POSITIONS } from "@/lib/pdf/stamp";
import { toolFileCeilingMb } from "@/lib/tools/file-ceilings";
import { MAX_IMAGE_MB, MAX_SOURCE_MB } from "@/lib/tools/limits";
import {
  IMAGE_PAGE_MARGIN_PT,
  US_LETTER_LABEL,
  inches,
} from "@/lib/pdf/page-geometry";
import { HYBRID_WORKER_STEP } from "@/lib/tools/processing";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { OCR_LANGUAGES, MAX_OCR_LANGUAGES } from "@/lib/jobs/ocr";
import { aiAllowanceFactFor } from "@/lib/jobs/ai-allowance";
import {
  EVERY_OTHER_PAGE_EXAMPLE,
  MARKDOWN_SYNTAX_FACT,
  PDF_TO_WORD_KEEPS,
  pageToolKeeps,
  pageToolKeepsAnswer,
  REDACT_FIND_FACT,
  REDACT_MECHANISM,
  REDACT_OUTPUT_FACT,
  REDACT_PRESET_CHOICES,
  REDACT_RECOVERY_ANSWER,
  REDACT_REMOVE_FACT,
  REDACT_SEARCH_ANSWER,
  REPAIR_TAKES,
  REPAIR_WARNINGS_ANSWER,
  IMAGE_PAGE_FACT,
  IMAGE_PAGE_OPTIONS_FACT,
  TEXT_PAGE_FACT,
  TRANSLATE_LANGUAGES_ANSWER,
  countWord,
  forgottenPasswordAnswer,
  offlineAnswer,
  PRIVATE_ADDRESS_EXAMPLES,
} from "@/lib/tools/tool-facts";
import { TRANSLATE_LANGUAGES } from "@/lib/jobs/translate-pdf";
import {
  DEFAULT_JPEG_QUALITY,
  DEFAULT_RESOLUTION_ID,
  RASTER_MAX_DEVICE_PX,
  RASTER_PREVIEW_LIMIT,
  RASTER_RESOLUTION_CHOICES,
  RASTER_RESOLUTIONS,
  pageImageName,
  resolutionById,
  type RasterResolution,
} from "@/lib/pdf/pdf-to-image";
import { MAX_EDIT_IMAGE_BYTES } from "@/lib/pdf/edit";
import {
  SIGNATURE_SOURCES,
  SIGNATURE_STYLE_LABEL,
  SIGNATURE_STYLES,
} from "@/lib/pdf/offered-kinds";
import { STAMP_FONT_FAMILIES, STAMP_FONT_LABELS } from "@/lib/pdf/stamp";
import { LENGTH_UNITS } from "@/lib/pdf/length-units";
import { MIN_CROP_DIMENSION } from "@/lib/pdf/page-geometry";
import { AUTO_CROP_PAD_PT } from "@/lib/pdf/auto-crop";
import { MAX_HISTORY } from "@/components/tools/runner/organize-history";
import {
  DEFAULT_OCR_LANGUAGE,
  OCR_OUTPUT_MODES,
  PDF_TO_WORD_OCR_LANGUAGE_CODES,
  RTL_OCR_LANGUAGES,
  describeOcrLanguage,
  type OcrLanguage,
  type OcrOutputMode,
} from "@/lib/jobs/ocr";
import {
  WORD_OCR_LABEL,
  XLSX_CELL_BREAK_PHRASE,
  XLSX_MERGE_CAVEAT,
  XLSX_NUMBER_EXAMPLES,
  XLSX_SHEET_NAME,
  XLSX_TEXT_EXAMPLE,
} from "@/lib/jobs/pdf-office-export";
import {
  HTML_LAYOUT_STEP,
  htmlLayoutAnswer,
} from "@/lib/tools/html-layout-copy";
import { MAX_SCAN_SIDE_PX, SCAN_PAGE_SIZES } from "@/lib/pdf/scan-to-pdf";
import { SCAN_ENHANCEMENTS } from "@/lib/pdf/scan-enhance";
import { METADATA_DATE_FIELDS, METADATA_TEXT_FIELDS } from "@/lib/pdf/metadata";
import {
  MAX_RESIZE_SIDE_PT,
  MIN_RESIZE_SIDE_PT,
  RESIZE_MODES,
  RESIZE_ORIENTATIONS,
  RESIZE_SIZES,
} from "@/lib/pdf/resize";
import {
  N_UP_BORDER_PT,
  N_UP_COUNTS,
  N_UP_MARGINS,
  N_UP_ORDERS,
  N_UP_ORIENTATIONS,
  N_UP_SHEETS,
  type NUpCount,
} from "@/lib/pdf/n-up";
import { PT_PER_INCH } from "@/lib/pdf/page-geometry";
import {
  BATES_MAX_DIGITS,
  DEFAULT_BATES_DIGITS,
  NUMBER_STYLES,
  batesFormat,
  previewPageNumber,
  type NumberStyle,
} from "@/lib/pdf/page-numbers";
import { MERGE_MODE_LABEL } from "@/lib/pdf/merge-order";
import {
  DECODED_IMAGE_LABELS,
  REFUSED_IMAGE_LABELS,
} from "@/lib/pdf/image-to-pdf";
import { TRANSCODE_JPEG_QUALITY } from "@/lib/pdf/image-transcode";
import type { Guide } from "./types";

/**
 * Sign PDF's counts, from the lists the runner offers. The guide used to say
 * "five ways to make a signature", counting the typed signature once per font
 * style and naming a "print-and-scan style" the runner does not have.
 */
const signatureWays = countWord(SIGNATURE_SOURCES.length);

/** The raster preset selected when PDF to JPG / PNG opens, by its label. */
const DEFAULT_RESOLUTION_LABEL = resolutionById(DEFAULT_RESOLUTION_ID).label;
const signatureStyles = SIGNATURE_STYLES.map((s) =>
  SIGNATURE_STYLE_LABEL[s].toLowerCase(),
);

/**
 * The per-file cap a guide states, read from the SAME source the tool's own
 * page answers "How large can my file be?" from. A guide never types the
 * number; it names the tool, and the figure follows the constant.
 */
function ceilingMb(slug: string): number {
  const tool = getToolBySlug(slug);
  const mb = tool ? toolFileCeilingMb(tool) : null;
  if (mb === null) {
    throw new Error(
      `a guide states a per-file cap for "${slug}", which has no file ceiling`,
    );
  }
  return mb;
}

/**
 * A tool's CURRENT catalogue name. A guide that names a neighbour by a typed
 * string went stale the day three tools were renamed; this one cannot.
 */
function nameOf(slug: string): string {
  const tool = getToolBySlug(slug);
  if (!tool) throw new Error(`a guide names unknown tool "${slug}"`);
  return tool.name;
}

/**
 * A render-resolution preset a guide describes, by id — read from the list the
 * PDF-to-image runner offers. Throws rather than falling back: a guide that
 * describes "Print" must not silently describe the default instead.
 */
function rasterPreset(id: string): RasterResolution {
  const preset = RASTER_RESOLUTIONS.find((r) => r.id === id);
  if (!preset) {
    throw new Error(
      `a guide describes raster preset "${id}", which is not offered`,
    );
  }
  return preset;
}

const presetText = (r: RasterResolution) => `${r.label} (${r.dpi} DPI)`;

/** Edit PDF's per-image cap, in MB — the same arithmetic its image picker shows. */
const EDIT_IMAGE_MB = Math.round(MAX_EDIT_IMAGE_BYTES / (1024 * 1024));

const listAnd = (items: readonly string[]) =>
  new Intl.ListFormat("en", { type: "conjunction" }).format(items);
const listOr = (items: readonly string[]) =>
  new Intl.ListFormat("en", { type: "disjunction" }).format(items);

/** Add Watermark's Font choices, as its runner labels them. */
const WATERMARK_FONTS = listOr(
  STAMP_FONT_FAMILIES.map((family) => STAMP_FONT_LABELS[family]),
);

/** Crop PDF's unit buttons, as the runner offers them. */
const CROP_UNITS = listOr(LENGTH_UNITS);

/** An OCR output mode's label, by id — throws rather than describe another. */
function ocrModeLabel(id: OcrOutputMode): string {
  const mode = OCR_OUTPUT_MODES.find((entry) => entry.id === id);
  if (!mode) throw new Error(`a guide names unknown OCR output mode "${id}"`);
  return mode.label;
}

/**
 * The OCR language menu, by label, from the allowlist the job API accepts
 * and the worker image's packs are tested against.
 */
const OCR_LANGUAGE_NAMES = listAnd(OCR_LANGUAGES.map((l) => l.label));
/** Example scripts a guide names; each is a typed `OcrLanguage`, so a withdrawn one fails the build. */
const OCR_EXAMPLES: readonly OcrLanguage[] = ["ben", "hin", "ara", "tam"];
const OCR_EXAMPLE_NAMES = listAnd(OCR_EXAMPLES.map(describeOcrLanguage));
/** The right-to-left languages PDF to Word's OCR option withholds. */
const RTL_OCR_NAMES = listAnd(RTL_OCR_LANGUAGES.map(describeOcrLanguage));

/** PDF to Excel's amount examples, as the engine stores them as numbers. */
const XLSX_AMOUNTS = listOr(XLSX_NUMBER_EXAMPLES);

/**
 * A control's on-screen label, by id, from the list the runner draws its
 * buttons from. Throws rather than describe a choice the runner dropped.
 */
function labelOf<T extends { id: string; label: string }>(
  list: readonly T[],
  id: T["id"],
): string {
  const found = list.find((entry) => entry.id === id);
  if (!found) throw new Error(`a guide names unknown choice "${id}"`);
  return found.label;
}

/** Scan to PDF's Clean-up and Page size choices, as its runner labels them. */
const SCAN_CLEANUPS = listOr(SCAN_ENHANCEMENTS.map((e) => e.label));
const SCAN_SIZES = listOr(SCAN_PAGE_SIZES.map((s) => s.label));
const SCAN_DOCUMENT = labelOf(SCAN_ENHANCEMENTS, "document");
const SCAN_BW = labelOf(SCAN_ENHANCEMENTS, "bw");
const SCAN_ORIGINAL = labelOf(SCAN_ENHANCEMENTS, "original");
const SCAN_FIT = labelOf(SCAN_PAGE_SIZES, "fit");
const SCAN_FIXED_SIZES = listAnd(
  SCAN_PAGE_SIZES.filter((s) => s.id !== "fit").map((s) => s.label),
);
const SCAN_LONG_SIDE = MAX_SCAN_SIDE_PX.toLocaleString("en-US");

/** Edit PDF Metadata's fields, as its Document properties section labels them. */
const METADATA_TEXT_NAMES = listAnd(METADATA_TEXT_FIELDS.map((f) => f.label));
const METADATA_DATE_NAMES = listAnd(METADATA_DATE_FIELDS.map((f) => f.label));

/** Resize PDF's choices, as its runner labels them. */
const RESIZE_SIZE_NAMES = listOr(RESIZE_SIZES.map((s) => s.label));
const RESIZE_UNITS = listOr(LENGTH_UNITS);
const RESIZE_FIT = labelOf(RESIZE_MODES, "fit");
const RESIZE_CANVAS = labelOf(RESIZE_MODES, "canvas");
const RESIZE_MATCH = labelOf(RESIZE_ORIENTATIONS, "match");
const RESIZE_FIXED_ORIENTATIONS = listOr(
  RESIZE_ORIENTATIONS.filter((o) => o.id !== "match").map((o) => o.label),
);
const RESIZE_A4 = labelOf(RESIZE_SIZES, "a4");
const RESIZE_LETTER = labelOf(RESIZE_SIZES, "letter");
const RESIZE_MIN_IN = MIN_RESIZE_SIDE_PT / PT_PER_INCH;
const RESIZE_MAX_IN = MAX_RESIZE_SIDE_PT / PT_PER_INCH;

/** Multiple Pages per Sheet's choices, as its runner labels them. */
const N_UP_COUNT_NAMES = listOr(N_UP_COUNTS.map(String));
const N_UP_SHEET_NAMES = listOr(N_UP_SHEETS.map((s) => s.label));
const N_UP_ORDER_NAMES = listOr(N_UP_ORDERS.map((o) => o.label));
const N_UP_ACROSS = labelOf(N_UP_ORDERS, "across");
const N_UP_DOWN = labelOf(N_UP_ORDERS, "down");
const N_UP_AUTO = labelOf(N_UP_ORIENTATIONS, "auto");
const N_UP_FIXED_ORIENTATIONS = listOr(
  N_UP_ORIENTATIONS.filter((o) => o.id !== "auto").map((o) => o.label),
);
const N_UP_MARGIN_NAMES = listOr(
  N_UP_MARGINS.map((m) =>
    m.points > 0 ? `${m.label} (${m.points} points)` : m.label,
  ),
);
/** "2-up": a count the runner offers, or the build fails. */
function upName(count: NUpCount): string {
  if (!N_UP_COUNTS.includes(count)) {
    throw new Error(`a guide names ${count} per sheet, which is not offered`);
  }
  return `${count}-up`;
}

/** Add Page Numbers' Numbering style buttons, by value, as the runner labels them. */
function numberStyleLabel(value: NumberStyle): string {
  const found = NUMBER_STYLES.find((style) => style.value === value);
  if (!found)
    throw new Error(`a guide names unknown numbering style "${value}"`);
  return found.label;
}
const BATES_STYLE = numberStyleLabel("bates");
const PAGES_STYLE = numberStyleLabel("pages");
const BATES_PREFIX = "ACME-";
/** The label page `n` carries in the Bates style at the default digit count. */
const batesAt = (n: number) =>
  previewPageNumber(batesFormat(BATES_PREFIX, DEFAULT_BATES_DIGITS), n, n);

/** Merge PDF's Page order buttons, as its runner labels them. */
const MERGE_ALTERNATE = MERGE_MODE_LABEL.alternate;
const MERGE_APPEND = MERGE_MODE_LABEL.append;

/** The images JPG / PNG to PDF decode and re-encode, and the ones refused. */
const DECODED_NAMES = listAnd(DECODED_IMAGE_LABELS);
const DECODED_NAMES_OR = listOr(DECODED_IMAGE_LABELS);
const REFUSED_NAMES = listAnd(REFUSED_IMAGE_LABELS);
const TRANSCODE_QUALITY_PCT = Math.round(TRANSCODE_JPEG_QUALITY * 100);

export const guides: Guide[] = [
  {
    slug: "how-to-merge-pdf-files",
    title: "How to merge PDF files",
    description:
      "Combine two or more PDFs into one file, right in your browser. Drag to set the order, then merge — your files stay on your device. No account needed.",
    tools: ["merge-pdf", "split-pdf", "organize-pages"],
    keywords: [
      "how to merge pdf files",
      "merge pdf",
      "combine pdf files into one",
      "join pdfs",
      "merge pdf in browser",
    ],
    intro: [
      "To merge PDF files, open the Merge PDF tool, add two or more PDFs, and drag them into the order you want. The tool combines them into a single PDF that you save straight to your device.",
      "What makes this approach different is where the work happens. Merge PDF runs entirely in your browser, so your files stay on your device from start to finish — there is no server step in the middle. There is also no account: open the page, add your files, and merge.",
      "The combined PDF follows your list from top to bottom, so a stack of scans, chapters, or exhibits comes out exactly as you arranged it. If you later need the reverse operation, Split PDF breaks one document into separate files by page range, fixed intervals, or one file per page, and Organize Pages rearranges pages inside a single document.",
    ],
    steps: [
      "Open the Merge PDF tool.",
      "Add two or more PDF files — they stay on your device the entire time.",
      "Drag files into the order you want; the combined PDF follows your list from top to bottom.",
      "Use each row's move buttons to shift a file up or down instead of dragging.",
      "Double-check the order — the file at the top of the list becomes the opening pages of the result.",
      "Merge, then save the combined PDF to your device.",
    ],
    sections: [
      {
        id: "get-the-order-right",
        heading: "Get the order right before you merge",
        body: [
          "The merged document is built from your list, top to bottom: the first file in the list becomes the first pages of the output, and every file after it is appended in sequence. Drag files into position to set that order, or use the move buttons on each row if you prefer clicking to dragging.",
          "It is worth a final glance at the list before you merge. Reordering happens before the merge runs, so arranging the list correctly the first time saves you a second pass. If you want finer control after the fact, Organize Pages lets you reorder, rotate, duplicate, and delete pages on a visual page board.",
        ],
      },
      {
        id: "add-a-contents-page",
        heading: "Start the merged PDF with a contents page",
        body: [
          "Tick “Add a contents page” before you merge and the combined PDF opens with a page headed Contents: one line per file, its name and the page it starts on, and clicking a line jumps to that page. The numbers count the contents page itself, so they match the page numbers your PDF reader shows.",
          "The contents follow your list from top to bottom and the pages you picked for each file, so a file you took only three pages of starts where those three pages are. A long list continues onto a second contents page. Bookmarks, including the ones “Add a bookmark for each file” writes, still open the right pages.",
        ],
      },
      {
        id: "where-the-merge-runs",
        heading: "Where the merge actually runs",
        body: [
          "Merge PDF is an in-browser tool. The processing runs on your own device, and your files stay there from start to finish — they are never sent to a server as part of the merge. That also means there is no account: the browser you already have does the work.",
          `One honest nuance: the tool is not fully offline. ${offlineAnswer("merge-pdf")}`,
        ],
      },
      {
        id: "formats-and-limits",
        heading: "Inputs, output, and limits",
        body: [
          `Merge PDF accepts PDF files and produces a single PDF. Each file you add can be up to ${ceilingMb("merge-pdf")} MB, and you need at least two files for a merge to make sense — the tool is built around combining several documents into one.`,
          "If the combined document ends up heavier than you would like, Compress PDF can follow up: its lossless structural repack always runs in your browser, with deep image compression available as an optional, clearly labeled secure-server step.",
        ],
      },
    ],
    faq: [
      {
        question: "Do my files get sent to a server when I merge PDFs?",
        answer:
          "No. Merge PDF runs entirely in your browser, and your files stay on your device from start to finish.",
      },
      {
        question: "How large can each PDF file be?",
        answer: `Each PDF you add can be up to ${ceilingMb("merge-pdf")} MB.`,
      },
      {
        question: "Can I merge PDF files without an account?",
        answer:
          "Yes. No account is required — open the tool, add two or more PDFs, set the order, and merge.",
      },
      {
        question: "Does merging PDFs work offline?",
        answer: `Not fully. ${offlineAnswer("merge-pdf")}`,
      },
      {
        question: "How do I control the page order in the combined PDF?",
        answer:
          "The output follows your file list from top to bottom. Drag files into position before merging, or use each row's move buttons. To rearrange pages inside the result afterward, Organize Pages handles reordering, rotating, duplicating, and deleting pages on a visual page board.",
      },
    ],
    published: "2026-09-17",
    updated: "2026-10-30",
  },
  {
    slug: "how-to-split-a-pdf",
    title: "How to split a PDF into separate files",
    description:
      "Split a PDF by page range, fixed intervals, one file per page, file size, bookmarks or a word on the page — right in your browser. No account needed.",
    tools: ["split-pdf", "extract-pages", "merge-pdf"],
    keywords: [
      "how to split a pdf",
      "split pdf into separate files",
      "extract a page range from a pdf",
      "split pdf every n pages",
      "separate pdf pages",
    ],
    intro: [
      "To split a PDF into separate files, open the Split PDF tool, pick your document, and choose how to divide it: custom page ranges, every N pages, one file per page, a maximum file size, its bookmarks, or every page that contains a word you type. The split runs immediately; a single piece saves as a PDF, and several pieces download together as one ZIP.",
      "What sets this approach apart is where the work happens. Split PDF runs entirely in your browser, so the file stays on your device from start to finish — nothing is sent anywhere to be processed. There is no account to create and nothing to install; you pick a file, split it, and save the results.",
      "This guide walks through each split mode, what the output looks like, and the limits worth knowing before you start — including when a neighboring tool like Extract Pages is the better fit for the job.",
    ],
    steps: [
      "Open the Split PDF tool.",
      "Pick the PDF you want to split — it stays on your device the whole time.",
      "Choose a split mode: custom page ranges, every N pages, one file per page, by file size, by bookmarks or by text.",
      "Define the split: for ranges, list the page spans that should become separate files; for the every-N-pages rule, set how many pages each piece should hold. One file per page splits at every page boundary — each page of the document becomes its own PDF. For by text, type the word or phrase that marks where each new file should start.",
      "Run the split — the processing happens in your browser, not on a server.",
      "Download the result. When there is more than one piece they arrive together as a ZIP, and a single piece saves as a plain PDF. Every piece is a complete, standard PDF.",
    ],
    sections: [
      {
        id: "choose-a-split-mode",
        heading: "Choose the right split mode",
        body: [
          "Split PDF offers six ways to divide a document, and picking the right one saves rework. Custom page ranges fit documents with a known structure: give each chapter, exhibit, or section its own range and each becomes its own file. The every-N-pages rule fits uniform documents — batch scans, multi-page statements, anything that repeats at a fixed length — because you set the interval once and the tool cuts at every boundary. One file per page is the blunt instrument: every single page becomes its own PDF, useful when each page must stand alone. By file size packs pages into each file until the next one would take it over the limit you set, and by bookmarks starts a file at each top-level bookmark.",
          "By text is for documents that announce their own boundaries: a batch of invoices where each begins with “Invoice number”, or statements that each open with “Account summary”. Every page whose text contains the phrase starts a new file, and pages before the first one form a file of their own. Line breaks inside the phrase do not matter, and capitals only count when Match case is ticked. It reads the PDF's own text, so a scanned page without a text layer cannot start a file; the tool names any such pages, and OCR PDF can add the missing text first.",
          "If what you actually want is a handful of specific pages combined into one new document — rather than the whole file divided into pieces — the Extract Pages tool is the closer fit. It lets you pick pages by clicking thumbnails or typing a range like 1-3, 5, then exports them as a brand-new PDF, also right in your browser.",
        ],
      },
      {
        id: "what-you-get",
        heading: "What the output looks like",
        body: [
          "Every piece the split produces is a complete, standard PDF that opens in any reader — no special format, no wrapper. When the split produces more than one piece, the results download together as a single ZIP, so they arrive as one download instead of a scatter of separate saves; unzip it and each range, interval, or page is there as its own file. A split that produces only one piece saves it as a plain PDF, with no archive around it. If you later need some pieces back together as one document, the Merge PDF tool combines PDFs into one, in any order — also in your browser.",
        ],
      },
      {
        id: "where-the-split-runs",
        heading: "Where the split happens",
        body: [
          "Split PDF is an in-browser tool. The processing runs entirely on your device, and the file never leaves it — there is no server step in the path from picking a file to saving the result. That also means no account: nothing about the flow requires identifying yourself.",
          `One honest nuance: the tool is not fully offline. ${offlineAnswer("split-pdf")}`,
        ],
      },
      {
        id: "limits-to-know",
        heading: "Limits to know",
        body: [
          `The tool accepts PDF input up to ${ceilingMb("split-pdf")} MB per file. Because the work happens on your device, that ceiling is the main constraint to plan around — there is no queue and no transfer to wait on. The cap applies to the input PDF you pick: a file over it is refused before any work starts, so an over-cap document cannot be split here. If you control the source, export a smaller PDF from the original application and split that.`,
        ],
      },
    ],
    faq: [
      {
        question: "Does Split PDF send my file to a server?",
        answer:
          "No. The tool runs entirely in your browser — the file stays on your device from start to finish, and the split output is produced and saved locally.",
      },
      {
        question: "How large can the PDF be?",
        answer: `Up to ${ceilingMb("split-pdf")} MB per file. The cap applies to the input PDF you pick.`,
      },
      {
        question: "Can I split a PDF so every page becomes its own file?",
        answer:
          "Yes. Choose the one-file-per-page mode and each page of the document becomes its own PDF. When the document has more than one page, the results download together as a ZIP so you get everything in one save.",
      },
      {
        question: "Does Split PDF work offline?",
        answer: `Not fully. ${offlineAnswer("split-pdf")}`,
      },
      {
        question: "What if I only need a few specific pages?",
        answer:
          "Use Extract Pages instead: pick pages by clicking thumbnails or typing a range like 1-3, 5, and export them as one brand-new PDF. It runs in your browser too, so that file also stays on your device. Split PDF is for dividing the whole document into multiple output files.",
      },
    ],
    published: "2026-09-17",
    updated: "2026-10-25",
  },
  {
    slug: "how-to-compress-a-pdf",
    title: "How to compress a PDF",
    description:
      "Compress a PDF with a lossless repack that runs in your browser, or send image-heavy files through deep image compression on a secure, auto-deleting server.",
    tools: ["compress-pdf", "optimize-web"],
    keywords: [
      "compress pdf",
      "reduce pdf file size",
      "shrink pdf online",
      "make a pdf smaller",
      "compress pdf without losing quality",
      "pdf size reducer",
    ],
    intro: [
      "To compress a PDF, open the Compress PDF tool, add your file, and download the lossless-optimized copy it produces right in your browser. Alongside that copy, the tool shows you a size breakdown so you can see exactly what is inflating the file — before you decide whether the optional deep image compression step is worth it.",
      "What sets this approach apart is that it keeps two very different kinds of compression explicitly separate. The analysis and the lossless repack run entirely in your browser, so on that path your PDF stays on your device from start to finish. Deep image compression — the step that downsamples images in image-heavy files — is optional and clearly labeled, and it runs on a secure, auto-deleting server. The page checks that a server is available before anything leaves your device.",
      "There is no account to create: add a PDF, read the breakdown, and save the result.",
    ],
    steps: [
      "Open the Compress PDF tool.",
      "Add your PDF. The analysis runs privately, right in your browser — the file stays on your device while it is inspected.",
      "Review the size breakdown to see exactly what is inflating your PDF.",
      "Download the lossless-optimized copy. The repack runs entirely in your browser, and because it is lossless, the document's content is left as it was.",
      "For image-heavy files, choose the deep image compression step. It is optional and clearly labeled: your PDF is uploaded to a secure, auto-deleting server that downsamples the images.",
      "Before anything leaves your device, the page checks that a server is available — the deep step starts only after that check passes.",
      `Download the compressed result. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
    ],
    sections: [
      {
        id: "lossless-repack-vs-deep-compression",
        heading: "Lossless repack vs. deep image compression",
        body: [
          "The lossless structural repack always runs in your browser. It rewrites the file's internal structure without touching the content, so it is the safe default: run it on any PDF, and if the result is small enough, you are done. The breakdown comes first, so you can see what is inflating the PDF before deciding whether the lossless pass alone will get you where you need to be.",
          "Deep image compression is the second path, and it exists for image-heavy files. It needs a native engine, so it runs as an optional, clearly labeled secure-server step rather than in the browser: your PDF is uploaded to our server, images are downsampled, and you download a smaller PDF. Nothing routes you there silently — you choose the step yourself, and the page confirms a server is available before anything leaves your device.",
        ],
      },
      {
        id: "where-your-file-is-processed",
        heading: "Where your file is processed",
        body: [
          `Compress PDF is a hybrid tool, and the two paths have different privacy stories — both stated plainly. The size analysis and the lossless repack happen on your device: for that path, your PDF never leaves your browser. The optional deep image compression step is different: there, your file is uploaded to a secure server, and inputs are wiped when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
          "Because the availability check runs first, nothing is sent to a server that is not there to receive it.",
        ],
      },
      {
        id: "when-compression-is-not-the-job",
        heading: "When compression is not the job",
        body: [
          `${nameOf("optimize-web")} is often mistaken for compression, and it is not: it linearizes the file so a viewer that loads a PDF in pieces can show the first page while the rest downloads. It is not meant to reduce size: the whole file is rewritten, so its size can change in either direction. Use it when the goal is a faster first page on the web, and ${nameOf("compress-pdf")} when the goal is a lighter file.`,
          `${nameOf("grayscale-pdf")} converts a PDF to black and white for printing, right in your browser. Every page becomes a grayscale image, so text is no longer selectable or searchable — a trade worth knowing before you reach for it to save space.`,
        ],
      },
      {
        id: "output-and-limits",
        heading: "What you get, and the limits",
        body: [
          `Both paths produce a PDF. The lossless copy is a repack of the same content; the deep path returns a PDF whose images have been downsampled to save space. The size breakdown you reviewed at the start is your guide: it shows exactly what is inflating the file, so you can judge whether the in-browser pass is enough or the file is image-heavy enough to justify the deep step. The per-file cap is ${ceilingMb("compress-pdf")} MB.`,
        ],
      },
    ],
    faq: [
      {
        question: "Does compressing a PDF reduce its quality?",
        answer:
          "Not on the default path. The lossless repack restructures the file without altering its content — that is what lossless means here. Deep image compression does change images: it downsamples them to save more space, which is why it is a separate, clearly labeled optional step rather than part of the default pass.",
      },
      {
        question: "Is my PDF uploaded when I compress it?",
        // The worker sentence is the tool page's own (HYBRID_WORKER_STEP): the
        // page and this guide answer the same question, so they share the words.
        answer: `Not for the analysis or the lossless repack — both run in your browser, and on that path the file stays on your device. The exception is deep image compression. ${HYBRID_WORKER_STEP}`,
      },
      {
        question: "How large can my PDF be?",
        answer: `Up to ${ceilingMb("compress-pdf")} MB per file.`,
      },
      {
        question: "What happens to my file after deep image compression runs?",
        answer: `The job runs on a secure server, and inputs are wiped when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
      },
      {
        question: "Will a smaller PDF also open faster on a website?",
        answer:
          "Size is only part of it. If the PDF will be read in a browser, run Optimize for Web on the compressed copy: it linearizes the file with qpdf on a secure server, so the first page can render while the rest still downloads, and the input is deleted after the job. Linearizing reorders the file for streaming; it is not a compression step.",
      },
      {
        question: "Do I need an account to compress a PDF?",
        answer:
          "No account is needed. Open the tool, add your PDF, review the breakdown, and save the result.",
      },
    ],
    published: "2026-09-17",
    updated: "2026-10-30",
  },
  {
    slug: "how-to-convert-pdf-to-word",
    title: "How to convert a PDF to an editable Word document",
    description:
      "Convert a PDF into an editable Word (DOCX) file on a secure server that deletes the input when the job finishes. No account needed.",
    tools: ["pdf-to-word", "ocr-pdf", "word-to-pdf"],
    keywords: [
      "convert pdf to word",
      "pdf to word converter",
      "pdf to docx",
      "pdf to editable word document",
      "how to convert pdf to word",
      "turn a pdf into word",
    ],
    intro: [
      "To convert a PDF into an editable Word document, open the PDF to Word tool, upload your PDF, and download the result as a DOCX file. The conversion carries the PDF's selectable text into Word as plain paragraphs in reading order, so you edit the words instead of retyping them — the formatting is not rebuilt.",
      `PDF to Word is a server tool: your PDF travels over an encrypted connection to a secure server, and our server deletes the input when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
      `There is no account to create. Pick a PDF up to ${ceilingMb("pdf-to-word")} MB, let our server convert it, and save the DOCX before the link expires.`,
    ],
    steps: [
      "Open the PDF to Word tool.",
      `Upload the PDF you want to convert — it travels over an encrypted connection, and files up to ${ceilingMb("pdf-to-word")} MB are accepted.`,
      "Start the conversion.",
      "Wait while our secure server converts the PDF into a Word document. Our server deletes the input when the job finishes.",
      `Download the DOCX. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, so save it right away.`,
      "Open the downloaded DOCX in Word and format the text the way you need it — the words arrive as plain paragraphs, in reading order.",
    ],
    sections: [
      {
        id: "what-you-get",
        heading: "What to expect from the converted document",
        body: [
          `The output is a DOCX file, the standard editable Word format. ${PDF_TO_WORD_KEEPS}`,
          "Headings, lists and tables arrive as plain lines of text with no styles, so expect to restyle the document: the conversion saves you the retyping, not the formatting.",
          "That makes PDF to Word the right tool when you need the words back to rework them — rewrite a paragraph, fix a date, reuse a section — and the wrong one when the look of the page is what matters. For that, keep the PDF itself.",
        ],
      },
      {
        id: "where-it-runs",
        heading: "Where the conversion runs",
        body: [
          `PDF to Word runs on a secure server, not in your browser. Your file is uploaded over an encrypted connection, our server processes it, and the input is deleted when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
          "You do not need an account to run the conversion — open the page, pick the file, and download the result.",
        ],
      },
      {
        id: "limits",
        heading: "Size limit and link expiry",
        body: [
          `Two limits matter here. Each PDF can be up to ${ceilingMb("pdf-to-word")} MB per file.`,
          `The other limit is time. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule, so treat the download as part of the job: save the DOCX as soon as the conversion finishes rather than leaving the tab open for later.`,
        ],
      },
      {
        id: "scanned-pdfs",
        heading: "Scanned PDFs and neighboring tools",
        body: [
          "The tools listed beside PDF to Word cover the jobs next door. If your PDF is a scan — photographed or scanned pages rather than typed text — run it through the OCR PDF tool first, which recognizes the text in scanned pages so there is real text to carry into Word.",
          "If you want the same text as a plain .txt file rather than a DOCX, PDF to Text pulls it out right in your browser. And when the editing is done, Word to PDF converts your finished document back in the other direction.",
        ],
      },
    ],
    faq: [
      {
        question: "Does PDF to Word upload my file?",
        answer:
          "Yes. PDF to Word is a server tool: your PDF is uploaded over an encrypted connection and processed on a secure server. Our server deletes the input when the job finishes.",
      },
      {
        question: "What happens to my PDF after the conversion runs?",
        answer: `The file is processed on a secure server, and the input is deleted when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
      },
      {
        question: "How large can my PDF be?",
        answer: `Up to ${ceilingMb("pdf-to-word")} MB per file.`,
      },
      {
        question: "Do I need an account to convert a PDF to Word?",
        answer:
          "No account is needed. Open the PDF to Word tool, upload the PDF, and download the DOCX — that is the whole flow.",
      },
      {
        question: "Will the Word document look like my original PDF?",
        answer: `No. It holds the PDF's words and pictures, not its design. ${PDF_TO_WORD_KEEPS} If your PDF is a scanned image rather than typed text, use the OCR PDF tool first so there is recognized text to convert.`,
      },
    ],
    published: "2026-09-17",
    updated: "2026-10-30",
  },
  {
    slug: "how-to-convert-jpg-to-pdf",
    title: "How to convert JPG to PDF",
    description:
      "Combine JPG photos into one PDF right in your browser — your files never leave your device. One photo per US Letter page, in the order you set.",
    tools: ["jpg-to-pdf", "png-to-pdf", "pdf-to-jpg"],
    keywords: [
      "jpg to pdf",
      "convert jpg to pdf",
      "jpeg to pdf",
      "combine photos into one pdf",
      "image to pdf converter",
      "turn pictures into pdf",
    ],
    intro: [
      "To turn JPG photos into a single PDF, open the JPG to PDF tool on pdf.xyz, pick your images, put them in order, and create the PDF right in your browser. Each photo becomes one page of the finished file.",
      "What sets this converter apart is where the work happens: entirely in your own browser. Nothing is sent to a server, so your photos stay on your device from the moment you pick them to the moment you save the finished PDF — and no account is needed.",
      `Each image can be up to ${MAX_IMAGE_MB} MB, and the output is one PDF assembled on your device. That makes the tool a natural fit for photographed receipts, scanned pages saved as JPGs, or any batch of pictures that belongs together in a single file.`,
    ],
    steps: [
      "Open the JPG to PDF tool.",
      // Was "Pick the JPG or JPEG photos" — one format of the five the tool
      // takes since #236; guide-format-claims.test.ts holds this list to
      // the tool's `accept`.
      `Pick the JPG, PNG, ${DECODED_NAMES_OR} images you want in the PDF — they stay on your device the whole time.`,
      // The arrows are icons: "Move up" / "Move down" are their tooltips,
      // never drawn (guide-ui-labels.test.ts reads `title` as not visible).
      "Put them in page order with the up and down arrows on each photo.",
      "Create the PDF — it is assembled in your browser, not on a server.",
      "Save the finished PDF to your device.",
    ],
    sections: [
      {
        id: "what-each-page-looks-like",
        heading: "What each page looks like",
        body: [
          // HISTORY: this section was "Page size, orientation, and margins"
          // over a tool with none of the three, then (from 67e8d0f) "the page
          // is fixed". The settings arrived 2026-10-24; both sentences are
          // now the tool-facts ones, built from the runner's chip tables and
          // held to the engine by claims-vs-capability.test.ts.
          IMAGE_PAGE_FACT,
          `${IMAGE_PAGE_OPTIONS_FACT} The same setup applies to every photo, which keeps a stack of mismatched pictures reading as one document. A phone photo stored sideways with a rotation tag is turned upright, the way your browser shows it.`,
        ],
      },
      {
        id: "where-it-runs",
        heading: "Your photos never leave your device",
        body: [
          "JPG to PDF is an in-browser tool. The conversion runs on your own machine, and your files stay on your device from start to finish — there is no server step in the path, and no account is needed.",
          `One honest caveat: the tool is not fully offline. ${offlineAnswer("jpg-to-pdf")}`,
        ],
      },
      {
        id: "limits-and-related-tools",
        heading: "Limits, formats, and where to go next",
        body: [
          `The tool accepts JPG and JPEG files, and PNG, ${DECODED_NAMES} images as well, and produces a PDF. Each image can be up to ${MAX_IMAGE_MB} MB, and unless you choose One PDF per image, everything you add is assembled into one PDF on your device.`,
          // Was "If your images are PNGs — transparent ones included — use
          // the PNG to PDF tool": a redirect for a format this tool takes
          // itself since #236 (guide-format-claims.test.ts, rule redirect).
          `${nameOf("png-to-pdf")} takes the same files and builds the same PDF, so either page works. Going the other direction, PDF to JPG turns PDF pages back into images. And once you have several PDFs, Merge PDF combines them into one.`,
        ],
      },
    ],
    faq: [
      {
        question: "Does my photo leave my device when I convert JPG to PDF?",
        answer:
          "No. The tool runs entirely in your browser, so your files stay on your device from start to finish.",
      },
      {
        question: "Can I combine multiple JPG photos into one PDF?",
        answer:
          "Yes — that is exactly what the tool does. Each photo becomes one page of a single PDF, in the order you set with the up and down arrows on each photo.",
      },
      {
        question: "Does JPG to PDF have page size or margin settings?",
        // Was "No." — true until 2026-10-24.
        answer: `Yes. ${IMAGE_PAGE_OPTIONS_FACT} If you change nothing, every image goes on a ${US_LETTER_LABEL} portrait page with a ${inches(IMAGE_PAGE_MARGIN_PT)} in margin, scaled down to fit if it is larger than that space.`,
      },
      {
        question: "How large can my JPG files be?",
        answer: `Up to ${MAX_IMAGE_MB} MB per file. The images are combined into one PDF right on your device.`,
      },
      {
        question: "Does JPG to PDF work offline?",
        answer: `Not fully. ${offlineAnswer("jpg-to-pdf")}`,
      },
      {
        question: "Can I convert PNG images with this tool?",
        // Was "This tool accepts JPG and JPEG files." — false since PNG and
        // JPG were taken on both image tools, and again since 2026-10-30
        // added WebP, GIF and BMP (image-to-pdf.ts).
        answer: `Yes. ${nameOf("jpg-to-pdf")} takes PNG images too, transparent ones included, alongside your JPGs in the same PDF, and ${DECODED_NAMES} images as well. ${nameOf("png-to-pdf")} accepts the same files and works the same way.`,
      },
    ],
    published: "2026-09-17",
    updated: "2026-10-31",
  },
  {
    // ONE guide for the intent, from two lanes: L07 wrote this slug for the
    // top query ("pdf to jpg"), L04 wrote how-to-convert-pdf-to-jpg-or-png for
    // the same two tools. Folded here: L04's interpolated presets, pixel cap,
    // preview limit and file names; L07's per-preset advice, JPEG quality and
    // the embedded-images section. L07's offline paragraph said "a dropped
    // connection does not interrupt work already in progress" — false for a
    // renderer that fetches image decoders and character maps mid-run — so
    // the offline answer is the tool page's own.
    slug: "how-to-convert-pdf-to-jpg",
    title: "How to convert a PDF to JPG or PNG images",
    description:
      "Turn every page of a PDF into a JPG or PNG image right in your browser — your file never leaves your device. Pick a resolution; several pages arrive as one ZIP.",
    tools: ["pdf-to-jpg", "pdf-to-png", "extract-images"],
    keywords: [
      "pdf to jpg",
      "convert pdf to jpg",
      "pdf to jpeg",
      "pdf to png",
      "pdf to image",
      "save pdf pages as images",
    ],
    intro: [
      "To convert a PDF to JPG, open the PDF to JPG tool — or PDF to PNG for lossless images — add your PDF, choose a resolution, and render. Every page becomes its own image, drawn right in your browser. A one-page PDF downloads as a single image; a document with more than one page arrives as one ZIP with an image for each page.",
      "The rendering happens on your own device. The tool draws each page with pdf.js, a PDF renderer bundled with the site, and encodes it in the browser, so your PDF stays on your device from start to finish. There is no account to create.",
      `That makes it a quick way to share a page in a chat or on a slide, to drop a page into a document that only takes images, or to show a PDF on a device with no viewer. Each PDF can be up to ${ceilingMb("pdf-to-jpg")} MB.`,
    ],
    steps: [
      "Open the PDF to JPG tool, or PDF to PNG for lossless images.",
      "Add your PDF. It is read in your browser, and the file stays on your device.",
      `Choose a resolution: ${RASTER_RESOLUTION_CHOICES}. ${DEFAULT_RESOLUTION_LABEL} is selected to start.`,
      "Render the pages. A progress count shows each page as it is drawn.",
      `Download the result: a single page saves as one image, and several pages save as one ZIP with an image for each page. Each of the first ${RASTER_PREVIEW_LIMIT} pages can also be saved on its own from its preview.`,
    ],
    sections: [
      {
        id: "choosing-a-resolution",
        heading: "Choosing a resolution",
        body: [
          `DPI is how many image pixels each inch of the page becomes. ${presetText(rasterPreset("screen"))} is enough for a page read on a monitor or in a chat. ${presetText(rasterPreset("high"))} is a sharper all-rounder. ${presetText(rasterPreset("print"))} is for printing, or for zooming in on small text. Every step up draws more pixels per page, so the images get larger and take longer to render.`,
          `Neither side of a rendered page may exceed ${RASTER_MAX_DEVICE_PX.toLocaleString("en-US")} pixels, which keeps the memory a page needs in check. A very large page, such as a poster or an engineering drawing, is rendered below the preset rather than failing.`,
        ],
      },
      {
        id: "jpg-or-png",
        heading: "JPG or PNG?",
        body: [
          `JPG files are smaller and suit photographs and scanned pages; each page is encoded at a fixed JPEG quality of ${Math.round(DEFAULT_JPEG_QUALITY * 100)}%. PNG is lossless — every pixel is kept exactly — which suits text, line art and screenshots, at the cost of larger files.`,
          "Both are rendered on a white background, so any transparent area of a page comes out white.",
        ],
      },
      {
        id: "what-you-download",
        heading: "What you download",
        body: [
          `A one-page PDF downloads as a single image named after your file. With more than one page, every page goes into one ZIP, named in reading order with zero-padded page numbers — ${pageImageName("report.pdf", 2, 12, "png")} — so the images sort correctly in any file browser. The first ${RASTER_PREVIEW_LIMIT} pages also get a preview with their own download button.`,
        ],
      },
      {
        id: "pages-or-embedded-images",
        heading: "Page images, or the images inside the PDF?",
        body: [
          "PDF to JPG draws each whole page — text, drawings, and pictures together — as one image, the way a screen shows it. If you want the photos embedded in the PDF at their original resolution instead of pictures of whole pages, use Extract Images: it saves embedded JPEGs as they are, rebuilds RGB and grayscale images as PNGs, and skips formats it cannot read.",
          "If an image inside the PDF cannot be decoded, the page is still rendered, and the result tells you how many images could not be decoded rather than handing back a page with a silent gap.",
        ],
      },
      {
        id: "where-it-runs",
        heading: "Your PDF never leaves your device",
        body: [
          "PDF to JPG is an in-browser tool. The PDF is read, drawn, and encoded on your own machine, and the images are saved straight from the browser — there is no server step in the path, and no account is needed.",
          `One honest caveat about working offline: ${offlineAnswer("pdf-to-jpg")}`,
        ],
      },
    ],
    faq: [
      {
        question: "Is my PDF sent anywhere when I convert it to JPG?",
        answer:
          "No. The pages are drawn and encoded in your browser, so the file stays on your device from start to finish.",
      },
      {
        question: "Why did I get a ZIP file?",
        answer:
          "Because the PDF has more than one page. Each page becomes its own image, named with its page number so the files sort in reading order, and when there is more than one page the images are bundled into one ZIP so they download together. A one-page PDF downloads as a single image.",
      },
      {
        question: "Can I convert just one page?",
        answer: `Every page is rendered, and each of the first ${RASTER_PREVIEW_LIMIT} gets its own download button, so you can save only the page you need. For a page past those, use Extract Pages first to make a one-page PDF — it runs in your browser too — and convert that.`,
      },
      {
        question: "How do I get PNG images instead?",
        answer:
          "Use PDF to PNG. It renders pages the same way, at the same resolutions, but saves lossless PNGs — usually larger files, with no JPEG compression around sharp text.",
      },
      {
        question: "How large can my PDF be?",
        answer: `Up to ${ceilingMb("pdf-to-jpg")} MB per file.`,
      },
    ],
    published: "2026-09-27",
    updated: "2026-09-27",
  },
  {
    slug: "how-to-rotate-a-pdf",
    title: "How to rotate pages in a PDF",
    description:
      "Rotate every page of a PDF, or only the pages you pick — left, right, or upside down — right in your browser, so the file stays on your device.",
    tools: ["rotate-pdf", "organize-pages", "crop-pdf"],
    keywords: [
      "rotate pdf",
      "rotate pdf pages",
      "turn pdf pages",
      "fix a sideways pdf",
      "rotate one page in a pdf",
      "landscape pdf",
    ],
    intro: [
      "To rotate a PDF, open the Rotate PDF tool, add your file, turn the pages that need it, and download the result. You can turn every page at once or only the ones you select, and each page's thumbnail shows its new orientation before anything is applied.",
      "Rotate PDF runs entirely in your browser, so your PDF stays on your device and no account is needed. The rotation is written into each page as a setting rather than redrawn, so text stays selectable and images keep their quality.",
      `It is the quick fix for a scan that came out sideways, a landscape table stuck in a portrait report, or a page someone photographed upside down. Each PDF can be up to ${ceilingMb("rotate-pdf")} MB.`,
    ],
    steps: [
      "Open the Rotate PDF tool.",
      "Add your PDF. It opens in your browser, and the file stays on your device.",
      "Choose the pages to turn. Every page starts selected; click Clear, then click pages to pick them, Shift-click to take a range, or use Invert.",
      "Turn them with Left, Right, or 180°, or use the arrows on one page's thumbnail to turn just that page.",
      "Check the thumbnails. Reset puts every page back the way it was.",
      "Apply the rotation and download the rotated PDF.",
    ],
    sections: [
      {
        id: "every-page-or-some",
        heading: "Turning every page, or only some",
        body: [
          "Every page starts selected, so one click on Left, Right, or 180° turns the whole document — the usual fix for a scan that came out sideways. To turn only some pages, clear the selection and pick the ones you want: click a page to select it, Shift-click another to select everything in between, or Invert to swap what is selected. With nothing selected at all, a turn applies to every page.",
          "For a single odd page, skip the selection and use the arrows on that page's thumbnail. Pages that were already rotated in the original start from their current angle, so a turn adds to what is there, and Apply stays unavailable until at least one page differs from the original.",
        ],
      },
      {
        id: "what-rotating-changes",
        heading: "What rotating changes, and what it leaves alone",
        body: [
          "A PDF stores each page's rotation as a setting, and this tool changes that setting instead of redrawing the page. Text stays selectable and searchable, images keep their original quality, and no page is turned into a picture.",
          "If you also need to reorder, duplicate, or delete pages, use Organize Pages, which does all of that and rotation in one pass on a visual page board, in your browser too. If a page is the right way up but carries too much margin, Crop PDF trims it.",
        ],
      },
      {
        id: "where-it-runs",
        heading: "Your PDF never leaves your device",
        body: [
          "Rotate PDF is an in-browser tool. The file is opened, turned, and saved on your own machine — there is no server step in the path, and no account is needed.",
          `One honest caveat about working offline: ${offlineAnswer("rotate-pdf")}`,
        ],
      },
    ],
    faq: [
      {
        question: "Can I rotate just one page of a PDF?",
        answer:
          "Yes. Use the arrows on that page's thumbnail, or select only that page and use Left, Right, or 180°. The other pages stay as they were.",
      },
      {
        question: "Does rotating a PDF reduce its quality?",
        answer:
          "No. The tool changes each page's rotation setting instead of redrawing the page, so text stays selectable and images keep their quality.",
      },
      {
        question: "Does my PDF leave my device when I rotate it?",
        answer:
          "No. Rotate PDF runs entirely in your browser, so the file stays on your device from start to finish.",
      },
      {
        question: "Can I rotate and reorder pages at the same time?",
        answer:
          "Use Organize Pages for that. It reorders, rotates, duplicates, and deletes pages in one pass, and it runs in your browser too.",
      },
      {
        question: "How large can my PDF be?",
        answer: `Up to ${ceilingMb("rotate-pdf")} MB per file.`,
      },
    ],
    published: "2026-09-27",
    updated: "2026-09-27",
  },
  {
    slug: "how-to-add-text-to-a-pdf",
    title: "How to add text, images, and shapes to a PDF",
    description:
      "Click on a PDF page to add text, images, signatures, shapes and notes in your browser, so the file stays on your device, and see what Edit PDF can and cannot change.",
    tools: ["edit-pdf", "annotate-pdf", "redact-pdf"],
    keywords: [
      "edit pdf",
      "add text to pdf",
      "type on a pdf",
      "insert image in pdf",
      "add a logo to a pdf",
      "draw a box on a pdf",
    ],
    intro: [
      "To add text to a PDF, open the Edit PDF tool, add your file, choose Text, click on the page where the words should go and type. Pictures, signatures, rectangles, ellipses, lines, arrows, whiteout, highlights, freehand drawing and notes go on the same way: pick the tool, click or drag on the page. When everything is in place, press Apply & download.",
      "Edit PDF runs entirely in your browser, so your PDF stays on your device and no account is needed. New content is written into the page as real text, shapes, and images, and the original pages are kept as they are rather than turned into pictures, so their own text stays selectable.",
      `One thing to know before you start: Edit PDF adds new content on top of the page, and its Edit text tool retypes the file's own text one line at a time. It does not reflow whole paragraphs. Each PDF can be up to ${ceilingMb("edit-pdf")} MB.`,
    ],
    steps: [
      "Open the Edit PDF tool.",
      "Add your PDF. Its pages appear in your browser, and the file stays on your device.",
      "Choose a tool: Text, Image, Sign, a shape, Whiteout, Highlight, Draw or Note.",
      "Click on the page where it should go — or drag, for a shape — and type, for text.",
      "Select anything you placed to drag it, resize it from its handles, or change its font, colour or opacity. Undo and Redo step back and forward.",
      "Press Apply & download to save the edited PDF.",
    ],
    sections: [
      {
        id: "placing-content",
        heading: "Placing text, images, and shapes",
        body: [
          "Every page of the PDF is shown as it looks in a viewer, and you place things by clicking on it. A text box opens for typing where you click; long lines wrap inside the box, and dragging its handles makes it wider, narrower or taller (never shorter than its words). Font (Helvetica, Times or Courier), size, colour, bold, italic, alignment and line height are set in the panel beside the page.",
          `Rectangles and ellipses can have an outline, a fill, or both, with an adjustable opacity; lines can end in an arrowhead. Images must be PNG or JPG files of up to ${EDIT_IMAGE_MB} MB each; they keep their proportions when you resize them from a corner. A signature can be drawn, typed, or taken from a picture of one.`,
          "Selected items can be dragged, nudged with the arrow keys, copied, pasted, duplicated and deleted, and they snap to the page's edges and centre lines, and to other items' edges and centres, as you move them. You can place items on as many pages as you like before you apply.",
        ],
      },
      {
        id: "what-it-changes",
        heading: "What Edit PDF changes, and what it leaves alone",
        body: [
          "Edit PDF adds, and with Edit text it retypes the PDF's own text a line at a time: a line you retype is removed from the page and written anew, and everything you did not touch stays exactly where it is. It does not reflow a paragraph. The pages are kept, not redrawn, so the original text stays selectable just as it was.",
          "When you apply your edits, text, pictures, shapes and marks are written into the page itself. In the downloaded file they are part of the page, not a comment or a separate object that someone can move or delete in their PDF viewer. Links and form fields are the exception: they are saved as real links and fillable fields, so a reader can click and fill them.",
          "Highlights, drawings, notes, shapes and lines can be the exception too: choose Save markups as comments beside Apply & download, and each is saved as a standard PDF annotation that other PDF apps list as a comment and let you select, edit or delete. Whiteout and redaction are always written into the page, because a cover saved as a comment could simply be deleted.",
          "The page list beside the pages turns, inserts, deletes and reorders pages; everything placed on a page moves with it. Pages you do not change there keep their order, size and rotation.",
          "Pages are shown the way your viewer shows them, after any rotation setting and with only their visible area, and what you place lands exactly there in the downloaded file, reading upright.",
        ],
      },
      {
        // From L05's guide for the same intent (folded in here): the tool for
        // the job this one cannot do.
        id: "changing-existing-text",
        heading: "Changing the text that is already there",
        body: [
          `To rework the wording itself, convert the file with ${nameOf("pdf-to-word")}: it exports the PDF's selectable text as an editable Word document, as plain paragraphs in reading order, with each picture between them. Fonts, tables and page layout are not recreated, so it suits documents where the words matter more than the look.`,
        ],
      },
      {
        id: "covering-versus-removing",
        heading: "Covering something is not the same as removing it",
        body: [
          "A whiteout box can cover a word, a number, or an old date, and the printed page will look clean. But whatever is underneath is still in the file: it can still be selected and copied, and anyone who removes the box in another editor sees it again.",
          "When information must actually be gone, use Redact PDF instead. It covers the areas you choose and then rebuilds every page as a flattened image, so the text and drawings underneath are removed rather than hidden. The trade-off is that no text in the redacted copy can be selected any more.",
          "For review marks on their own — highlights, outlines, notes, and arrows — Annotate PDF runs in your browser too, and offers the same choice: markups flattened into the page, or saved as comments.",
        ],
      },
      {
        id: "where-it-runs",
        heading: "Your PDF never leaves your device",
        body: [
          "Edit PDF is an in-browser tool. The PDF and any images you insert are read, edited, and saved on your own machine — there is no server step in the path, and no account is needed.",
          "Text in English and the other Western European languages uses a font built into the engine. For any other script — Greek, Cyrillic, Bengali, Chinese, and the rest — the tool downloads a matching font the first time it is needed. If your text has characters none of its fonts can draw, or mixes in one box scripts that no single one of its fonts covers, it tells you before changing anything rather than leaving blanks in the page.",
          `One honest caveat about working offline: ${offlineAnswer("edit-pdf")} The font download carries none of your document; it is the same file for everyone.`,
        ],
      },
    ],
    faq: [
      {
        question: "Can I change the existing text in my PDF?",
        answer: `Yes, a line at a time. In ${nameOf("edit-pdf")}, choose Edit text, click a line and retype it: the old words are removed from the file and yours are written where they stood. A scanned page has no text to edit, and the invisible text ${nameOf("ocr-pdf")} adds is not offered either: to change a scan's words, use ${nameOf("pdf-to-word")} with “Recognise text in scans (OCR)”. To rework whole paragraphs, convert the file with ${nameOf("pdf-to-word")}. A whiteout box only hides something; if the information must really be gone, draw a Redact box, or use ${nameOf("redact-pdf")}.`,
      },
      {
        question: "Can I add an image or a logo to a PDF?",
        answer: `Yes. Choose Image, pick a PNG or JPG of up to ${EDIT_IMAGE_MB} MB, then tap or click the page where it should go. Drag it to move it, resize it from a corner, and set its opacity in the panel beside the page.`,
      },
      {
        question: "Can I add content to more than one page?",
        answer:
          "Yes. Scroll to any page and place items on it; everything you place, on every page, is written in one pass when you press Apply & download.",
      },
      {
        question: "Does my PDF leave my device when I edit it?",
        answer:
          "No. Edit PDF runs entirely in your browser, so the PDF and any images you add stay on your device from start to finish.",
      },
      {
        question: "How large can my PDF be?",
        answer: `Up to ${ceilingMb("edit-pdf")} MB per file.`,
      },
    ],
    published: "2026-09-27",
    updated: "2026-10-30",
  },
  {
    slug: "how-to-create-a-fillable-pdf-form",
    title: "How to create a fillable PDF form",
    description:
      "Turn a PDF into a fillable AcroForm with text fields, checkboxes, dropdowns, radio groups, and lists — built right in your browser, no account needed.",
    tools: ["create-forms", "fill-forms", "sign-pdf"],
    keywords: [
      "create fillable PDF form",
      "make a PDF fillable",
      "PDF form creator",
      "add form fields to PDF",
      "fillable form maker",
      "AcroForm builder",
    ],
    intro: [
      "To create a fillable PDF form, open the Create Fillable Forms tool, place fields on the pages where answers belong, and save the result. You get a reusable fillable AcroForm PDF — real form fields that anyone can complete on a screen instead of printing and writing.",
      "The difference is where the work happens. This is a client-side tool: it builds the form in your browser, so the document stays on your device from the moment you pick it to the moment you save the finished file. There is no account to create — open the page and start placing fields.",
      "The output is built to be reused. Because the fields are genuine AcroForm fields, the same PDF can be sent out and completed again and again, and it pairs naturally with the Fill Forms tool for the people on the receiving end.",
    ],
    steps: [
      "Open the Create Fillable Forms tool and pick the PDF you want to make fillable — it stays on your device.",
      "Choose the field type you need: text, checkbox, dropdown, radio, or list — the five field types the builder supports.",
      "Place the field by position on the page, right where the answer belongs — a text field over a blank answer line, a checkbox beside each item.",
      "Repeat for every answer the form collects, mixing field types as the document calls for: radio groups where exactly one choice applies, dropdowns and lists where the answers are known in advance.",
      "Run the tool in your browser to build the fields into the PDF as a real AcroForm.",
      "Save the finished fillable PDF to your device — it is ready to send out and reuse.",
    ],
    sections: [
      {
        id: "choose-the-right-field-type",
        heading: "Choose the right field type",
        body: [
          "The builder supports five field types: text, checkbox, dropdown, radio, and list. Text fields take free-form answers — names, dates, addresses, comments. Checkboxes suit independent yes-or-no items, where any number of them can be checked at once. A radio group is for a question with exactly one acceptable answer out of several: place the group where the question is answered, and it keeps the choice to a single answer.",
          "Reach for a dropdown or a list when the acceptable answers are known in advance — departments, countries, product names — so the person completing the form picks from your set instead of typing. Matching the field type to the question is most of the work of a good form: it makes the answers cleaner and the form faster to complete.",
        ],
      },
      {
        id: "where-the-work-happens",
        heading: "Where the work happens",
        body: [
          "Create Fillable Forms is a client-side tool. The processing runs in your browser, not on a server — the PDF you pick stays on your device from start to finish. That is also why no account is required: there is nothing to set up before you start placing fields.",
          `One honest note: the tool is not fully offline. ${offlineAnswer("create-forms")}`,
        ],
      },
      {
        id: "output-and-limits",
        heading: "What you get, and the limits",
        body: [
          "The tool accepts a PDF and produces a PDF — specifically a reusable, fillable AcroForm document. The tool is in beta — the five field types above are the supported set. Because the fields are genuine form fields rather than flat marks on the page, one saved copy can be distributed and completed over and over, with each person entering their own answers.",
          `Each PDF can be up to ${ceilingMb("create-forms")} MB. When it is time to complete the form, the Fill Forms tool handles the other half of the job: it fills a PDF's existing AcroForm fields — text, checkboxes, radio buttons, dropdowns, and lists — right in the browser. And when a form needs a signature to finish it, the Sign PDF tool adds one.`,
        ],
      },
    ],
    faq: [
      {
        question: "Is my PDF sent to a server when I create a fillable form?",
        answer:
          "No. Create Fillable Forms runs entirely in your browser — the file stays on your device from start to finish. There is also no account to create.",
      },
      {
        question: "What kinds of form fields can I add to a PDF?",
        answer:
          "Five field types: text, checkbox, dropdown, radio, and list. Fields are placed by position, so each one sits exactly where its answer belongs on the page.",
      },
      {
        question: "How large can my PDF be?",
        answer: `Up to ${ceilingMb("create-forms")} MB per file.`,
      },
      {
        question: "Can I create a fillable PDF offline?",
        answer: `Not fully. ${offlineAnswer("create-forms")}`,
      },
      {
        question: "How do people fill out the form I made?",
        answer:
          "The result is a standard fillable AcroForm PDF. Anyone can complete it with the Fill Forms tool, which fills a PDF's existing fields — text, checkboxes, radio buttons, dropdowns, and lists — right in the browser and saves the completed copy as a PDF.",
      },
    ],
    published: "2026-09-17",
    updated: "2026-09-27",
  },
  {
    slug: "how-to-fill-out-a-pdf-form",
    title: "How to fill out a PDF form",
    description:
      "Fill out a PDF form's text fields, checkboxes, and dropdowns right in your browser — the file stays on your device, and no account is needed.",
    tools: ["fill-forms", "create-forms", "sign-pdf"],
    keywords: [
      "fill out a pdf form",
      "pdf form filler",
      "how to fill in a pdf form",
      "type into a pdf form",
      "complete a pdf form online",
      "fill a pdf form in your browser",
    ],
    intro: [
      "To fill out a PDF form, open the Fill Forms tool in your web browser, pick the PDF, and work straight through its fields — text boxes, checkboxes, radio buttons, dropdowns, and lists. When you run the tool, your answers are written into the PDF and the completed file saves back to your device.",
      "What sets this approach apart is where the work happens: on your own device. Fill Forms is an in-browser tool — it runs entirely in your browser, so the form you picked and everything you type into it stays on your device from start to finish. That matters for forms in particular, because forms are where names, addresses, and other personal details go. There is nothing to install and no account to create — the tool runs in your web browser.",
      "Fill Forms completes the interactive fields the PDF already contains — its AcroForm fields. The steps below walk through filling a form from start to finish, then cover which field kinds the tool fills, what to do when a PDF has no fields at all, and how signing and locking the finished form fit in.",
    ],
    steps: [
      "Open the Fill Forms tool.",
      "Pick the PDF form from your device. It stays there — the tool runs in your browser, and the file never leaves your device.",
      "Type your answers into the form's text fields.",
      "Set the choice fields: check the checkboxes that apply, pick one option in each radio group, and choose values from any dropdowns and lists.",
      "Run the tool in your browser to write your answers into the PDF.",
      "Save the completed PDF to your device.",
    ],
    sections: [
      {
        id: "which-fields-it-fills",
        heading: "Which fields Fill Forms can fill",
        body: [
          "Fill Forms completes a PDF's existing AcroForm fields — the interactive fields the document's author built in. Five kinds are covered: text fields for typed answers, checkboxes, radio buttons for pick-one groups, dropdowns, and list fields. If the form has all of these, you can complete the whole thing in one pass and save a single finished PDF.",
          "If the PDF opens with no interactive fields at all, there is nothing for Fill Forms to complete. In that case, start with Create Fillable Forms (currently in beta): it adds text fields, checkboxes, dropdowns, radio groups, and lists by position, turning the flat PDF into a reusable fillable AcroForm — then bring the result back here and fill it.",
        ],
      },
      {
        id: "where-the-work-happens",
        heading: "Where the work happens",
        body: [
          "Fill Forms is an in-browser tool. It runs entirely on your device, and your PDF stays on your device from start to finish. The finished form does not pass through a server on its way back to you — you save the completed file straight to your device.",
          `The tool is not fully offline. ${offlineAnswer("fill-forms")} No account is needed at any point.`,
        ],
      },
      {
        id: "sign-and-lock-after-filling",
        heading: "Signing and locking the finished form",
        body: [
          "Many forms want a signature once the blanks are done. The Sign PDF tool creates one by drawing, typing, or picking a signature image, and lets you place it precisely on the page — so the natural order is fill first, then add the signature to the completed file.",
          "When the answers are final, Flatten PDF locks the fillable fields into the page itself so their values can no longer be edited, while other annotations and layers are kept as-is. That is the right last step before sending a form whose field values you do not want edited. Sign PDF and Flatten PDF both take a PDF and return a PDF, and both run in the browser the same way Fill Forms does.",
        ],
      },
      {
        id: "limits-and-output",
        heading: "Limits and what you get back",
        body: [
          `Fill Forms takes a PDF and outputs a PDF, up to ${ceilingMb("fill-forms")} MB per file. The output is your original document with the field values you entered written into it.`,
          "The tool fills the fields the document already has; it does not add new ones — that is Create Fillable Forms' job — and it does not edit the page content around the fields. Keeping those jobs separate is what lets each one run entirely on your device.",
        ],
      },
    ],
    faq: [
      {
        question: "Does my PDF leave my device when I fill out a form?",
        answer:
          "No. Fill Forms runs entirely in your browser, and the file stays on your device from start to finish.",
      },
      {
        question: "Can I fill out a PDF form offline?",
        answer: `Not fully. ${offlineAnswer("fill-forms")}`,
      },
      {
        question: "How large can the PDF form be?",
        answer: `Up to ${ceilingMb("fill-forms")} MB per file.`,
      },
      {
        question: "What if my PDF has no fillable fields?",
        answer:
          "Fill Forms completes existing AcroForm fields only, so a PDF without any has nothing to fill. Open Create Fillable Forms (currently in beta) first — it adds text fields, checkboxes, dropdowns, radio groups, and lists by position to build a fillable AcroForm PDF — then fill the result with this tool.",
      },
      {
        question: "Do I need an account to fill out a PDF form?",
        answer:
          "No account is needed. Open the tool, pick your PDF, fill the fields, and save the completed file back to your device.",
      },
    ],
    published: "2026-09-17",
    updated: "2026-09-27",
  },
  {
    slug: "how-to-sign-a-pdf",
    title: "How to sign a PDF",
    description:
      "Sign a PDF by drawing, typing, or picking a signature image — right in your browser, so the file never leaves your device. No account needed.",
    tools: ["sign-pdf", "request-signatures", "fill-forms"],
    keywords: [
      "how to sign a pdf",
      "add signature to pdf",
      "electronic signature pdf",
      "draw signature on pdf",
      "esign pdf",
      "sign pdf without account",
    ],
    intro: [
      "To add a signature to a PDF, open the Sign PDF tool, create your signature by drawing it, typing it, or picking a signature image, and place it exactly where the document needs it. Export the result and you have a signed PDF ready to send.",
      "What sets this approach apart is where the work happens. Sign PDF runs entirely in your browser, so the PDF and the signature you create stay on your device from start to finish. No account is needed — open the page, make your mark, and export.",
      `You also get more range than a single scribble box. There are ${signatureWays} ways to make a signature — draw it, type it in a ${signatureStyles.join(" or ")} style, or pick an image of the signature you already use — so the result can be as personal or as formal as the document calls for.`,
    ],
    steps: [
      "Open the Sign PDF tool.",
      "Pick the PDF you need to sign — the file stays on your device the entire time.",
      "Create your signature: draw it, type it, or pick a signature image you already have.",
      `If you type it, pick the look: ${signatureStyles.join(" or ")} style.`,
      "Place the signature exactly where the document needs it — the tool is built for precise placement.",
      "Export your signed PDF and save it to your device.",
    ],
    sections: [
      {
        id: "ways-to-make-a-signature",
        heading: `${signatureWays[0]!.toUpperCase()}${signatureWays.slice(1)} ways to make a signature`,
        body: [
          `Sign PDF offers ${signatureWays} ways to make a signature: draw it, type it, or pick an image. Drawing produces a mark that looks like your handwriting and suits documents where a personal touch matters. Typing is the fastest option, and it comes in ${countWord(SIGNATURE_STYLES.length)} styles — script, which sets a name written in the Western European alphabet in an italic serif face, and print, a plain printed name. A name in any other script is set in the same upright face whichever style you pick. If you already keep a scanned signature as a PNG or JPG image, pick that image and reuse the mark you have always used.`,
          "Whichever you choose, the rest works the same way: position the signature precisely on the page, then export.",
        ],
      },
      {
        id: "your-file-stays-on-your-device",
        heading: "Your file stays on your device",
        body: [
          "Sign PDF is an in-browser tool. It runs entirely in your browser, which means the contract, lease, or offer letter you open never leaves your device — the file stays local from the moment you pick it to the moment you export. For the kind of paperwork that usually carries a signature, that is the difference that matters most.",
          `One honest nuance: the tool is not fully offline. ${offlineAnswer("sign-pdf")}`,
        ],
      },
      {
        id: "output-and-limits",
        heading: "What you get, and the limits",
        body: [
          `The tool accepts PDF input and produces a PDF: your original document with the signature placed where you put it. The per-file ceiling is ${ceilingMb("sign-pdf")} MB.`,
        ],
      },
      {
        id: "when-someone-else-needs-to-sign",
        heading: "When someone else needs to sign",
        body: [
          "Sign PDF covers self-signing: you create and place your own signature on a document you already have. When the signature you need is someone else's, Request Signatures prepares the document for them: it adds a named, fillable field for each signer and packages the PDF with a manifest and an audit trail, for you to send. It does not send the request or collect the signatures itself.",
          "And when the document is a form as much as it is a contract, pair signing with Fill Forms, which completes a PDF's existing AcroForm fields — text, checkboxes, radio buttons, dropdowns, and lists — right in your browser. Fill the fields in Fill Forms and export the completed PDF, then open that file in Sign PDF to add your signature.",
        ],
      },
    ],
    faq: [
      {
        question: "Do I need an account to sign a PDF?",
        answer:
          "No account is needed. Open the Sign PDF tool, create a signature, place it, and export the signed file.",
      },
      {
        question: "Does my PDF leave my device when I sign it?",
        answer:
          "No. Sign PDF runs entirely in your browser, so the file stays on your device from start to finish.",
      },
      {
        question: "Does Sign PDF work offline?",
        answer: `Not fully. ${offlineAnswer("sign-pdf")}`,
      },
      {
        question: "How large can the PDF be?",
        answer: `Up to ${ceilingMb("sign-pdf")} MB per file.`,
      },
      {
        question: "Can I collect signatures from other people?",
        answer:
          "Sign PDF handles your own signature. For signatures from others, Request Signatures prepares the PDF with a named, fillable field for each signer and packages it for you to send — pdf.xyz does not send it to them or collect the signatures.",
      },
    ],
    published: "2026-09-17",
    updated: "2026-10-24",
  },
  {
    slug: "how-to-make-a-scanned-pdf-searchable",
    title: "How to make a scanned PDF searchable",
    description:
      "OCR a scanned PDF so its text becomes searchable and selectable — processed on an auto-deleting server, no account needed.",
    tools: ["ocr-pdf", "pdf-to-text", "extract-tables"],
    keywords: [
      "how to make a scanned pdf searchable",
      "ocr pdf online",
      "convert scanned pdf to searchable pdf",
      "copy text from scanned pdf",
      "recognize text in pdf",
    ],
    intro: [
      "To make a scanned PDF searchable, run it through the OCR PDF tool. Optical character recognition reads the page images and adds a searchable, copyable text layer, so the file you download responds to search and lets you select and copy text like any other document.",
      "This tool runs on a secure server rather than in your browser. Your file uploads over an encrypted connection, the job runs there, and the input is deleted when the job finishes. There is no account step anywhere in the flow — open the page, add the file, download the result.",
      "Scans on paper are not the only input, either. A JPG or PNG — a photo of a contract, a screenshot of a form — goes in the same way and comes out as a searchable PDF or as plain text.",
    ],
    steps: [
      "Open the OCR PDF tool.",
      "Add your scanned PDF, JPG, or PNG — it uploads over an encrypted connection to an isolated server.",
      `Pick the recognition languages that appear in your document — up to ${MAX_OCR_LANGUAGES} per job. The page's live status shows which language packs our server reports as installed.`,
      "Start the job. Our server runs optical character recognition, adds the text layer, and deletes the input when the job finishes.",
      `Download the result. The link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, so save the result promptly.`,
      "Open the downloaded PDF and try a search, or select and copy a passage. Both now work because the text layer is in place.",
    ],
    sections: [
      {
        id: "pick-the-right-languages",
        heading: "Pick the right recognition languages",
        body: [
          `Recognition is language-aware. The tool advertises ${OCR_LANGUAGES.length} recognition languages, and you can select up to ${MAX_OCR_LANGUAGES} of them for a single job — so a document that mixes languages can name up to ${MAX_OCR_LANGUAGES} of the languages it contains in a single job.`,
          "The advertised list and the installed list are treated as two different claims, deliberately. Our server reports which language packs it actually has installed, and the page's live status reflects that report — what you can run is governed by what our server says is really there, not by a static list.",
        ],
      },
      {
        id: "what-you-get-back",
        heading: "What you get back",
        body: [
          "The tool's outputs are PDF and TXT. The searchable PDF keeps your scanned pages and adds a searchable, copyable text layer, so search, text selection, and copying all start working. The TXT output is the recognized text on its own — the right choice when you want the words and not the page images.",
          "If the goal is text you can reuse elsewhere, the PDF to Text tool is the natural next step once a PDF has a text layer; and for documents built around tables, Extract Tables is the related tool aimed at exactly that.",
        ],
      },
      {
        id: "where-your-file-goes",
        heading: "Where your file goes",
        body: [
          "OCR PDF does its work on a secure server: your file uploads over an encrypted connection and is processed there. The input is deleted when the job finishes.",
          `The result is held only briefly. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule. No account is involved at any point.`,
        ],
      },
      {
        id: "limits-worth-knowing",
        heading: "Limits worth knowing",
        body: [
          `Each file can be up to ${ceilingMb("ocr-pdf")} MB. Accepted inputs are PDF, JPG, and PNG; outputs are PDF and TXT. A single job recognizes up to ${MAX_OCR_LANGUAGES} languages, chosen from the ${OCR_LANGUAGES.length} advertised — with our server's own live report deciding which packs are installed and ready. And because the download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, treat the result as something to save right away rather than a stored copy to come back for.`,
        ],
      },
    ],
    faq: [
      {
        question: "Can I OCR a photo or screenshot instead of a PDF?",
        answer:
          "Yes. The tool accepts JPG and PNG alongside PDF, so a photographed page or a screenshot of a document works the same way — and comes back as a searchable PDF or as plain TXT.",
      },
      {
        question: "What happens to my file after OCR runs?",
        answer: `The job runs on a secure server, and the input is deleted when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
      },
      {
        question: "Which languages can the OCR recognize?",
        answer: `${OCR_LANGUAGES.length} languages are advertised, with up to ${MAX_OCR_LANGUAGES} selectable per job. Our server reports the packs it actually has installed, and the page's live status reflects that report.`,
      },
      {
        question: "How large can my scanned PDF be?",
        answer: `Up to ${ceilingMb("ocr-pdf")} MB per file, whether the input is a PDF, a JPG, or a PNG.`,
      },
      {
        question: "Do I need an account to make a scanned PDF searchable?",
        answer:
          "No account is needed. Open the OCR PDF tool, add your file, run the job, and download the searchable result.",
      },
    ],
    published: "2026-09-17",
    updated: "2026-10-30",
  },
  {
    slug: "how-to-password-protect-a-pdf",
    title: "How to password-protect a PDF",
    description:
      "Password-protect a PDF with real AES encryption. Your file goes to an auto-deleting server, and no account is needed.",
    tools: ["protect-pdf", "unlock-pdf", "redact-pdf"],
    keywords: [
      "password protect pdf",
      "encrypt pdf with password",
      "add password to pdf",
      "lock pdf with password",
      "secure pdf online",
    ],
    intro: [
      "To password-protect a PDF, open the Protect PDF tool on pdf.xyz, add your file, and set a password. The tool applies real AES encryption with qpdf, so only people who have the password can open the resulting PDF.",
      `Protect PDF is a server tool: encryption runs on an auto-deleting secure server rather than in your browser. Your file uploads over an encrypted connection, and our server deletes the input when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
      "No account is needed — open the tool, pick a file, choose a password, and download the encrypted copy. If you later need to remove the protection from a copy you can open, the Unlock PDF tool reverses the process using the password you know.",
    ],
    steps: [
      "Open the Protect PDF tool.",
      "Add the PDF you want to protect — it uploads over an encrypted connection to our secure server.",
      "Set the password that will be required to open the document. Anyone without it will not be able to open the protected copy.",
      "Run the tool. Our secure server applies AES encryption with qpdf and deletes the input when the job finishes.",
      `Download the protected PDF. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, so save the file right away.`,
      "Confirm the protection: open the downloaded copy in your PDF viewer and check that it asks for the password before showing the document.",
    ],
    sections: [
      {
        id: "what-the-password-does",
        heading: "What the password actually does",
        body: [
          "Protect PDF adds a password and real AES encryption, applied with qpdf. The document itself is encrypted, which means the password is not a polite request — only people who have it can open the file. You start with a PDF and get back a PDF — one that simply refuses to open without the password.",
          "Because the protection is encryption rather than a setting, it cuts both ways: the file is genuinely locked to anyone without the password, and it is just as locked to you if the password is lost. Read the limits below before you protect the only copy of something important.",
        ],
      },
      {
        id: "where-your-file-is-processed",
        heading: "Where your file is processed",
        body: [
          `Protect PDF runs on the server side, because the encryption uses qpdf on an auto-deleting secure server. Your PDF travels over an encrypted connection, our isolated server applies the encryption, and the input is deleted when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
          "No account is needed at any step. Because the link is deliberately short-lived, download the protected file as soon as the job completes and keep your own copy.",
        ],
      },
      {
        id: "limits-worth-knowing",
        heading: "Limits worth knowing",
        body: [
          `Each file can be up to ${ceilingMb("protect-pdf")} MB. The tool accepts PDF input and produces PDF output — it does not convert other formats.`,
          "The most important limit is the one you set yourself: the password. If it is lost, the Unlock PDF tool cannot help — it removes a password from a PDF you can already open, by entering the password that works, and it cannot recover or bypass a password nobody knows. Choose a password you can retrieve later, and record it somewhere dependable before you share the protected file.",
        ],
      },
      {
        id: "when-a-password-is-not-enough",
        heading: "When a password is not enough",
        body: [
          "A password controls who can open the document; it does not change what is inside it. Once someone opens the file with the password, everything in it is readable.",
          "If specific content needs to be gone from the document itself — ID numbers, names, anything sensitive — use Redact PDF first. It covers the sensitive areas with solid boxes, then rebuilds each page as a flattened image so the text and vectors underneath are removed rather than hidden. Protect the redacted copy with a password afterward, and the two protections stack: the content is gone from the document, and the document only opens for people you gave the password to.",
        ],
      },
    ],
    faq: [
      {
        question: "Does password-protecting a PDF upload my file?",
        answer:
          "Yes. Protect PDF runs on a secure server rather than in the browser, because the AES encryption is applied with qpdf. The file travels over an encrypted connection, our server is isolated, and it deletes the input when the job finishes.",
      },
      {
        question: "How long does my protected PDF stay available?",
        answer: `The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule. Download the result as soon as the job completes and keep your own copy.`,
      },
      {
        question: "What kind of encryption does Protect PDF use?",
        answer:
          "Real AES encryption, applied with qpdf. The output is an encrypted PDF that only opens for someone who has the password.",
      },
      {
        question: "How large can my file be?",
        answer: `Up to ${ceilingMb("protect-pdf")} MB per file.`,
      },
      {
        question: "What if I forget the password later?",
        // One sentence for both places that say it (tool-facts owns it).
        answer: forgottenPasswordAnswer(),
      },
    ],
    published: "2026-09-17",
    updated: "2026-10-30",
  },
  {
    slug: "how-to-translate-a-pdf",
    title: "How to translate a PDF into another language",
    description:
      "Translate a PDF into another language with AI. Get Markdown and plain text back; our secure server wipes inputs at job end. No account needed.",
    tools: ["translate-pdf", "ocr-pdf", "summarize-pdf"],
    keywords: [
      "translate pdf",
      "pdf translation",
      "translate pdf to english",
      "ai pdf translator",
      "translate pdf online",
      "translate a pdf document",
    ],
    intro: [
      "To translate a PDF into another language, open the Translate PDF tool on pdf.xyz, pick your file, and choose the language you want. AI translates the PDF's selectable text and returns it as translated Markdown and plain text, ready to download.",
      `Translate PDF is one of the AI tools, so the work does not happen in your browser: your PDF uploads over an encrypted connection to our processing server, which extracts its selectable text and sends that text — not the file — to a third-party AI provider to translate. Inputs are wiped when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule. No account is needed at any point.`,
      "Know what you are getting before you start: a text translation, not a page-by-page rebuild. The output is the document's words in the new language, packaged as Markdown and plain text rather than a re-laid-out PDF. That focus on the text is also what lets long documents be handled sensibly — split at page boundaries, translated in ordered passes, and reassembled rather than refused.",
    ],
    steps: [
      "Open the Translate PDF tool.",
      "Pick the PDF you want translated. The tool reads selectable text, so if your document is a scan, run it through OCR PDF first.",
      "Upload your PDF — it travels over an encrypted connection to our secure server that runs the job.",
      `In “Translate into”, pick one of the ${TRANSLATE_LANGUAGES.length} languages offered, and leave “Source language” on “Auto-detect” or set it yourself.`,
      "Start the translation. A long document is not refused: it is split at page boundaries, translated a few pages at a time, and reassembled in order. Our server deletes the input when the job finishes.",
      `Download the result — translated Markdown and plain text, packaged together. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, so save it to your device.`,
    ],
    sections: [
      {
        id: "what-you-get-back",
        heading: "What you get back",
        body: [
          "Translate PDF outputs a Markdown file and a plain-text file, delivered together as a single ZIP. Markdown keeps the translation usable as a document — read it as-is, convert it, or paste it wherever the text needs to go. Plain text is the same words with nothing else attached.",
          "What it does not produce is a re-laid-out PDF. The translation covers the words, not the design: fonts, columns, and positioning from the original are not reconstructed in the new language. If the goal is the same PDF in a different language, plan on taking the translated text into your own layout — this tool's job is getting the words right. If what you need from a long document is the gist rather than a full translation, Summarize PDF works from the same selectable text.",
        ],
      },
      {
        id: "long-documents-and-limits",
        heading: "Long documents, oversized pages, and the allowance",
        body: [
          "Each translation pass carries a bounded amount of selectable text, because translation writes roughly as much as it reads. The exact character figures, and the approximate page ranges they work out to, are stated on the Translate PDF page itself. A longer document is not refused: it is split at page boundaries, translated a few pages at a time, and reassembled in order, so the result reads front to back like the original.",
          `Two limits can still show up in the output, and both announce themselves. A single page holding more text than one pass can carry cannot be translated at all — it is skipped, and the result says so in place, right where that page was. And the amount translated in a day is bounded by the free allowance. ${aiAllowanceFactFor("translate-pdf")} A document longer than the allowance covers is translated as far as the allowance reaches, with the rest marked in place and the reason named — nothing stops silently. Files themselves are capped at ${ceilingMb("translate-pdf")} MB.`,
        ],
      },
      {
        id: "where-your-file-goes",
        heading: "Where your file goes",
        body: [
          `Translate PDF is one of the AI tools, so processing does not run in your browser. Your PDF uploads over an encrypted connection to our processing server. The server extracts the PDF's selectable text and sends that text to a third-party AI provider, which writes the translation — the PDF file itself is not sent to the provider. Inputs are wiped when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule. Section 3 of our privacy policy covers the provider's side.`,
          "No account is needed for any of this. Open the tool, translate, and download the result.",
        ],
      },
      {
        id: "scanned-pdfs-need-ocr-first",
        heading: "Scanned PDFs need OCR first",
        body: [
          "The tool translates a PDF's selectable text — the kind you can highlight and copy. A scanned document is a picture of text, so there is nothing selectable to translate. Run the scan through OCR PDF first to recognize the text, then bring the result to Translate PDF.",
          `OCR PDF advertises ${OCR_LANGUAGES.length} recognition languages, with up to ${MAX_OCR_LANGUAGES} selectable per job, and its page's live status shows which language packs are actually installed.`,
        ],
      },
    ],
    faq: [
      {
        question: "Can I translate a PDF for free?",
        answer: `Yes, with no account. ${aiAllowanceFactFor("translate-pdf")} If a document needs more than the allowance has left, it is translated as far as the allowance reaches, and the untranslated remainder is marked in place with the reason named.`,
      },
      {
        question: "What happens to my PDF after it is translated?",
        answer: `Our processing server extracts its selectable text and sends that text — not the file — to a third-party AI provider for translation. Inputs are wiped when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
      },
      {
        question: "Which languages can I translate a PDF into?",
        answer: TRANSLATE_LANGUAGES_ANSWER,
      },
      {
        question: "Will the translation look like the original PDF?",
        answer:
          "No. The output is translated Markdown and plain text, not a re-laid-out PDF. The words are translated; the original's design is not rebuilt around them. Take the text into your own document if you need the translation typeset.",
      },
      {
        question: "How much of a PDF can be translated in one run?",
        answer:
          "Each pass carries a bounded amount of selectable text — the exact figures are stated on the Translate PDF page. A longer document is split at page boundaries, translated pass by pass, and reassembled in order. Two things bound how far one run gets. A single page holding more text than a pass can carry cannot be translated at all — it is skipped, and the result notes it in place. And the free daily allowance: the run translates as far as the allowance reaches, with the rest marked in place and the reason named.",
      },
      {
        question: "Can I translate a scanned PDF?",
        answer:
          "Not directly — a scan has no selectable text. Use OCR PDF to recognize the text first, then translate the output.",
      },
    ],
    published: "2026-09-17",
    updated: "2026-10-30",
  },
  {
    slug: "how-to-delete-pages-from-a-pdf",
    title: "How to delete pages from a PDF",
    description:
      "Remove unwanted pages from a PDF by clicking thumbnails or typing a range — right in your browser, so the file never leaves your device. No account needed.",
    tools: ["remove-pages", "extract-pages", "organize-pages"],
    keywords: [
      "delete pages from pdf",
      "remove pages from pdf",
      "delete a page in a pdf",
      "trim pdf pages",
    ],
    intro: [
      "To delete pages from a PDF, open the Delete Pages tool, pick your file, select the pages you want gone, and download the trimmed copy. Every page appears as a thumbnail, so you can see exactly what you are removing before anything changes.",
      "The work happens in your browser: the PDF stays on your device from start to finish, and there is no account to create. Your original file is never changed — the download is a new PDF without the pages you removed.",
      "This guide covers the ways to select pages, what the trimmed file keeps, and when Extract Pages or Organize Pages is the better fit.",
    ],
    steps: [
      "Open the Delete Pages tool.",
      "Pick the PDF you want to trim — it stays on your device the whole time.",
      "Click each page you want to delete. Hold Shift and click to select a whole run of pages at once.",
      "Or type the pages as a list, such as 1-3, 5, and press Select.",
      "Delete the selected pages. At least one page has to stay, so the tool will not remove every page.",
      "Download the trimmed PDF.",
    ],
    sections: [
      {
        id: "selecting-pages",
        heading: "Three ways to select pages",
        body: [
          "Clicking a thumbnail selects that page, and clicking it again deselects it. Holding Shift while you click selects every page between the one you touched last and this one — the quick way to clear out a run of pages at the end of a scan.",
          `Typing is faster in a long document. Enter single pages and ranges separated by commas — 1-3, 5 selects pages one to three and page five — and press Select. A range can be left open: 10- runs from page ten to the end. To delete every other page, list them: ${EVERY_OTHER_PAGE_EXAMPLE}.`,
          "Select all, Clear and Invert work on the whole selection. Invert flips it — every selected page becomes unselected and every other page becomes selected — which helps when it is easier to pick the pages you want to keep.",
        ],
      },
      {
        id: "what-the-file-keeps",
        heading: "What the trimmed file keeps",
        body: [
          pageToolKeeps("subset"),
          "Your original is never modified. Deleting pages produces a new PDF, and the file you started from stays exactly as it was on your device — so a page removed by mistake is still there to go back to.",
        ],
      },
      {
        id: "related-tools",
        heading: "When another tool fits better",
        body: [
          "If you want to keep a few pages rather than remove a few, Extract Pages is the mirror image: select the pages to keep and export them as a new PDF. Organize Pages lets you delete, reorder, rotate and duplicate pages on one board in a single pass.",
          `Both run in your browser as well. Delete Pages accepts PDFs up to ${ceilingMb("remove-pages")} MB per file.`,
        ],
      },
    ],
    faq: [
      {
        question: "Is my PDF sent to a server when I delete pages?",
        answer:
          "No. Delete Pages runs entirely in your browser, and the file stays on your device from start to finish.",
      },
      {
        question: "Can I get a deleted page back?",
        answer:
          "Yes, from your original: it is never changed. The download is a new PDF, so every page you removed is still in the file on your device.",
      },
      {
        question: "Does the trimmed PDF keep bookmarks and form fields?",
        answer: pageToolKeepsAnswer("subset"),
      },
      {
        question: "How do I delete every other page?",
        answer: `Type the pages as a list — for example ${EVERY_OTHER_PAGE_EXAMPLE} — and press Select; those pages are selected, and Delete removes them.`,
      },
      {
        question: "How large can the PDF be?",
        answer: `Up to ${ceilingMb("remove-pages")} MB per file.`,
      },
    ],
    published: "2026-09-27",
    updated: "2026-10-07",
  },
  {
    slug: "how-to-convert-markdown-to-pdf",
    title: "How to convert Markdown to PDF",
    description:
      "Paste Markdown or pick a .md file and get a typeset PDF — headings, lists, quotes and code — made in your browser, so nothing leaves your device.",
    tools: ["markdown-to-pdf", "text-to-pdf", "pdf-to-markdown"],
    keywords: [
      "markdown to pdf",
      "md to pdf",
      "convert markdown to pdf",
      "readme to pdf",
      "markdown pdf converter",
    ],
    intro: [
      "To turn Markdown into a PDF, open the Markdown to PDF tool, paste your Markdown or pick a .md file, and create the PDF. Headings, lists, quotes and code blocks are typeset into pages right in your browser.",
      "Nothing is sent to a server: the text stays on your device from start to finish, and there is no account to create.",
      "This guide lists the Markdown the tool supports, what the finished page looks like, and when Text to PDF is the simpler choice.",
    ],
    steps: [
      "Open the Markdown to PDF tool.",
      "Paste your Markdown into the editor, or pick a .md file — it stays on your device.",
      "Create the PDF — it is typeset in your browser.",
      "Download the PDF.",
    ],
    sections: [
      {
        id: "supported-markdown",
        heading: "The Markdown it supports",
        body: [
          MARKDOWN_SYNTAX_FACT,
          "Headings run from # to ######, lists can be bulleted or numbered, and code inside triple-backtick fences is set in a fixed-width font with its line breaks kept.",
        ],
      },
      {
        id: "the-page",
        heading: "What the PDF looks like",
        body: [
          `${TEXT_PAGE_FACT} There is no page-size or margin setting.`,
          `Sources can be up to ${MAX_SOURCE_MB} MB. For plain notes without any Markdown, Text to PDF paginates the text as it is; to go the other way, PDF to Markdown turns a PDF's selectable text back into Markdown.`,
        ],
      },
    ],
    faq: [
      {
        question: "Is my Markdown sent to a server?",
        answer:
          "No. Markdown to PDF runs entirely in your browser, and the text stays on your device from start to finish.",
      },
      {
        question: "Does it support tables?",
        answer:
          "Yes. A GFM table — a header row, then a divider row of dashes — prints as a grid, keeping each column's alignment and wrapping long cells to fit the page width.",
      },
      {
        question: "Can I choose the page size?",
        answer: `No. ${TEXT_PAGE_FACT}`,
      },
      {
        question: "Does Markdown to PDF work offline?",
        answer: `Not fully. ${offlineAnswer("markdown-to-pdf")}`,
      },
    ],
    published: "2026-09-27",
    updated: "2026-09-28",
  },
  {
    slug: "how-to-redact-a-pdf",
    title: "How to redact a PDF permanently",
    description:
      "Redact a PDF so the text under each box is gone, not hidden: find words, detect personal data, then flatten or remove — in your browser. No account needed.",
    tools: ["redact-pdf", "ocr-pdf", "protect-pdf"],
    keywords: [
      "redact pdf",
      "how to redact a pdf",
      "black out text in pdf",
      "redact text in a pdf",
      "remove sensitive information from pdf",
      "redact pdf in browser",
    ],
    intro: [
      "To redact a PDF, open the Redact PDF tool, find the words that have to go — or let it detect email addresses, phone numbers, card numbers, IBANs and dates of birth — tick the matches in the review list, and download the result. The box is not drawn on top of the text: what was underneath no longer exists in the file.",
      `That is the whole difference between redacting and covering, and it has a cost worth knowing before you start. ${REDACT_OUTPUT_FACT}`,
      "Redact PDF runs in your browser, so the document you are redacting stays on your device. No account is needed.",
    ],
    steps: [
      "Open the Redact PDF tool.",
      "Pick the PDF you need to redact — it stays on your device the entire time.",
      "Under “Find text to redact”, type a name or number and press “Find”, or tick the kinds of personal data under “Detect personal data” and press “Detect”. Untick any match in the review list that should stay.",
      "For anything the text search cannot reach, such as a signature or a photo, enter its “Page” and its position and size in PDF points, measured from the bottom-left corner of the page, then press “Add area”.",
      `Choose the “Method” — “Flatten every page” or “Remove text under boxes” — and the “Redaction fill”, “Black” or “White”. When flattening, choose the output quality too: ${REDACT_PRESET_CHOICES}.`,
      "Press “Redact PDF” and save the new file to your device. Your original file is not changed.",
    ],
    sections: [
      {
        id: "redacting-is-not-covering",
        heading: "Redacting is not the same as covering",
        body: [
          "A black rectangle drawn over text in a PDF editor hides it from view and nothing more. The text is still in the file, and anyone can select it, copy it or find it with a search — which is how redacted documents leak.",
          `Redact PDF removes it instead. ${REDACT_MECHANISM}`,
        ],
      },
      {
        id: "every-page-becomes-an-image",
        heading: "Flatten every page, or remove only the text",
        body: [
          REDACT_OUTPUT_FACT,
          REDACT_REMOVE_FACT,
          "If you flattened and the rest of the document needs to be searchable again, run the redacted file through OCR PDF afterwards. OCR recognizes the text that is still visible on the pages; the text under a box is gone, so there is nothing there for it to find.",
          `When flattening, choose the resolution before you run: ${REDACT_PRESET_CHOICES}. A higher resolution keeps small print legible and makes a larger file.`,
        ],
      },
      {
        id: "find-every-instance",
        heading: "Find every instance before you redact",
        body: [
          REDACT_FIND_FACT,
          "Detection matches patterns and checksums, not meaning: it does not know a name from any other word, and it can miss a number written in a format it does not expect. Treat the list as a starting point, search for the names yourself, and read the list before you redact.",
        ],
      },
      {
        id: "your-file-stays-on-your-device",
        heading: "Your file stays on your device",
        body: [
          "Redact PDF is an in-browser tool: your browser renders the pages and rebuilds the file, so the document you are redacting never leaves your device. That matters most for exactly the files people redact — contracts, statements and records with personal details in them.",
          `It is not fully offline. ${offlineAnswer("redact-pdf")}`,
        ],
      },
      {
        id: "before-you-share-it",
        heading: "Before you share it",
        body: [
          "Open the downloaded PDF and check that each box sits where you meant it to before you send the file anywhere: an area typed in by position that sits a little off leaves the edge of a word readable.",
          "Redaction removes content; it does not lock the file. If the redacted PDF should also need a password to open, run it through Protect PDF afterwards.",
        ],
      },
    ],
    faq: [
      {
        question: "Can redacted text be recovered?",
        answer: REDACT_RECOVERY_ANSWER,
      },
      {
        question: "Is a redacted PDF still searchable?",
        answer: REDACT_SEARCH_ANSWER,
      },
      {
        question: "Does my PDF leave my device when I redact it?",
        answer:
          "No. Redact PDF runs entirely in your browser, so the file stays on your device from start to finish.",
      },
      {
        question: "Does Redact PDF work offline?",
        answer: `Not fully. ${offlineAnswer("redact-pdf")}`,
      },
      {
        question: "How large can the PDF be?",
        answer: `Up to ${ceilingMb("redact-pdf")} MB per file.`,
      },
    ],
    published: "2026-09-27",
    updated: "2026-10-25",
  },
  {
    slug: "how-to-repair-a-damaged-pdf",
    title: "How to repair a damaged or corrupted PDF",
    description:
      "Rebuild a damaged PDF with qpdf on a secure server that deletes the input when the job finishes, and see what had to be fixed. No account needed.",
    tools: ["repair-pdf", "unlock-pdf", "ocr-pdf"],
    keywords: [
      "repair pdf",
      "fix corrupted pdf",
      "repair damaged pdf",
      "pdf file is damaged",
      "recover a broken pdf",
      "repair pdf online",
    ],
    intro: [
      "To repair a damaged PDF, open the Repair PDF tool, upload the file, and download the rebuilt copy. Our server runs the file through qpdf, which reads what it can of the damaged structure and writes it out as a new, well-formed PDF.",
      `Repair PDF is a server tool: your file travels over an encrypted connection to a secure server, which deletes the input when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule. No account is needed.`,
    ],
    steps: [
      "Open the Repair PDF tool.",
      `Upload the damaged PDF — it travels over an encrypted connection, and files up to ${ceilingMb("repair-pdf")} MB are accepted. It only has to start like a PDF, so a truncated file is taken in.`,
      "Press “Repair on our secure server”. qpdf rewrites the file's structure on our secure server, which deletes the input when the job finishes.",
      "If the file had to be rebuilt, read the list above the download: it names what was reconstructed.",
      `Download the repaired PDF. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, so save it right away.`,
    ],
    sections: [
      {
        id: "what-it-can-take",
        heading: "Which files Repair PDF can take",
        body: [
          REPAIR_TAKES,
          "How much comes back depends on what survived. The repair rebuilds the file around the content it can still read; it cannot recreate content that is no longer in the file.",
        ],
      },
      {
        id: "reading-the-warnings",
        heading: "Reading the warnings",
        body: [
          REPAIR_WARNINGS_ANSWER,
          "Compare those parts against the original, or against another copy of the document if you have one, before you rely on the repaired file.",
        ],
      },
      {
        id: "where-the-repair-runs",
        heading: "Where the repair runs",
        body: [
          `Repair PDF runs on a secure server, not in your browser. Your file is uploaded over an encrypted connection, qpdf rebuilds it there, and the input is deleted when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
        ],
      },
      {
        id: "when-it-is-not-damage",
        heading: "When the problem is not damage",
        body: [
          "A PDF that asks for a password is locked, not broken. If you know the password, Unlock PDF removes it and gives you an unprotected copy; it cannot recover a password you do not know.",
          "A scanned document that opens but has no text you can select is not damaged either — its pages are pictures. OCR PDF recognizes the text in them.",
        ],
      },
    ],
    faq: [
      {
        question: "Which damaged PDFs can be repaired?",
        answer: REPAIR_TAKES,
      },
      {
        question: "What do the warnings after a repair mean?",
        answer: REPAIR_WARNINGS_ANSWER,
      },
      {
        question: "What happens to my PDF after the repair runs?",
        answer: `The file is processed on a secure server, and the input is deleted when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
      },
      {
        question: "How large can the PDF be?",
        answer: `Up to ${ceilingMb("repair-pdf")} MB per file.`,
      },
      {
        question: "Do I need an account to repair a PDF?",
        answer:
          "No account is needed. Open Repair PDF, upload the file, and download the repaired copy.",
      },
    ],
    published: "2026-09-27",
    updated: "2026-10-30",
  },
  {
    slug: "how-to-add-page-numbers-to-a-pdf",
    title: "How to add page numbers to a PDF",
    description: `Add page numbers to a PDF in your browser: pick a format and one of ${STAMP_POSITIONS.length} positions, skip the cover, and choose the first number. No account needed.`,
    tools: ["page-numbers", "header-footer", "merge-pdf"],
    keywords: [
      "how to add page numbers to a pdf",
      "add page numbers to pdf",
      "number pdf pages",
      "pdf page numbering",
      "skip cover page numbering",
    ],
    intro: [
      `To add page numbers to a PDF, open ${nameOf("page-numbers")}, pick your file, choose a number format and a position, and download the numbered copy. The numbers are drawn right in your browser, so the file stays on your device.`,
      "Two settings do most of the work on real documents. Start on page leaves a cover or title page unnumbered, and First number sets the number counting starts from — useful when a document continues from an earlier one.",
    ],
    steps: [
      `Open the ${nameOf("page-numbers")} tool and pick your PDF — it stays on your device.`,
      "Choose a number format preset, or write your own template with {n} for the page number and {total} for the last number.",
      `Pick one of the ${STAMP_POSITIONS.length} positions for the number.`,
      "Set Start on page to skip a cover, and First number to choose where counting starts.",
      "Check the preview beside the format — it shows the label the first numbered page will carry.",
      "Select Add page numbers, then download the numbered PDF.",
    ],
    sections: [
      {
        id: "choosing-a-format",
        heading: "Choosing a format",
        body: [
          "The presets cover the common styles, “Page 1 of N” among them, and the template field takes anything else: {n} becomes the page number and {total} the last number printed, so “{n} / {total}” and “Page {n}” both work.",
        ],
      },
      {
        id: "skipping-the-cover",
        heading: "Skipping the cover and choosing the first number",
        body: [
          "Pages before Start on page get no number at all. First number is the number printed on the first numbered page, and every page after it counts up from there.",
          "{total} follows the same count: it is the last number that will be printed, so a skipped cover is not included in it. With a cover and four pages after it, Start on page 2 and First number 1 turn the default “Page {n} of {total}” into “Page 1 of 4” through “Page 4 of 4”.",
        ],
      },
      {
        id: "position-and-rotated-pages",
        heading: "Position, and pages that are rotated",
        body: [
          `The number can sit in any of ${STAMP_POSITIONS.length} positions: each corner, the middle of each edge, or the center. On a page that carries a rotation, the number still lands in the spot you picked as the page is viewed, and it reads upright.`,
        ],
      },
      {
        id: "before-and-beyond-numbers",
        heading: "Before numbering, and beyond it",
        body: [
          `If the document is still in several files, combine them first with ${nameOf("merge-pdf")}, so the numbering runs across the whole thing instead of restarting in each part.`,
          `If you need more than a number — a title, a date, a confidentiality line — ${nameOf("header-footer")} adds a header and footer with your own text, plus {n}, {total} and {date} fields.`,
        ],
      },
    ],
    faq: [
      {
        question: "Can I leave the cover page unnumbered?",
        answer:
          "Yes. Set Start on page to 2 and the cover gets no number; leave First number at 1, and the page after the cover is numbered 1.",
      },
      {
        question: "Can numbering start at a number other than 1?",
        answer:
          "Yes. First number sets it: set it to 5, and the first numbered page shows 5.",
      },
      {
        question: "Does my PDF leave my device?",
        answer: `No. ${nameOf("page-numbers")} runs entirely in your browser, and the file stays on your device from start to finish.`,
      },
      {
        question: "How large can my PDF be?",
        answer: `Up to ${ceilingMb("page-numbers")} MB per file.`,
      },
    ],
    published: "2026-09-27",
    updated: "2026-09-27",
  },
  {
    slug: "how-to-flatten-a-pdf-form",
    title: "How to flatten a filled PDF form",
    description:
      "Flatten a filled PDF form in your browser, so its answers become part of the page and can't be edited — before you send it, print it or lock it with a password.",
    tools: ["flatten-pdf", "fill-forms", "protect-pdf"],
    keywords: [
      "how to flatten a pdf form",
      "flatten pdf",
      "flatten pdf form",
      "lock pdf form fields",
      "make pdf form not editable",
    ],
    intro: [
      `To flatten a PDF form, open ${nameOf("flatten-pdf")}, pick the filled PDF and select Flatten form fields. Each field's current value is drawn into the page and the field itself is removed, so the answers can no longer be changed in a PDF viewer. It runs in your browser, so the file stays on your device.`,
      `Flattening is the last step of a form's life. Fill it in first — ${nameOf("fill-forms")} completes a PDF's existing form fields in your browser — then flatten the copy you are about to send.`,
    ],
    steps: [
      `Open the ${nameOf("flatten-pdf")} tool and pick your filled PDF — it stays on your device.`,
      "Check that the answers are final — the flattened copy has no fields left to change.",
      "Select Flatten form fields.",
      "Read the result: it says how many form fields were flattened, or that none were found.",
      "Download the flattened PDF, and keep the original if you may need to edit the answers again.",
    ],
    sections: [
      {
        id: "what-gets-flattened",
        heading: "What gets flattened",
        body: [
          "Every fillable form field — text boxes, checkboxes, radio buttons, dropdowns and list boxes — is drawn into the page with its current value and removed as a field. Comments and layers are not form fields, and they are re-saved unchanged.",
          "A PDF with no form fields is re-saved as it is, and the result says no fillable form fields were found — so a file that only looks like a form, such as a scanned paper form, is not changed.",
        ],
      },
      {
        id: "when-flattening-is-refused",
        heading: "When flattening is refused",
        body: [
          "A text field holding characters outside the basic PDF alphabet — Bengali, Chinese or Greek, for example — cannot be flattened yet, because the field is drawn with the form's own font. Instead of producing a page with those characters missing, the tool stops and says which characters it could not draw.",
        ],
      },
      {
        id: "after-flattening",
        heading: "After flattening",
        body: [
          `Flattening stops the answers being edited, but anyone who has the file can still open and read it. If it should only open for certain people, ${nameOf("protect-pdf")} adds a password with AES encryption. That step runs on a secure server rather than in your browser.`,
        ],
      },
    ],
    faq: [
      {
        question: "Why flatten a filled PDF form?",
        answer:
          "So the answers you send are the answers that are read. A flattened copy has no fields left for anyone to change, and its values are part of the page rather than something a viewer draws on top of it.",
      },
      {
        question: "Can I undo flattening?",
        answer:
          "Not in the flattened copy — its fields are gone. The file you picked is not changed, so keep it if you may need to edit the answers again.",
      },
      {
        question: "What if my PDF has no form fields?",
        answer:
          "Nothing is flattened: the file is re-saved as it is, and the result says no fillable form fields were found.",
      },
      {
        question: "Does my PDF leave my device?",
        answer: `No. ${nameOf("flatten-pdf")} runs entirely in your browser, and the file stays on your device from start to finish.`,
      },
      {
        question: "How large can my PDF be?",
        answer: `Up to ${ceilingMb("flatten-pdf")} MB per file.`,
      },
    ],
    published: "2026-09-27",
    updated: "2026-10-30",
  },
  {
    slug: "how-to-compare-two-pdf-files",
    title: "How to compare two PDF files",
    description:
      "Compare two versions of a PDF in your browser: page count, file size and every added or removed line of text, with a downloadable report. Scans need OCR first.",
    tools: ["compare-pdf", "ocr-pdf", "pdf-to-text"],
    keywords: [
      "how to compare two pdf files",
      "compare pdf",
      "pdf diff",
      "find differences between two pdfs",
      "compare pdf versions",
    ],
    intro: [
      `To compare two PDF files, open ${nameOf("compare-pdf")}, pick the two versions, and select Compare PDFs. You get their page counts, the size difference and every line of text that was added or removed, plus a report you can download. It runs in your browser, so both files stay on your device.`,
      "The comparison reads the text in each PDF, line by line. That makes it good at the question most people are asking — what changed in the wording — and blind to changes that are only visual.",
    ],
    steps: [
      `Open the ${nameOf("compare-pdf")} tool.`,
      "Pick two PDFs — the first is treated as the original, the second as the revised version. Both stay on your device.",
      "Select Compare PDFs.",
      "Read the summary: the page counts, the size difference and the number of changed lines.",
      "Review the lines marked removed (-) and added (+).",
      "Download the comparison report as a .txt file.",
    ],
    sections: [
      {
        id: "what-counts-as-a-change",
        heading: "What counts as a change",
        body: [
          "A line of selectable text that is in one PDF and not the other. Lines only in the first PDF are listed as removed, and lines only in the second as added. Extra spaces inside a line and blank lines are ignored, so reflowed spacing does not flood the report.",
          "Because the first file is the original, the order you pick them in matters: swap them and every addition becomes a removal.",
        ],
      },
      {
        id: "scanned-pdfs",
        heading: "Scanned PDFs need OCR first",
        body: [
          `${nameOf("compare-pdf")} reads the text already embedded in each PDF. A scanned page is a picture with no text in it, so two scans compare as having no selectable text at all. Run each one through ${nameOf("ocr-pdf")} first — it adds a searchable text layer on a secure server — then compare the results.`,
        ],
      },
      {
        id: "what-it-does-not-compare",
        heading: "What it does not compare",
        body: [
          `Formatting, images, colors and layout are not compared — this is a text comparison, not a visual one. To read one file's text on its own, ${nameOf("pdf-to-text")} extracts it as a plain .txt file.`,
        ],
      },
    ],
    faq: [
      {
        question: "Does the order of the two files matter?",
        answer:
          "Yes. The first file is treated as the original and the second as the revised version: lines only in the first are listed as removed, and lines only in the second as added.",
      },
      {
        question: "Why does it say no selectable text was found?",
        answer: `Both PDFs are most likely scans, which carry pictures of text rather than text. Run them through ${nameOf("ocr-pdf")} first, then compare the results.`,
      },
      {
        question: "Do my files leave my device?",
        answer: `No. ${nameOf("compare-pdf")} runs entirely in your browser, and both files stay on your device from start to finish.`,
      },
      {
        question: "How large can each PDF be?",
        answer: `Up to ${ceilingMb("compare-pdf")} MB per file.`,
      },
    ],
    published: "2026-09-27",
    updated: "2026-10-30",
  },
  {
    slug: "how-to-remove-a-password-from-a-pdf",
    title: "How to remove a password from a PDF",
    description:
      "Remove the password from a PDF you can open: type the password that works and download an unprotected copy. Runs on an auto-deleting server.",
    tools: ["unlock-pdf", "protect-pdf"],
    keywords: [
      "how to remove a password from a pdf",
      "remove password from pdf",
      "unlock pdf",
      "decrypt pdf",
      "remove pdf password",
    ],
    intro: [
      `To remove a password from a PDF, open ${nameOf("unlock-pdf")}, add the protected file, type the password that opens it, and download an unprotected copy. Anyone can then open that copy without a password.`,
      `${nameOf("unlock-pdf")} runs on a secure server rather than in your browser, because decryption uses the native qpdf engine. Your file uploads over an encrypted connection, and our server deletes the input when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
      "It is not a password cracker. It needs the password that currently opens the file, and it cannot recover, guess or bypass a password nobody knows.",
    ],
    steps: [
      `Open the ${nameOf("unlock-pdf")} tool.`,
      "Add the password-protected PDF — it uploads over an encrypted connection to our secure server.",
      "Type the password that currently opens the file.",
      "Run the tool. Our secure server removes the encryption and deletes the input when the job finishes.",
      `Download the unlocked copy. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, so save it right away.`,
      "Open the downloaded copy to confirm it no longer asks for a password.",
    ],
    sections: [
      {
        id: "what-unlocking-does",
        heading: "What unlocking does",
        body: [
          "Unlocking decrypts the file with the password you type and writes a copy with the encryption removed. The pages themselves are not changed: it is the same document, without the lock.",
        ],
      },
      {
        id: "the-password-you-need",
        heading: "You need the password that opens it",
        body: [
          "An empty password is refused before the job starts, and a password that does not open the file ends the job without an output. Nothing is guessed or tried on your behalf.",
        ],
      },
      {
        id: "putting-the-lock-back",
        heading: "Putting a password back",
        body: [
          `If you only needed the lock off to make a change, put it back afterwards: ${nameOf("protect-pdf")} encrypts a PDF with AES so it only opens with a password, and it runs on the same kind of secure server.`,
        ],
      },
    ],
    faq: [
      {
        question: "Can I remove a password I do not know?",
        answer: `No. ${nameOf("unlock-pdf")} needs the password that currently opens the file. It does not guess, recover or bypass passwords.`,
      },
      {
        question: "Is my PDF uploaded when I unlock it?",
        answer:
          "Yes. Unlocking runs on a secure server rather than in the browser. The file travels over an encrypted connection, and our server deletes the input when the job finishes.",
      },
      {
        question: "How long is the unlocked copy available?",
        answer: `The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule. Download it as soon as the job completes.`,
      },
      {
        question: "How large can my file be?",
        answer: `Up to ${ceilingMb("unlock-pdf")} MB per file.`,
      },
    ],
    published: "2026-09-27",
    updated: "2026-10-30",
  },
  {
    slug: "how-to-edit-text-in-a-pdf",
    title: "How to edit the existing text in a PDF",
    description:
      "Retype a line of a PDF's own text, or find and replace words on every page, in your browser. The old words are removed from the file, not covered up.",
    tools: ["edit-pdf", "pdf-to-word", "ocr-pdf"],
    keywords: [
      "how to edit text in a pdf",
      "edit pdf text",
      "change text in pdf",
      "find and replace in pdf",
      "replace a word in a pdf",
      "fix a typo in a pdf",
    ],
    intro: [
      `To edit the text in a PDF, open ${nameOf("edit-pdf")}, add your file, choose Edit text and click the line you want to change. Retype it, press Apply & download, and the old words are removed from the page and yours are written where they stood.`,
      "To change the same word or name everywhere at once, use Find & replace (Ctrl+F): it searches the text of every page and replaces through the same edit, so the old words leave the file rather than being hidden under a box.",
      `${nameOf("edit-pdf")} runs in your browser tab, so your PDF stays on your device and there is no account to create. Files up to ${ceilingMb("edit-pdf")} MB open. Edit text changes one line at a time and does not reflow a paragraph; for rewriting whole paragraphs, ${nameOf("pdf-to-word")} is the better tool.`,
    ],
    steps: [
      `Open the ${nameOf("edit-pdf")} tool and add your PDF. Its pages appear in your browser, and the file stays on your device.`,
      "Choose Edit text in the toolbar. The PDF's own text is outlined on the page.",
      "Click the line you want to change and retype it. While you type, the editor names the font your words will be written in.",
      "To change a word everywhere, open Find & replace with Ctrl+F, type the words in Find and the new ones in Replace with, then press Replace or Replace all.",
      "Press Apply & download. The edited copy downloads with -edited before the .pdf.",
    ],
    sections: [
      {
        id: "what-edit-text-changes",
        heading: "What Edit text changes in the file",
        body: [
          "Edit text works on the text the PDF really contains. When you apply, the line you retyped is taken out of the page's content and your words are drawn where the line began, so a search or a copy of the saved file finds the new words, not the old ones. Text you did not touch stays as it was, and stays selectable.",
          "Your words are set in the line's own font when that font has every character you typed. When it does not, the closest standard font is used instead, and the editor tells you which one while you type, so a changed line can look slightly different from its neighbours.",
          "A retyped line stays one line. Edit text does not reflow a paragraph, so a much longer replacement does not push the lines below it down; keep a replacement close to the length of what it replaces, or split the change across lines.",
        ],
      },
      {
        id: "find-and-replace",
        heading: "Find and replace across every page",
        body: [
          "Find & replace searches the words of every page as they currently read, so an edit you have already made is searched as edited. Match case narrows the search to the exact capitalisation, and the arrows step to the previous or next match.",
          "Replace changes the match you are on; Replace all changes every match. Either is a normal Edit text edit, so the old words are removed from the file when you apply, and each Replace, or one Replace all, is a single step that Undo takes back.",
        ],
      },
      {
        id: "what-it-cannot-edit",
        heading: "Scans and text it cannot edit",
        body: [
          `A scanned page is a picture of words, so Edit text has nothing to offer there, and the page says it has no editable text. Running ${nameOf("ocr-pdf")} does not change that for this tool: the recognised words are an invisible layer under the picture, and Edit text does not offer that layer, because the words you see are still part of the picture.`,
          `To rework the words of a scan, use ${nameOf("pdf-to-word")} with “${WORD_OCR_LABEL}” ticked: it recognises the text first and gives you a Word document to edit. That tool runs on a secure server rather than in your browser.`,
          "Text the editor cannot change safely, such as vertical text or text nested deep inside an embedded object, is refused with a message rather than half-changed.",
        ],
      },
    ],
    faq: [
      {
        question: "Is the old text really gone, or just covered?",
        answer:
          "It is gone. When you apply, the line you edited is removed from the page's content and the new words are written in its place, so searching or copying the saved file finds only the new words. A Whiteout box is different: it only covers what is underneath, and the covered text stays in the file.",
      },
      {
        question: "Why does my edited line use a different font?",
        answer:
          "The PDF's own font is used when it has every character you typed. Many PDFs embed only the letters they used, so a new letter can be missing from it; then the closest standard font is used instead, and the editor names it while you type.",
      },
      {
        question: "Can I edit the text of a scanned PDF?",
        answer: `Not with Edit text. A scan holds a picture of its words, and the text ${nameOf("ocr-pdf")} adds is an invisible layer that Edit text does not offer. To edit a scan's words, convert it with ${nameOf("pdf-to-word")} and tick “${WORD_OCR_LABEL}”, which recognises the text and hands you an editable Word document.`,
      },
      {
        question: "Can I replace a word on every page at once?",
        answer:
          "Yes. Open Find & replace with Ctrl+F, type the word and its replacement, and press Replace all. Every match on every page is replaced, the old words are removed from the file when you apply, and one Undo takes the whole replacement back.",
      },
      {
        question: "Does my PDF leave my device while I edit it?",
        answer: `No. ${nameOf("edit-pdf")} reads and writes the PDF inside your browser tab. When your words need a script outside the basic Western set, the page fetches a matching Noto font from pdf.xyz; that request asks for a font by name and carries nothing from your document.`,
      },
    ],
    published: "2026-10-29",
    updated: "2026-10-30",
  },
  {
    slug: "how-to-add-a-watermark-to-a-pdf",
    title: "How to add a watermark to a PDF",
    description:
      "Stamp CONFIDENTIAL, DRAFT or your logo on a PDF in your browser: any position or tiled, on the pages you pick, over or behind the content.",
    tools: ["watermark-pdf", "header-footer", "page-numbers"],
    keywords: [
      "how to add a watermark to a pdf",
      "watermark pdf",
      "add logo watermark to pdf",
      "confidential stamp pdf",
      "draft watermark pdf",
      "tile watermark pdf",
    ],
    intro: [
      `To add a watermark to a PDF, open ${nameOf("watermark-pdf")}, add your file, type your text or pick a PNG or JPEG picture, choose where it goes, and press Add watermark. The download is a copy of your PDF with the mark drawn on every page you chose.`,
      `By default the mark is the word CONFIDENTIAL, set diagonally in the middle of every page. The position grid moves it to any of ${STAMP_POSITIONS.length} spots, Tile across the page repeats it in rows, and Pages and layer limits it to the pages you list or puts it behind the page's content instead of over it.`,
      `The stamping runs in your browser tab, so your PDF and your picture stay on your device and no account is needed. ${nameOf("watermark-pdf")} takes one PDF at a time, up to ${ceilingMb("watermark-pdf")} MB.`,
    ],
    steps: [
      `Open the ${nameOf("watermark-pdf")} tool and drop your PDF onto the box, or browse for it. The file stays on your device.`,
      "In the Watermark section, replace CONFIDENTIAL in the Text field with your own wording, or switch the type to Image and add a PNG or JPEG.",
      `Under Appearance, set Opacity, Rotation and Max font size, and for text pick ${WATERMARK_FONTS} and a colour. A picture has Image size instead of Max font size.`,
      `Under Placement, click one of the ${STAMP_POSITIONS.length} cells, or tick Tile across the page to repeat the mark across each page.`,
      "To stamp only some pages, open Pages and layer, choose Selected pages and type a list such as 1-3, 5. Choose Behind content there to draw the mark under the page's text and pictures.",
      "Press Add watermark, then Download watermarked PDF. The copy is named after yours, with -watermarked added.",
    ],
    sections: [
      {
        id: "text-or-image",
        heading: "A text watermark or a logo",
        body: [
          `A text mark is real text drawn into each page. Western European text, accents included, is set in the font you pick (${WATERMARK_FONTS}); letters beyond that set, and many other scripts, make the page fetch a matching Noto font from pdf.xyz first, drawn in its regular weight. Right-to-left scripts are refused with a message rather than stamped with their letters reversed.`,
          "A picture mark takes a PNG or a JPEG, such as your logo. Image size sets its width as a share of the page width, and Opacity lets the page show through it, so a small logo in a bottom corner at low opacity brands every page without covering the text.",
        ],
      },
      {
        id: "position-tile-pages",
        heading: "Position, tiling and pages",
        body: [
          `The position grid has ${STAMP_POSITIONS.length} cells: the four corners, the middle of each edge, and the centre. Tile across the page repeats the mark in rows over the whole page, drawing only copies that fit whole, so a smaller size gives you more of them.`,
          "Each page is measured on its own, so in a document that mixes portrait and landscape sheets, each mark lands where it should on its page. Max font size and Image size are upper limits: on a page too small for the mark, it is drawn at the largest size that fits, and the result panel says on how many pages that happened.",
          "Selected pages takes a list such as 1-3, 5, or an open range such as 4- for page 4 to the end. The pages you leave out are not changed.",
          `For a line of text along the top or bottom edge of every page, ${nameOf("header-footer")} is made for that, and ${nameOf("page-numbers")} numbers the pages.`,
        ],
      },
      {
        id: "behind-content",
        heading: "Over or behind the content",
        body: [
          "Over content, the default, draws the mark on top of the page. Behind content draws it first, so the page's own text and pictures sit on top of it and stay fully readable.",
          "Anything opaque hides a mark drawn behind it. A scanned page is one picture covering the sheet, so a mark behind it disappears; on scans, keep Over content and lower the Opacity instead.",
        ],
      },
    ],
    faq: [
      {
        question: "Can I watermark only some pages?",
        answer:
          "Yes. Open Pages and layer, choose Selected pages, and type the pages as a list such as 1-3, 5, or 4- for page 4 to the end. Only those pages are stamped; the rest are left as they were.",
      },
      {
        question: "Can I use my logo as a watermark?",
        answer:
          "Yes. Switch the Watermark type to Image and add a PNG or JPEG. Image size sets how wide it is as a share of the page, Opacity how faint, and the position grid or Tile across the page where it goes.",
      },
      {
        question: "Can someone remove the watermark?",
        answer:
          "Not with a viewer's switch: the mark is written into the page content, not added as a comment or an optional layer. But a text mark is selectable text, and a PDF editor can delete text or a picture from a page, so treat a watermark as a label and a deterrent, not as protection.",
      },
      {
        question: "Why did my watermark come out smaller than I set?",
        answer:
          "Max font size and Image size are ceilings. On a page too small for the mark at that size, it is drawn at the largest size that fits on the part of the page a reader sees, and the result panel tells you on how many pages that happened. For a larger text mark, shorten the text.",
      },
      {
        question: "Is my PDF sent anywhere when I add a watermark?",
        answer: `No. ${nameOf("watermark-pdf")} stamps the PDF inside your browser tab, so the PDF and any picture you add stay on your device. The only thing the page may fetch is a Noto font from pdf.xyz, when your text needs one; that request carries nothing from your document.`,
      },
    ],
    published: "2026-10-29",
    updated: "2026-10-29",
  },
  {
    slug: "how-to-crop-a-pdf",
    title: "How to crop a PDF and trim its margins",
    description:
      "Trim PDF margins evenly or side by side, in points, millimetres or inches, or let Auto find the white margins for you. Runs in your browser, no account.",
    tools: ["crop-pdf", "rotate-pdf", "compress-pdf"],
    keywords: [
      "how to crop a pdf",
      "crop pdf",
      "trim pdf margins",
      "remove white margins from pdf",
      "auto crop pdf",
      "crop pdf pages",
    ],
    intro: [
      `To crop a PDF, open ${nameOf("crop-pdf")}, add your file, and set how much to trim under Crop margins: one value for all four sides, a separate value for each side, or Auto, which finds the white margins around each page's content for you. Then press Crop PDF and download the result.`,
      `You can measure in ${CROP_UNITS}, crop every page or only the pages you list, and check the result in the Crop preview before anything is cropped. ${nameOf("crop-pdf")} runs in your browser tab, so your PDF stays on your device; it opens one file at a time, up to ${ceilingMb("crop-pdf")} MB.`,
      "Cropping hides the edges rather than deleting them: the tool shrinks each page's visible area, and the content outside it stays in the file, out of view. Selectable text stays selectable, because nothing is redrawn.",
    ],
    steps: [
      `Open the ${nameOf("crop-pdf")} tool and drag your PDF into the drop area, or click it to choose the file. It stays on your device.`,
      `In the Crop margins section, choose Uniform for one All sides slider, or Per side for separate Top, Right, Bottom and Left sliders, and pick ${CROP_UNITS} as the unit. You can drag a slider or type a value in the box beside it.`,
      "For automatic margins, choose Auto and press Find white margins. The tool says how many pages it found content on and names any blank page, which it leaves uncropped.",
      "In the Pages section, keep All pages, or choose Selected pages and type a list such as 2-4, 7.",
      "Check the Crop preview, then press Crop PDF and Download cropped PDF.",
    ],
    sections: [
      {
        id: "manual-margins",
        heading: "Set the margins yourself",
        body: [
          `Uniform trims the same amount from every edge with one All sides slider. Per side gives Top, Right, Bottom and Left their own sliders, so you can take a footer strip off the bottom and leave the other three edges alone. The unit buttons switch between ${CROP_UNITS}; a value you type is read in the unit you chose.`,
          `Margins are measured on the page as your viewer shows it, so Top always trims the edge you see at the top, even on a page that is stored turned and only displayed upright. No page may end up narrower or shorter than ${MIN_CROP_DIMENSION} points: margins that would do that stop the run, and the message names the first page that failed.`,
        ],
      },
      {
        id: "auto-crop",
        heading: "Let Auto find the white margins",
        body: [
          `Auto renders each page in your browser at a low resolution, finds the area that holds anything darker than near-white, such as text, lines, images or a scanner's grey edge, and proposes margins that keep it with ${AUTO_CROP_PAD_PT} points of white on every side. A page with nothing on it is named and left uncropped.`,
          "With content on more than one page you choose between Each page its own box and Same box on every page. Same box on every page uses, for each edge, the smallest margin any page needs, so no page loses content. In Auto, the Crop preview shows the page itself under the proposed box, with Previous page and Next page to check each one.",
          "A scan with a grey or speckled background has no white to find, so Auto may crop little or nothing there. Set the margins yourself instead.",
        ],
      },
      {
        id: "what-cropping-keeps",
        heading: "What cropping keeps",
        body: [
          `The page content itself is not changed: the crop box, the region a PDF viewer shows, gets smaller, and whatever sits outside it is still in the file. That makes cropping a poor way to hide private information; for that, use a redaction tool. It also means the file does not reliably get smaller, so use ${nameOf("compress-pdf")} when size is the goal.`,
          `Margins are measured from the page's current visible area, so cropping an already-cropped file trims further. If a page is on its side, turn it upright with ${nameOf("rotate-pdf")} first, so the edges you see are the edges you name.`,
        ],
      },
    ],
    faq: [
      {
        question: "Can I crop each side of a PDF by a different amount?",
        answer:
          "Yes. Under Crop margins, switch from Uniform to Per side and four sliders appear: Top, Right, Bottom and Left. Setting only Bottom, for instance, removes a footer strip and leaves the other edges alone.",
      },
      {
        question: "Can it remove white margins automatically?",
        answer: `Yes. Choose Auto and press Find white margins. Each page is checked for content, and the proposed crop keeps it with ${AUTO_CROP_PAD_PT} points of white around it; a blank page is named and left uncropped. Check each page in the preview before you press Crop PDF.`,
      },
      {
        question: "Can I set the margins in millimetres or inches?",
        answer: `Yes. Pick ${CROP_UNITS} beside the sliders. Each slider shows its value in that unit as you drag, and the box beside it takes a typed value in the same unit.`,
      },
      {
        question: "Does cropping delete the content outside the margins?",
        answer:
          "No. Cropping shrinks each page's visible area; the content outside it stays in the file, out of view. Nothing on the page is redrawn, so selectable text stays selectable.",
      },
      {
        question: "Why is the Crop PDF button greyed out?",
        answer:
          "It stays off while every slider sits at 0, because there is nothing to crop, and in Auto until Find white margins has found content on at least one page. A Pages list that is empty, backwards or past the last page is rejected with a message.",
      },
    ],
    published: "2026-10-29",
    updated: "2026-10-29",
  },
  {
    slug: "how-to-convert-pdf-to-excel",
    title: "How to convert a PDF to Excel",
    description:
      "Export a PDF's text to an Excel XLSX sheet, one row per line with each value in its column and amounts as numbers. A secure server deletes your PDF after.",
    tools: ["pdf-to-excel", "extract-tables", "ocr-pdf"],
    keywords: [
      "how to convert pdf to excel",
      "pdf to excel",
      "pdf to xlsx",
      "pdf to spreadsheet",
      "export pdf to excel",
    ],
    intro: [
      `To convert a PDF to Excel, open ${nameOf("pdf-to-excel")}, add your PDF, press Export XLSX, and download the workbook. Each line of the PDF's text becomes a row of a sheet named “${XLSX_SHEET_NAME}”, split into cells at ${XLSX_CELL_BREAK_PHRASE}, and each value lands in the column it sits in on the page.`,
      `It is layout placement, not table detection. When you want only the tables out of a page, each on its own, ${nameOf("extract-tables")} is the tool built for that.`,
      `${nameOf("pdf-to-excel")} runs on a secure server, not in your browser: your PDF, up to ${ceilingMb("pdf-to-excel")} MB, travels over an encrypted connection, and our server deletes it when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and a daily storage rule erases the stored workbook.`,
    ],
    steps: [
      `Open the ${nameOf("pdf-to-excel")} tool.`,
      `Add your PDF by dragging it onto the box or clicking browse. Files up to ${ceilingMb("pdf-to-excel")} MB are accepted.`,
      "Press Export XLSX. Your PDF uploads over an encrypted connection, and the button follows the job until the workbook is back in the page.",
      `When “Your XLSX file is ready.” appears, press Download. The link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, so save the workbook right away.`,
      "Open the sheet and tidy it: delete rows that came from page headers and footers, and check dates and codes that stayed text.",
    ],
    sections: [
      {
        id: "how-rows-and-columns-work",
        heading: "How each line becomes a row",
        body: [
          `Every non-empty line of the PDF's text becomes one row, and a line breaks into cells at ${XLSX_CELL_BREAK_PHRASE}; a single space or a comma never starts a new cell. Rows that line up are treated as one table, so a blank cell stays blank and the values after it stay under their own headings. ${XLSX_MERGE_CAVEAT}`,
          "Pages follow one another with no blank row between them, so page headers, footers and page numbers printed as text end up among the data rows. Ruling lines and cell borders are ignored, merged cells are not rebuilt, and fonts, colours and images are not carried over.",
        ],
      },
      {
        id: "numbers-stay-numbers",
        heading: "Amounts arrive as numbers",
        body: [
          `An amount or a percentage written like ${XLSX_AMOUNTS} is stored as a number, so SUM adds a column up without converting anything, and the comma inside an amount never splits it. A date such as ${XLSX_TEXT_EXAMPLE}, a European-style 1.250,00, a negative in brackets and a code with leading zeros stay text, so convert those columns before you calculate with them.`,
        ],
      },
      {
        id: "scans-and-tables",
        heading: "Scanned PDFs and table-only exports",
        body: [
          `A scanned page holds a picture of its words, so it has no text to export. A fully scanned PDF is refused with a message pointing to ${nameOf("ocr-pdf")}: run it there with the language the page is written in, choose a searchable PDF, and bring that file back here. If only some pages are scans, the export succeeds and the result says which pages had no text.`,
          `${nameOf("extract-tables")} looks for tables by where the words sit, keeps only the regions that read as a grid of values, and hands back a CSV per table plus one workbook with a sheet for each. Choose it when you want the tables alone, without the headings and paragraphs around them.`,
        ],
      },
    ],
    faq: [
      {
        question: "Will my table's rows and columns line up in Excel?",
        answer: `Usually, when the rows line up on the page: each value goes in the column it sits in, so a blank cell stays blank. A cell whose text wraps onto a second printed line gives you two rows, and two columns printed only one space apart stay in a single cell. ${XLSX_MERGE_CAVEAT}`,
      },
      {
        question: "Will SUM work on the numbers?",
        answer: `For amounts and percentages written like ${XLSX_AMOUNTS}, yes: each is stored as a number. Dates such as ${XLSX_TEXT_EXAMPLE}, European-style 1.250,00, negatives in brackets and codes with leading zeros stay text.`,
      },
      {
        question: "Can I convert a scanned PDF to Excel?",
        answer: `Not directly: a scan has no selectable text, so the job is refused with a link to ${nameOf("ocr-pdf")}. Run OCR first with the right language, choose a searchable PDF as the result, and convert that file here.`,
      },
      {
        question: "Does PDF to Excel upload my file?",
        answer: `Yes. The text is read by a native program a browser cannot run, so your PDF is uploaded over an encrypted connection to a secure server, which deletes it when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and a daily storage rule erases the stored workbook.`,
      },
      {
        question: "How large can my PDF be?",
        answer: `Up to ${ceilingMb("pdf-to-excel")} MB, one PDF per run.`,
      },
    ],
    published: "2026-10-29",
    updated: "2026-10-30",
  },
  {
    slug: "how-to-convert-pdf-to-powerpoint",
    title: "How to convert a PDF to PowerPoint",
    description:
      "Turn each PDF page into a slide in a .pptx file, with pictures where the page shows them and each line of text in a text box. Runs on an auto-deleting server.",
    tools: ["pdf-to-powerpoint", "powerpoint-to-pdf", "ocr-pdf"],
    keywords: [
      "how to convert pdf to powerpoint",
      "pdf to powerpoint",
      "pdf to pptx",
      "pdf to slides",
      "turn a pdf into a presentation",
    ],
    intro: [
      `To convert a PDF to PowerPoint, open ${nameOf("pdf-to-powerpoint")}, add your PDF, press Export PPTX, and download the .pptx file. Each page becomes one slide, in page order, and the slides take the size and shape of the first page.`,
      "On each slide, a photo or screenshot from the page sits where the page shows it, as a picture of its own. Every line of selectable text becomes a text box at its place, in its size, weight and colour, set in a font matched to the PDF's. Lines, boxes, backgrounds and other drawing come across as pictures, stacked in the order the page paints them.",
      `${nameOf("pdf-to-powerpoint")} runs on a secure server rather than in your browser. Your PDF, up to ${ceilingMb("pdf-to-powerpoint")} MB, travels over an encrypted connection, and our server deletes it when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes.`,
    ],
    steps: [
      `Open the ${nameOf("pdf-to-powerpoint")} tool.`,
      `Drop one PDF on the box, or browse for it. Files up to ${ceilingMb("pdf-to-powerpoint")} MB are accepted, and Remove takes back a wrong pick.`,
      "Press Export PPTX. Your PDF uploads over an encrypted connection to our secure server, and the button follows the job while the slides are assembled.",
      `When “Your PPTX file is ready.” appears, press Download. The link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, so save the file right away.`,
      "Open the .pptx and check it against the PDF, which is the reference for fonts and drawing.",
    ],
    sections: [
      {
        id: "what-each-slide-holds",
        heading: "What each slide holds",
        body: [
          "Pictures arrive as separate pictures where the page shows them, cut to the shape the page shows them through. Each line of text is its own text box, so a paragraph wrapped over five lines arrives as five boxes, and a page set in two columns keeps its columns apart.",
          "Fonts are matched, not copied. A font that comes with Windows or Office keeps its name; others become a close standard font by style, so a line can run a little longer or shorter than on the page. Lines, boxes and backgrounds are pictures, not shapes, and links do not come across.",
          "A page whose drawing is too intricate to stack in order becomes one picture of the page, with its text in invisible text boxes over it: you can select and search that text, but not see or restyle it.",
        ],
      },
      {
        id: "scanned-pages",
        heading: "Scanned pages",
        body: [
          `A scanned page holds a picture of its words, so its slide carries the page as a picture and those words are not text. Run ${nameOf("ocr-pdf")} on the scan first and convert the result: its slides then also carry the recognised words, in invisible text boxes over each picture. The note beside the download names any pages that had no selectable text.`,
        ],
      },
      {
        id: "what-has-been-checked",
        heading: "What has been checked",
        body: [
          "Decks made by this tool's export code were opened read-only by PowerPoint for Windows and saved back to PDF, and every page matched its source closely. Opening a downloaded file with a double-click and editing the slides have not been tested, so keep the PDF beside you as the reference while you work on the deck.",
          `Going the other way, ${nameOf("powerpoint-to-pdf")} turns a .pptx or .ppt into a PDF, one slide per page, on the same kind of secure server.`,
        ],
      },
    ],
    faq: [
      {
        question: "Will the slides look like my PDF?",
        answer:
          "Closely, in layout and pictures: each picture sits where the page shows it and each line of text is a text box at its place. Fonts are matched rather than copied, so a line can come out a little wider or narrower, and lines, boxes and backgrounds arrive as pictures rather than shapes.",
      },
      {
        question: "What happens to a scanned PDF?",
        answer: `It is converted, as pictures: each scanned page lands on its slide as a picture, and its words are not text. Run ${nameOf("ocr-pdf")} first and convert the OCR'd copy to have the recognised words in invisible text boxes over each picture.`,
      },
      {
        question: "Why is a paragraph split into separate text boxes?",
        answer:
          "Each line of the PDF becomes its own text box, placed where that line sits. That keeps the page's look, including columns, but it means a wrapped paragraph arrives as one box per line.",
      },
      {
        question: "Does the conversion upload my PDF?",
        answer: `Yes. Your PDF is uploaded over an encrypted connection to a secure server, which deletes it when the job finishes. The .pptx can be fetched for ${DEFAULT_RETENTION.outputTtlMinutes} minutes; after that the link no longer works, and a daily storage rule erases the stored copy.`,
      },
      {
        question: "Can I convert a password-protected PDF?",
        answer: `Not while it asks for a password to open: the job stops with a message and a link to ${nameOf("unlock-pdf")}. Remove the password there with the password you know, then convert the unlocked copy.`,
      },
    ],
    published: "2026-10-29",
    updated: "2026-10-30",
  },
  {
    slug: "how-to-convert-word-to-pdf",
    title: "How to convert a Word document to PDF",
    description:
      "Convert a .docx or .doc file to PDF with LibreOffice on a secure server that deletes your file after the job. Excel and PowerPoint files convert the same way.",
    tools: ["word-to-pdf", "excel-to-pdf", "powerpoint-to-pdf"],
    keywords: [
      "how to convert word to pdf",
      "word to pdf",
      "docx to pdf",
      "doc to pdf",
      "save word as pdf",
      "excel to pdf",
      "powerpoint to pdf",
    ],
    intro: [
      `To convert a Word document to PDF, open ${nameOf("word-to-pdf")}, add your .docx or .doc file, press Convert to PDF, and download the result. The PDF is named after your file, and its typed text stays text you can search, select and copy.`,
      "The pages are laid out by LibreOffice, not by Microsoft Word, following the page size, margins, headers and footers set in the document. A font our server lacks is replaced by a stand-in, which can move a line or page break, so check the pages before you send them.",
      `${nameOf("word-to-pdf")} runs on a secure server. Your document, up to ${ceilingMb("word-to-pdf")} MB, travels over an encrypted connection and is deleted when the job ends; the download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes. Spreadsheets and presentations go through ${nameOf("excel-to-pdf")} and ${nameOf("powerpoint-to-pdf")} the same way.`,
    ],
    steps: [
      `Open the ${nameOf("word-to-pdf")} tool.`,
      "Drag your .docx or .doc onto the box that says “Add your document, or browse”, or click it to choose the file. Remove swaps it for another.",
      "Press Convert to PDF. The document uploads over an encrypted connection, and the button follows the job while LibreOffice converts it.",
      `When “Your PDF is ready.” appears, press Download. The link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, so save the PDF before you close the tab.`,
      "Open the PDF and look for moved page breaks, a changed font or a shifted image before you send it.",
    ],
    sections: [
      {
        id: "how-it-is-laid-out",
        heading: "How the PDF is laid out",
        body: [
          "LibreOffice reads Word's formats, but it is not Microsoft Word, so differences tend to show in fonts and floating objects. A font the document names that our server does not have is replaced by a substitute whose letter widths may differ, which can push the last lines of a page onto the next; text boxes and wrapped images may land slightly elsewhere.",
          "Documents built with styles, tables and pictures set in line with text give it the least to reinterpret. If something drifted, fix it in the Word file, for example by setting a floating image in line with text, and convert again.",
        ],
      },
      {
        id: "excel-and-powerpoint",
        heading: "Excel and PowerPoint files",
        body: [
          `${nameOf("excel-to-pdf")} takes an Excel workbook or a CSV file and has LibreOffice print it to PDF. There is no sheet picker and no layout setting on the page, so set landscape and fit-to-page scaling in your spreadsheet app before converting if the columns split across pages.`,
          `${nameOf("powerpoint-to-pdf")} takes a .pptx or .ppt and writes one slide per page. Speaker notes and slides marked hidden are not exported, so unhide any slide you want in the PDF first.`,
        ],
      },
      {
        id: "files-and-limits",
        heading: "Accepted files and limits",
        body: [
          `${nameOf("word-to-pdf")} accepts Word's .docx and the older .doc format, one document per conversion, up to ${ceilingMb("word-to-pdf")} MB. Other formats, such as .odt, .rtf or .pages, are turned away rather than guessed at.`,
          "A file that needs a password to open cannot be converted, because the page has no password field. Remove the password in Word, save a copy, and convert the copy.",
        ],
      },
    ],
    faq: [
      {
        question: "Why do the page breaks differ from what Word shows me?",
        answer:
          "Because LibreOffice, not Microsoft Word, decides where each line and page ends. If the document names a font our server does not have, a substitute is used, and a slightly wider one can push lines onto the next page. Typed text stays selectable either way.",
      },
      {
        question: "Does Word to PDF upload my document?",
        answer: `Yes. Your file is uploaded over an encrypted connection to a secure server, which deletes it once the conversion job is finished. The PDF's download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and a daily storage rule erases the stored copy.`,
      },
      {
        question: "Which file types can I convert?",
        answer: `${nameOf("word-to-pdf")} takes .docx and .doc. ${nameOf("excel-to-pdf")} takes Excel workbooks and CSV files, and ${nameOf("powerpoint-to-pdf")} takes .pptx and .ppt.`,
      },
      {
        question: "How big can the document be?",
        answer: `Up to ${ceilingMb("word-to-pdf")} MB, one document per conversion. For a batch, convert one file, press Remove, and add the next.`,
      },
      {
        question: "Can I convert a password-protected Word file?",
        answer:
          "No. The page passes no password to LibreOffice, so a file that needs one to open fails with an error. Clear the password in Word, save a copy, and convert that.",
      },
    ],
    published: "2026-10-29",
    updated: "2026-10-30",
  },
  {
    slug: "how-to-ocr-a-pdf-in-other-languages",
    title: `How to OCR a PDF in ${OCR_EXAMPLES.slice(0, 3).map(describeOcrLanguage).join(", ")} and other languages`,
    description: `OCR a scanned PDF in any of ${OCR_LANGUAGES.length} languages, including ${OCR_EXAMPLE_NAMES}, up to ${MAX_OCR_LANGUAGES} per job. Get a searchable PDF, text, or a Word file.`,
    tools: ["ocr-pdf", "pdf-to-word"],
    keywords: [
      "ocr pdf in other languages",
      "bengali ocr pdf",
      "hindi ocr pdf",
      "arabic ocr pdf",
      "tamil ocr",
      "multilingual ocr",
      "ocr non english pdf",
    ],
    intro: [
      `To OCR a PDF in a language other than English, open ${nameOf("ocr-pdf")}, select every language printed on the page under Languages, add your scan, and press Recognize text. ${OCR_LANGUAGES.length} languages are offered, including ${OCR_EXAMPLE_NAMES}, and one job can combine up to ${MAX_OCR_LANGUAGES}.`,
      `Choosing the language is the step that decides the result. ${describeOcrLanguage(DEFAULT_OCR_LANGUAGE)} is selected when the page opens, and a page read in the wrong language does not fail: the engine returns fluent-looking nonsense in the alphabet it was given, with no error.`,
      `${nameOf("ocr-pdf")} runs on a secure server. Your scan, up to ${ceilingMb("ocr-pdf")} MB, travels over an encrypted connection and is deleted when the job finishes, and the download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes.`,
    ],
    steps: [
      `Open the ${nameOf("ocr-pdf")} tool.`,
      `Under Languages, select every language the document uses, up to ${MAX_OCR_LANGUAGES}. ${describeOcrLanguage(DEFAULT_OCR_LANGUAGE)} starts selected; deselect it if the page has none.`,
      `Under Output, choose ${ocrModeLabel("searchable-pdf")}, ${ocrModeLabel("text")} for a .txt file, or ${ocrModeLabel("both")}.`,
      "Drop one PDF, JPG or PNG into the Add a scan to OCR area and press Recognize text. The file uploads over an encrypted connection only when you press it.",
      `Download the result. The link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, so save it right away.`,
      "Search the PDF or read the text to check it. If it looks like gibberish, change the language selection and run the job again.",
    ],
    sections: [
      {
        id: "the-language-list",
        heading: "The languages on offer",
        body: [
          `The menu offers ${OCR_LANGUAGES.length} languages: ${OCR_LANGUAGE_NAMES}. The job API accepts only languages on this list and refuses any other rather than guessing.`,
          `If our server ever lacks the pack for a language you selected, the job stops before recognition starts and the error names that language, rather than blaming your file.`,
        ],
      },
      {
        id: "mixed-languages",
        heading: "Documents in more than one language",
        body: [
          `A form printed in ${describeOcrLanguage("ben")} with English headings, or a ${describeOcrLanguage("hin")} letter with an English address block, needs every language on the page selected. Up to ${MAX_OCR_LANGUAGES} can be combined in one job; to swap one out at the limit, deselect a language first.`,
          "Select only the languages that are really there: each one you add is more recognition work for the job.",
        ],
      },
      {
        id: "straight-to-word",
        heading: "Straight to an editable Word document",
        body: [
          `${nameOf("pdf-to-word")} can run the OCR in the same job: tick “${WORD_OCR_LABEL}”, pick the languages, and our server recognises the scan first and converts the result into a DOCX. Its picker offers ${PDF_TO_WORD_OCR_LANGUAGE_CODES.length} of the ${OCR_LANGUAGES.length} languages.`,
          `${RTL_OCR_NAMES} are not offered for ${nameOf("pdf-to-word")}'s OCR: written right to left, their recognised words come out of the conversion out of order. ${nameOf("ocr-pdf")} reads them in order, so for those languages use ${nameOf("ocr-pdf")} and take its searchable PDF or its text.`,
        ],
      },
    ],
    faq: [
      {
        question: "Which languages can the OCR read?",
        answer: `${OCR_LANGUAGES.length}: ${OCR_LANGUAGE_NAMES}. Up to ${MAX_OCR_LANGUAGES} can be combined in one job.`,
      },
      {
        question: "Why does my OCR result look like gibberish?",
        answer: `Usually the selected language does not match the page. ${describeOcrLanguage("ben")} read as English, for example, comes back as Latin letters that look plausible and mean nothing, with no error. Select the language the page is printed in and run the job again; a blurry, skewed or sideways scan causes the same symptom.`,
      },
      {
        question: `Can I OCR ${listOr(RTL_OCR_LANGUAGES.map(describeOcrLanguage))}?`,
        answer: `Yes, with ${nameOf("ocr-pdf")}, which reads them in order in its searchable PDF and its text. ${RTL_OCR_NAMES} are not offered for ${nameOf("pdf-to-word")}'s OCR, because their recognised words come out of that conversion out of order.`,
      },
      {
        question: "Can I turn a scan straight into an editable Word document?",
        answer: `Yes, for ${PDF_TO_WORD_OCR_LANGUAGE_CODES.length} of the ${OCR_LANGUAGES.length} languages. In ${nameOf("pdf-to-word")}, tick “${WORD_OCR_LABEL}” and pick the languages; our server recognises the text first and converts the result in the same job.`,
      },
      {
        question: "Is my scan uploaded?",
        answer: `Yes. Recognition needs a native OCR engine, so your file is uploaded over an encrypted connection to a secure server, which deletes the input when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and a daily storage rule erases the stored result.`,
      },
    ],
    published: "2026-10-29",
    updated: "2026-10-30",
  },
  {
    slug: "how-to-convert-a-webpage-to-pdf",
    title: "How to save a web page as a PDF",
    description:
      "Paste a public link and get the page as a PDF with selectable text, rendered by Chromium on a secure server. Choose page size, margins or one long page.",
    tools: ["webpage-to-pdf", "html-to-pdf"],
    keywords: [
      "how to convert a webpage to pdf",
      "webpage to pdf",
      "url to pdf",
      "save web page as pdf",
      "website to pdf",
      "html file to pdf",
    ],
    intro: [
      `To save a web page as a PDF, open ${nameOf("webpage-to-pdf")}, paste the page's full address, choose a page layout if you want one, and press Render PDF. A copy of Chromium, the engine behind Chrome and Edge, loads the page, lets its scripts run, and prints it to a PDF whose text you can search and copy.`,
      `The page is fetched by pdf.xyz's secure server, not by your browser. The job carries only the address you typed, sent over an encrypted connection, and the site sees a signed-out visitor with none of your cookies, so members-only pages and paywalls come out as a stranger would see them.`,
      `For an HTML file on your computer rather than a live address, ${nameOf("html-to-pdf")} renders it with the same engine and the same layout options. Either way, the download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes.`,
    ],
    steps: [
      `Open the ${nameOf("webpage-to-pdf")} tool.`,
      "Select everything in the address field, which starts with https://, and paste the full link from your browser's address bar over it. Only http and https links are accepted.",
      HTML_LAYOUT_STEP.body,
      "Press Render PDF. The address is uploaded to our secure server over an encrypted connection, and Chromium opens and prints the page.",
      `When “Your PDF is ready.” appears, press Download. The link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, so save the PDF right away.`,
    ],
    sections: [
      {
        id: "page-layout",
        heading: "Page size, margins, screen width and one long page",
        body: [
          htmlLayoutAnswer("site"),
          "One long page suits a long article or a receipt you want to scroll through without page breaks; a screen width suits a site whose print layout hides things you want, because it lays the page out as on that screen and scales it to fit the paper.",
        ],
      },
      {
        id: "what-gets-printed",
        heading: "What ends up in the PDF",
        body: [
          "The PDF carries the page and nothing else: pdf.xyz adds no date, title, address or page-number lines. Backgrounds are printed, and a site that ships a print stylesheet gets that layout. Words a site draws as a picture or on a canvas stay pictures.",
          "Nothing scrolls the page, and its scripts run within a fixed budget of time, so an endless feed prints only what it loads unscrolled, and images that load only as you scroll can be missing. Cookie notices and adverts shown to a new visitor can appear too.",
        ],
      },
      {
        id: "html-files",
        heading: "Converting an HTML file instead",
        body: [
          `${nameOf("html-to-pdf")} takes one .html or .htm file instead of an address. Drag it onto the drop zone, set the same Page layout options, and press Render PDF; the PDF is named after your file. Leave Page size on its default and a CSS @page rule in your file decides the paper.`,
        ],
      },
    ],
    faq: [
      {
        question: "Can I convert a members-only or paywalled page?",
        answer:
          "No. Our server receives only the address, never your cookies, so a members-only or paywalled page comes out as the screen a signed-out stranger gets, or as an error. For those, open the page yourself and use your browser's Print dialog with Save as PDF.",
      },
      {
        question: "Can I choose the page size, margins or orientation?",
        answer: htmlLayoutAnswer("site"),
      },
      {
        question: "Is the text in the PDF selectable?",
        answer:
          "Yes. It is a printed PDF, not a screenshot, so words can be selected, copied and found with Ctrl+F. Words a site draws as a picture or on a canvas stay pictures.",
      },
      {
        question: "Why was my address refused?",
        answer: `It must begin with http:// or https://. Addresses on your own computer or a private network, such as ${listOr(PRIVATE_ADDRESS_EXAMPLES)}, are refused, and while rendering our server fetches only public addresses, so a link that leads into a private network ends with an error instead of a PDF.`,
      },
      {
        question: "How do I convert an HTML file on my computer?",
        answer: `Use ${nameOf("html-to-pdf")}: drop one .html or .htm file, choose the layout, and press Render PDF. It runs on the same secure server, which deletes your file when the job finishes.`,
      },
    ],
    published: "2026-10-29",
    updated: "2026-10-30",
  },
  {
    slug: "how-to-extract-images-from-a-pdf",
    title: "How to extract images from a PDF",
    description:
      "Save the pictures embedded in a PDF at their original resolution, JPEGs byte for byte and other images as lossless PNGs, right in your browser.",
    tools: ["extract-images", "pdf-to-jpg", "pdf-to-png"],
    keywords: [
      "how to extract images from a pdf",
      "extract images from pdf",
      "save pictures from pdf",
      "get images out of a pdf",
      "pdf image extractor",
    ],
    intro: [
      `To extract the images from a PDF, open ${nameOf("extract-images")}, add your file, and press Extract images. Each picture embedded in the PDF comes back as its own file at its stored resolution, with no page, text or margin around it. When more than one is found, you can download them one at a time or all together as a ZIP.`,
      "The tool reads the PDF's image objects directly instead of photographing the page. JPEG images are written out byte for byte, so nothing is compressed a second time, and raw RGB, grayscale and black-and-white images are rebuilt as lossless PNGs at their native size.",
      `It runs in your browser, so your PDF stays on your device and no account is needed. Files up to ${ceilingMb("extract-images")} MB are accepted.`,
    ],
    steps: [
      `Open the ${nameOf("extract-images")} tool and drop your PDF where it says Drop your PDF here, or click browse. It stays on your device.`,
      "Press Extract images. The button reads Scanning for images… while each page's images are read in your browser.",
      "Review the grid: each preview shows the image's width, height and format, and a skipped box lists any images that could not be extracted, with the reason.",
      "When more than one image was found, press Download ZIP for all of them in one archive, or use a preview's own button for a single image; with only one, press Download image.",
    ],
    sections: [
      {
        id: "what-comes-out",
        heading: "What you get for each image",
        body: [
          "JPEG images, CMYK JPEGs included, are saved as .jpg files exactly as the PDF stored them. RGB and grayscale images, black-and-white images and palette images over RGB or gray become lossless PNGs at native size. A picture reused on several pages is saved once, and each file's name gives its page and its order on that page, so the files list in page order.",
          "When a PDF stores transparency as a mask beside a picture, that mask becomes the PNG's transparency, so a cut-out logo comes out cut out. A JPEG cannot carry a mask, so a masked JPEG comes out on a solid background.",
        ],
      },
      {
        id: "skipped-images",
        heading: "Images it skips",
        body: [
          "Some kinds of image are not recovered yet, among them JPEG 2000, fax-style bitmaps, CMYK pixel images and images written inline in a page's drawing instructions. Each is counted under its reason in the skipped list rather than guessed at.",
          `Images used as fill patterns or inside annotations are not scanned. When a picture is skipped, or when you need the whole page as an image, ${nameOf("pdf-to-jpg")} and ${nameOf("pdf-to-png")} render pages instead.`,
        ],
      },
      {
        id: "quality",
        heading: "Quality and what the page did to the picture",
        body: [
          "The pixels are the ones the PDF holds. If the author shrank a photo before making the PDF, that smaller version is all the file has. The page's drawing instructions are not applied either: an image the page crops, rotates or flips is saved whole, in the orientation it was stored, and a colour profile the PDF assigns is not written into the saved file.",
        ],
      },
    ],
    faq: [
      {
        question: "Will the extracted images keep their original quality?",
        answer:
          "The pixels do. JPEGs are copied byte for byte, and RGB or grayscale images become lossless PNGs at native size. If the author shrank an image before making the PDF, that smaller version is all the file holds.",
      },
      {
        question:
          "What is the difference between Extract Images and PDF to JPG?",
        answer: `${nameOf("extract-images")} saves the pictures embedded in the PDF as they were stored, with no page around them. ${nameOf("pdf-to-jpg")} and ${nameOf("pdf-to-png")} render whole pages, text and all, as images.`,
      },
      {
        question: "Why were no images found?",
        answer:
          "The pages may hold only text and vector drawings, which are not images. Images used as fill patterns or inside annotations are not scanned, and images written inline in a page's drawing instructions are listed as skipped.",
      },
      {
        question: "Does my PDF leave my device?",
        answer: `No. The file is read and the images are rebuilt in your browser, and when there is more than one, the ZIP is assembled there too. The whole PDF is held in your browser's memory while you work, which is why a file over ${ceilingMb("extract-images")} MB is turned away.`,
      },
      {
        question: "Can I extract images from a password-protected PDF?",
        answer: `Not while it is encrypted: any encryption makes the file fail to open here, even when it only limits printing or copying. ${nameOf("unlock-pdf")} can remove the encryption with a password you know; it runs on a secure server, not in your browser.`,
      },
    ],
    published: "2026-10-29",
    updated: "2026-10-30",
  },
  {
    slug: "how-to-reorder-pages-in-a-pdf",
    title: "How to reorder pages in a PDF",
    description:
      "Drag PDF pages into a new order, turn, copy or delete them, and add blank pages, right in your browser. Undo any step. No account needed.",
    tools: ["organize-pages", "edit-pdf", "rotate-pdf"],
    keywords: [
      "how to reorder pages in a pdf",
      "rearrange pdf pages",
      "reorder pdf pages",
      "move pages in a pdf",
      "change page order in pdf",
    ],
    intro: [
      `To reorder the pages of a PDF, open ${nameOf("organize-pages")}, add your file, and drag the page tiles into the order you want. Press Apply & export, then Download organized PDF.`,
      "Every page appears as a thumbnail tile on a board. Besides dragging, each tile has buttons to move it one place, turn it a quarter turn clockwise, duplicate it, delete it, or insert a blank page before or after it. Above the board, Reverse flips the whole order and Reset brings back the order the file arrived with.",
      `It runs in your browser tab, so your PDF stays on your device; files up to ${ceilingMb("organize-pages")} MB open, and Undo walks back up to ${MAX_HISTORY} edits. If you are already editing the file in ${nameOf("edit-pdf")}, its page list can reorder pages too.`,
    ],
    steps: [
      `Open the ${nameOf("organize-pages")} tool and drop your PDF onto the box, or click it to choose the file. It stays on your device.`,
      "Drag a tile to its new place, or use its arrow buttons to move it one place at a time.",
      "Use the buttons on a tile to turn it, duplicate it, delete it, or insert a blank page before or after it. Reverse flips the whole order.",
      "Each tile shows its new position and its original page number, so check what moved. Undo and Redo step through your edits.",
      "Press Apply & export, then Download organized PDF. The copy is named after yours, with -organized added.",
    ],
    sections: [
      {
        id: "the-board",
        heading: "Working on the page board",
        body: [
          "Each tile carries two numbers: a corner badge for its new position and a label for its original page, so you can see at a glance what moved. By keyboard, focus a tile's handle, press Enter or Space to grab it, move it with the arrow keys, Home or End, and press Enter or Space again to drop it.",
          "An inserted blank page shows as a plain white tile labelled Blank page and takes the size and orientation of the page beside it, which is handy when the next chapter should start on a right-hand page in two-sided printing. The delete button is disabled on the last page left from your PDF, since the export needs at least one.",
        ],
      },
      {
        id: "what-the-export-keeps",
        heading: "What the reordered file keeps",
        body: [
          `Each page is copied across, not re-rendered, so its content is untouched and selectable text stays selectable. ${pageToolKeeps("subset", { inPlaceWhenOnlyTurned: true })}`,
        ],
      },
      {
        id: "in-the-editor",
        heading: "Reordering pages while you edit",
        body: [
          `${nameOf("edit-pdf")} has a page list of its own: beside the pages on a wide screen, or under Pages on a smaller one. Each thumbnail can be turned a quarter, followed by a new blank page, or deleted, and dragged or moved with its arrows into a new order. What you placed on a page moves with it, and each change can be undone.`,
          `When the only problem is pages on their side, ${nameOf("rotate-pdf")} turns the pages you pick, or the whole document, without touching the order.`,
        ],
      },
    ],
    faq: [
      {
        question: "Does reordering pages send my PDF to a server?",
        answer:
          "No. The reordered copy is assembled inside your browser tab, so the document stays on your device. Closing the tab before downloading discards the edit.",
      },
      {
        question: "Can I add a blank page between two pages?",
        answer:
          "Yes. Use Insert blank page before or Insert blank page after on the tile next to where it should go. The blank page takes that page's size and orientation.",
      },
      {
        question: "How do I reverse the page order?",
        answer:
          "Press Reverse above the board. It flips the whole order in one step, which suits a stack a scanner read last page first; Undo takes it back.",
      },
      {
        question: "Does the reordered PDF keep its bookmarks and form fields?",
        answer: pageToolKeepsAnswer("subset", { inPlaceWhenOnlyTurned: true }),
      },
      {
        question: "Can I reorder pages in the PDF editor?",
        answer: `Yes. In ${nameOf("edit-pdf")}, drag a thumbnail in the page list, or use its arrows, to move a page; anything you placed on that page moves with it.`,
      },
    ],
    published: "2026-10-29",
    updated: "2026-10-29",
  },
  {
    slug: "how-to-scan-documents-to-pdf-with-your-phone",
    title: "How to scan documents to PDF with your phone camera",
    description:
      "Photograph paper pages with your phone's camera and save them as one PDF, with a clean-up that makes the paper white. Made in your browser, no app needed.",
    tools: ["scan-to-pdf", "ocr-pdf", "jpg-to-pdf"],
    keywords: [
      "how to scan documents to pdf with phone",
      "scan to pdf",
      "phone camera to pdf",
      "scan paper to pdf without an app",
      "pdf scanner online",
      "turn photos of pages into a pdf",
    ],
    intro: [
      `To scan paper to a PDF with your phone, open ${nameOf("scan-to-pdf")} in your phone's browser and press Take photo. Your phone's camera opens; photograph the first page, then press the button again for each page after it. Choose a clean-up, press Create PDF, and download one PDF with a page for every photo.`,
      `There is no app to install. The button asks the browser for a photo the same way a page asks for any file, and your phone's own camera takes it. On a computer the same button opens the file picker, so you can also use photos you took earlier. Everything after that happens in your browser tab, so your photos stay on your device.`,
      `The clean-up is what makes a photo look like a scan: ${SCAN_DOCUMENT} turns a dim, grey photo of paper into white paper with dark text, and ${SCAN_BW} reduces it to pure black and white for the smallest file.`,
    ],
    steps: [
      `Open the ${nameOf("scan-to-pdf")} tool on your phone and press Take photo. Lay the page flat in good light and fill the frame with it before you take the picture.`,
      "Press Take photo of the next page for each page after the first. To use photos you already have, drop JPG or PNG files where it says Drop photos here, or click browse.",
      "Check the Pages list. Each photo is a page with a preview; use its buttons to rotate it a quarter turn, move it up or down, or remove it.",
      `Under Clean-up choose ${SCAN_CLEANUPS}, and under Page size choose ${SCAN_SIZES}. The previews change to match.`,
      "Press Create PDF, then Download PDF. The file is named scan- followed by today's date.",
    ],
    sections: [
      {
        id: "good-photos",
        heading: "Taking photos that scan well",
        body: [
          "The photo is used exactly as you framed it. The tool does not find the edges of the page, crop away the table around it or straighten a page shot at an angle, so the framing is yours to get right: lay the page on a flat surface, hold the phone straight above it, and let the page fill the frame. Daylight from a window works well; stand so your own shadow does not fall across the paper.",
          "Phones record which way up each photo was taken, and the tool uses that to turn every page upright. Some apps drop that note when they save or share a picture, so if a preview still shows a page on its side, press its rotate button until it reads the right way up.",
        ],
      },
      {
        id: "clean-up",
        heading: `${SCAN_ORIGINAL}, ${SCAN_DOCUMENT} or ${SCAN_BW}`,
        body: [
          `${SCAN_ORIGINAL} keeps the photo's colours, which suits a page with a coloured stamp, a photo or highlighter you need to see. ${SCAN_DOCUMENT} is the starting choice: it makes the page grayscale and stretches the contrast, so off-white paper becomes white and faint print becomes dark, while keeping the grey tones of a pencil note or a signature.`,
          `${SCAN_BW} turns every pixel pure black or pure white and gives the smallest file, which makes it the best choice for typed text. Each pixel is compared with the brightness of the area around it rather than with one fixed level, so a shadow across one corner of the paper still reads as paper instead of turning black.`,
        ],
      },
      {
        id: "page-size",
        heading: "Page size and sharpness",
        body: [
          `On ${SCAN_FIXED_SIZES} each photo is scaled to fit the page, centred, with its proportions kept and no margin added, and the page turns landscape for a wide photo. ${SCAN_FIT} gives each page the photo's own shape instead.`,
          `Each photo is scaled so its long side is at most ${SCAN_LONG_SIDE} pixels before it is saved. That is sharp enough to read and print a full page, and it keeps a many-page scan small enough to send by email. Photos up to ${ceilingMb("scan-to-pdf")} MB each are accepted.`,
        ],
      },
      {
        id: "other-tools",
        heading: "When another tool is the better fit",
        body: [
          `The pages of the PDF are pictures, so their text cannot be searched or copied. To add a searchable text layer, run the finished PDF through ${nameOf("ocr-pdf")}; unlike this tool, it runs on pdf.xyz's secure server.`,
          `If you are turning ordinary photos into a PDF rather than scanning paper, such as holiday pictures or screenshots, ${nameOf("jpg-to-pdf")} keeps them as they are and lets you choose a margin around each one, where this tool fills the page and cleans up the light.`,
        ],
      },
    ],
    faq: [
      {
        question: "Do I need to install a scanner app?",
        answer:
          "No. The tool runs in your phone's web browser. Take photo opens the phone's own camera, and the PDF is made in the browser tab, so there is nothing to install and no account to make.",
      },
      {
        question: "Are my photos sent to a server?",
        answer:
          "No. The photos are read, cleaned up and saved into the PDF inside your browser tab, and the download is made on your device. The page itself loads from pdf.xyz, but the pictures you take or pick are not sent to us.",
      },
      {
        question:
          "Does it straighten the page or crop the edges automatically?",
        answer: `No. There is no automatic edge detection, cropping or perspective correction: each photo is used as framed. Fill the frame with the page and hold the phone flat above it. To trim a margin afterwards, open the PDF in ${nameOf("crop-pdf")}.`,
      },
      {
        question: "Can I search or copy the text in the scanned PDF?",
        answer: `Not on its own, because each page is a picture. ${nameOf("ocr-pdf")} adds a searchable, selectable text layer; it runs on pdf.xyz's secure server rather than in your browser.`,
      },
      {
        question: "Which photos can I add?",
        answer: `JPG and PNG photos, up to ${ceilingMb("scan-to-pdf")} MB each. Another kind of image is turned away with a note to choose JPG or PNG photos.`,
      },
    ],
    published: "2026-10-30",
    updated: "2026-10-30",
  },
  {
    slug: "how-to-edit-pdf-metadata",
    title: "How to edit PDF metadata (title, author, keywords)",
    description:
      "See and change a PDF's title, author, subject, keywords and dates, or remove them all, XMP included, right in your browser. No account needed.",
    tools: ["edit-pdf-metadata", "redact-pdf", "unlock-pdf"],
    keywords: [
      "how to edit pdf metadata",
      "change pdf title",
      "change pdf author",
      "remove metadata from pdf",
      "pdf properties editor",
      "add keywords to pdf",
    ],
    intro: [
      `To edit a PDF's metadata, open ${nameOf("edit-pdf-metadata")}, add your file, and type over the values it shows: ${METADATA_TEXT_NAMES}, plus the ${METADATA_DATE_NAMES} dates. Press Save metadata and download the copy. To strip all of it before you share a file, choose Remove all metadata instead.`,
      "Metadata is the document information a PDF carries beside its pages. Many readers show the title in the window or tab instead of the file name, search tools index it, and anyone who opens the file's properties can read the author, which is often your name, filled in by the app that made the file.",
      `It runs in your browser, so your PDF stays on your device. It opens one file at a time, up to ${ceilingMb("edit-pdf-metadata")} MB, and the pages themselves are not changed.`,
    ],
    steps: [
      `Open the ${nameOf("edit-pdf-metadata")} tool and drop your PDF where it says Drop your PDF here, or click browse. It stays on your device.`,
      "Wait for the Document properties fields to fill in with what the file holds now. A field that reads Not set has no value.",
      `Type over any field, or empty it to remove that entry. ${METADATA_DATE_NAMES} take a date and time in your device's time zone.`,
      "To remove everything instead, switch What to do from Edit values to Remove all metadata.",
      "Press Save metadata, or Remove metadata when removing. Check the values read back from the saved copy, then press Download PDF; the copy's name ends in -metadata.",
    ],
    sections: [
      {
        id: "the-fields",
        heading: "What each field is for",
        body: [
          "Title is what many readers show in place of the file name, and the line a search engine may use for the file. Author names the person or company behind it. Subject is a one-line summary, and Keywords are words a desktop search or a document library can find the file by; separate them with commas.",
          "Creator is the app the document was made in, such as a word processor, and Producer is the program that wrote the PDF. Created and Modified are the dates the file states for itself. A scanned or converted file often carries the date it was converted rather than the date of the document, and you can correct either one.",
        ],
      },
      {
        id: "xmp",
        heading: "The second copy, XMP",
        body: [
          "Many PDFs keep the same information twice: once in the document information entries and again in an XMP packet, a block of XML that Acrobat and other readers prefer when it is there. A tool that changed only the first copy would leave those readers showing the old title.",
          "So when a file has XMP, a note beside Document properties says so, and saving replaces the packet with a fresh one holding the same values as the fields. Anything else the old packet held is not kept. A file with no XMP packet does not get one.",
        ],
      },
      {
        id: "remove-all",
        heading: "What Remove all metadata takes out, and what it leaves",
        body: [
          `Remove all metadata deletes the ${METADATA_TEXT_NAMES} entries, both dates, and the XMP packet. Every page is kept as it was.`,
          `It does not touch what is on the pages, or the comments, form fields, bookmarks and the metadata inside embedded images. If the private details are in the text or pictures on a page, use ${nameOf("redact-pdf")} to remove them from the page itself.`,
        ],
      },
      {
        id: "limits",
        heading: "Files it cannot change",
        body: [
          `An encrypted PDF cannot be opened here, even one that only limits printing or copying. ${nameOf("unlock-pdf")} can remove the encryption with a password you know; it runs on a secure server, not in your browser.`,
          "A PDF carrying a digital signature can be edited, but the copy is a changed file, so the signature in it will no longer verify. Keep the signed original if the signature matters.",
        ],
      },
    ],
    faq: [
      {
        question: "How do I change the title of a PDF?",
        answer:
          "Open the file, type the new title into the Title field, press Save metadata and download the copy. The file name is a separate thing: rename the downloaded file in your folder if you want that changed too.",
      },
      {
        question: "Why does my PDF reader still show the old title?",
        answer:
          "Make sure you opened the downloaded copy, not the original. Some readers show the file name rather than the title unless the PDF asks them to, and a reader may remember what it showed last time. When the file had XMP metadata, the copy's XMP holds the new title too.",
      },
      {
        question: "How do I remove my name from a PDF before sharing it?",
        answer:
          "Empty the Author field and save, or choose Remove all metadata to clear every entry at once. A name typed on the pages themselves is not metadata; it stays until you remove it from the page.",
      },
      {
        question: "Is my PDF sent to a server to change its metadata?",
        answer:
          "No. The file is opened, changed and saved in your browser tab. The page loads from pdf.xyz, but the PDF you pick is not sent to us.",
      },
      {
        question: "Can I type a title in any language?",
        answer:
          "Yes. The values are stored as Unicode, so Bengali, Chinese, Arabic or any other script is saved exactly as typed and read back by other PDF readers.",
      },
    ],
    published: "2026-10-30",
    updated: "2026-10-30",
  },
  {
    slug: "how-to-resize-pdf-pages",
    title: "How to resize PDF pages to A4 or Letter",
    description: `Change a PDF's pages to ${RESIZE_SIZE_NAMES} or a custom size, scaling the content to fit or changing only the canvas. Runs in your browser.`,
    tools: ["resize-pdf", "crop-pdf", "n-up-pdf"],
    keywords: [
      "how to resize pdf pages",
      "resize pdf to a4",
      "convert letter pdf to a4",
      "change pdf page size",
      "scale pdf to fit a4",
      "a4 to letter pdf",
    ],
    intro: [
      `To resize the pages of a PDF, open ${nameOf("resize-pdf")}, add your file, and pick the new page size: ${RESIZE_SIZE_NAMES}, or a custom width and height. Choose ${RESIZE_FIT} so nothing is cut off, press Resize PDF, and download the copy.`,
      `The usual reason is paper. A document laid out on ${RESIZE_LETTER} has to print on ${RESIZE_A4} in most of the world, or the other way round, and a printer left to sort it out may cut the edges off or shrink the page by its own rules. Resizing the file settles the size once, for every printer and reader.`,
      `It runs in your browser, so your PDF stays on your device. It opens one file at a time, up to ${ceilingMb("resize-pdf")} MB.`,
    ],
    steps: [
      `Open the ${nameOf("resize-pdf")} tool and drop your PDF where it says Drop your PDF here, or click browse. It stays on your device.`,
      `Under New page size, pick ${RESIZE_SIZE_NAMES}, or pick Custom and type a Width and Height in ${RESIZE_UNITS}.`,
      `Under Orientation, keep ${RESIZE_MATCH} so each page stays portrait or landscape as it was, or choose ${RESIZE_FIXED_ORIENTATIONS} for every page.`,
      `Under How to resize, choose ${RESIZE_FIT} or ${RESIZE_CANVAS}.`,
      "Under Pages, keep All pages, or choose Selected pages and type a list such as 1-3, 5.",
      "Press Resize PDF, then Download resized PDF. The copy is named after yours, with -resized added.",
    ],
    sections: [
      {
        id: "two-ways",
        heading: "Scale the content, or change only the canvas",
        body: [
          `${RESIZE_FIT} gives each page the new size and scales what is on it, up or down, to fit inside, centred and with its proportions kept, so nothing is cut off and nothing is stretched. When the old and new shapes differ, a blank band appears at two opposite edges.`,
          `${RESIZE_CANVAS} keeps the content at the size it was and moves the page edges around it, centred. A bigger size adds blank margin, which leaves room for binding, hole punching or notes. A smaller size hides whatever falls outside the new edges; it is hidden, not deleted, much as ${nameOf("crop-pdf")} hides it.`,
        ],
      },
      {
        id: "letter-and-a4",
        heading: `${RESIZE_LETTER} to ${RESIZE_A4}, and back`,
        body: [
          `${RESIZE_A4} is a little narrower and taller than ${RESIZE_LETTER}. Scaled to fit, a ${RESIZE_LETTER} page shrinks slightly to the new width and gains a thin blank band at the top and bottom; an ${RESIZE_A4} page made ${RESIZE_LETTER} shrinks to the new height and gains bands at the left and right. Either way every line stays on the page.`,
          `A page that a reader shows turned, such as one rotated in ${nameOf("rotate-pdf")}, gets the new size the way it is shown, so a landscape page becomes a landscape ${RESIZE_A4} page with ${RESIZE_MATCH}. A custom size can be anything from ${RESIZE_MIN_IN} to ${RESIZE_MAX_IN} inches on each side.`,
        ],
      },
      {
        id: "what-it-keeps",
        heading: "What resizing keeps",
        body: [
          `Text stays text and images are not re-compressed: the page's own drawing is kept and only drawn at a different size, so nothing turns blurry. With ${RESIZE_FIT}, links, comments and form fields move and scale with the content, so they stay on the words they belong to.`,
          `If what you want is a smaller file rather than a smaller page, use ${nameOf("compress-pdf")}. To fit several pages onto one sheet of paper, use ${nameOf("n-up-pdf")}; to trim white margins off the pages, use ${nameOf("crop-pdf")}.`,
        ],
      },
    ],
    faq: [
      {
        question: "How do I change a PDF from Letter to A4?",
        answer: `Open the file, pick ${RESIZE_A4} under New page size, keep ${RESIZE_MATCH} and ${RESIZE_FIT}, and press Resize PDF. The content shrinks slightly to fit the narrower page, so nothing is cut off when it prints.`,
      },
      {
        question: "Will resizing cut off the edges of my pages?",
        answer: `Not with ${RESIZE_FIT}: the content is scaled to fit inside the new page. With ${RESIZE_CANVAS} and a smaller size, what falls outside the new edges is hidden, though it is still in the file.`,
      },
      {
        question: "Will the text get blurry?",
        answer:
          "No. Text and drawings stay sharp and images are not re-encoded; the page is only drawn at a different size, the way a printer's fit-to-page setting does it. Scaling a page down does make small text smaller.",
      },
      {
        question: "Can I resize only some pages?",
        answer:
          "Yes. Under Pages choose Selected pages and type the pages, such as 2, 4-6. The pages you leave out keep their size, so the copy can mix sizes.",
      },
      {
        question: "Is my PDF sent to a server to resize it?",
        answer:
          "No. The pages are resized in your browser tab and the copy is saved on your device; the PDF is not sent to pdf.xyz.",
      },
    ],
    published: "2026-10-30",
    updated: "2026-10-30",
  },
  {
    slug: "how-to-print-multiple-pages-per-sheet",
    title: `How to print multiple pages per sheet (${upName(2)}, ${upName(4)})`,
    description: `Put ${N_UP_COUNT_NAMES} PDF pages on each ${N_UP_SHEET_NAMES} sheet, in the order you pick, with margins and optional borders. Runs in your browser.`,
    tools: ["n-up-pdf", "resize-pdf", "organize-pages"],
    keywords: [
      "how to print multiple pages per sheet",
      "multiple pages per sheet pdf",
      "2 pages per sheet pdf",
      "4 pages per sheet",
      "n-up pdf",
      "print slides as handouts",
    ],
    intro: [
      `To put several pages of a PDF on one sheet, open ${nameOf("n-up-pdf")}, add your file, and choose ${N_UP_COUNT_NAMES} per sheet. Press Create sheets and download a new PDF whose every page holds that many of the original pages, shrunk to fit.`,
      "It does what a print dialog's pages-per-sheet setting does, but saves the result as a file. You can check it on screen before printing, send it to someone else to print, or print it on a printer whose settings you cannot find; print it at one page per sheet, since the pages are already laid out.",
      `It runs in your browser, so your PDF stays on your device. It opens one file at a time, up to ${ceilingMb("n-up-pdf")} MB.`,
    ],
    steps: [
      `Open the ${nameOf("n-up-pdf")} tool and drop your PDF where it says Drop your PDF here, or click browse. It stays on your device.`,
      `Under Pages per sheet, choose ${N_UP_COUNT_NAMES} per sheet. Beside the heading, the tool shows how many sheets that makes.`,
      `Under Sheet size choose ${N_UP_SHEET_NAMES}, and under Orientation keep ${N_UP_AUTO} or choose ${N_UP_FIXED_ORIENTATIONS}.`,
      `Under Order choose ${N_UP_ORDER_NAMES}, and under Margin choose ${N_UP_MARGIN_NAMES}. Tick Draw a thin border around each page for an outline you can cut along.`,
      `Press Create sheets, then Download PDF. The copy is named after yours, with the count added, such as -${upName(4)}.`,
    ],
    sections: [
      {
        id: "layout",
        heading: "How the pages are laid out",
        body: [
          `${N_UP_AUTO} picks portrait or landscape, whichever draws the first page largest: two portrait pages sit side by side on a landscape sheet, and four fill a portrait sheet in a grid. Each page is scaled to fit its place with its proportions kept, so a landscape page among portrait ones is simply drawn smaller.`,
          `${N_UP_ACROSS} fills each row from left to right and then moves down, the way you read. ${N_UP_DOWN} fills each column from top to bottom and then moves right, like newspaper columns. When the last sheet is not full, its remaining places are left empty. The margin keeps the same space at the sheet's edges and between pages, and the border is a ${N_UP_BORDER_PT}-point line.`,
        ],
      },
      {
        id: "what-the-sheets-keep",
        heading: "What the sheets keep",
        body: [
          "Each page is placed as a drawing, not a picture, so text stays sharp and selectable however far you zoom in. What shrinks is the printed size: at the higher counts, body text becomes small, so print a test sheet before a long run.",
          "Filled form fields and stamps show on the sheets as they look, but links and form fields stop being clickable or editable there. The sheets are a new PDF, so the original's bookmarks are not carried over. Keep the original for anything that has to stay interactive.",
        ],
      },
      {
        id: "related-jobs",
        heading: "When another tool is the better fit",
        body: [
          `Pages go onto the sheets in their own order; the tool does not rearrange them for a folded booklet. To change the order first, such as moving a cover page or dropping blank pages, use ${nameOf("organize-pages")} and then make the sheets.`,
          `To print one page per sheet on different paper, such as a ${RESIZE_LETTER} document on ${RESIZE_A4}, use ${nameOf("resize-pdf")} instead.`,
        ],
      },
    ],
    faq: [
      {
        question: "How do I print two pages on one sheet of paper?",
        answer: `Choose ${N_UP_COUNTS[0]} per sheet, keep Orientation on ${N_UP_AUTO}, and press Create sheets. Two portrait pages land side by side on a landscape sheet. Download the PDF and print it at one page per sheet.`,
      },
      {
        question: "Is the text still sharp and searchable?",
        answer:
          "Yes. Each page is placed as a scaled-down drawing, not turned into an image, so text stays selectable and sharp when you zoom in. Only its printed size changes.",
      },
      {
        question: "Do links and form fields still work on the sheets?",
        answer:
          "They show as they looked, but they stop being interactive: a link on a sheet does not open and a field cannot be edited. Keep the original file for anything that has to stay clickable.",
      },
      {
        question: "Can it make a folded booklet?",
        answer: `No. Pages fill the sheets in their own order, ${N_UP_ACROSS.toLowerCase()} or ${N_UP_DOWN.toLowerCase()}; there is no booklet ordering for folding and stapling.`,
      },
      {
        question: "Is my PDF sent to a server?",
        answer:
          "No. The sheets are made in your browser tab and saved on your device; the PDF is not sent to pdf.xyz.",
      },
    ],
    published: "2026-10-30",
    updated: "2026-10-30",
  },
  {
    slug: "how-to-add-bates-numbers-to-a-pdf",
    title: "How to add Bates numbers to a PDF",
    description: `Stamp Bates numbers such as ${batesAt(1)} on every page of a PDF: pick a prefix and a digit count, and carry on from the last batch. Runs in your browser.`,
    tools: ["page-numbers", "merge-pdf"],
    keywords: [
      "how to add bates numbers to a pdf",
      "bates numbering pdf",
      "bates stamp pdf",
      "add bates numbers online",
      "legal page numbering pdf",
      "zero padded page numbers pdf",
    ],
    intro: [
      `To add Bates numbers to a PDF, open ${nameOf("page-numbers")}, add your file, and choose ${BATES_STYLE} under Format. Type a prefix, pick how many digits the number has, and press Add page numbers. Every page gets the prefix and a number padded with zeros, starting from ${batesAt(1)}.`,
      "Bates numbering is how legal, insurance and audit work labels pages: every page in a set of documents gets its own reference, and the references never repeat. Because the number always has the same count of digits, the references sort in order and anyone can point to one page by quoting it.",
      `It runs in your browser, so your PDF stays on your device. It numbers one file at a time, up to ${ceilingMb("page-numbers")} MB.`,
    ],
    steps: [
      `Open the ${nameOf("page-numbers")} tool and drop your PDF where it says Drop your PDF here, or click browse. It stays on your device.`,
      `Under Format, choose ${BATES_STYLE} in place of ${PAGES_STYLE}.`,
      `Type a Prefix, such as ${BATES_PREFIX}, and set Digits to how long the number should be, from 1 to ${BATES_MAX_DIGITS}. The preview beside the Format heading shows the first page's label.`,
      "Under Placement, pick where the number goes, and set First number to the number the first page should carry.",
      "Press Add page numbers, then Download numbered PDF. The copy is named after yours, with -numbered added.",
    ],
    sections: [
      {
        id: "prefix-and-digits",
        heading: "The prefix and the digits",
        body: [
          `The prefix is printed exactly as you type it, before the number, so it can be a case name, a client code or a party's initials, with a dash or a space to separate it. Leave it empty for a bare number. Digits sets how wide the number is: with ${DEFAULT_BATES_DIGITS} digits, the first page reads ${batesAt(1)} and page 250 reads ${batesAt(250)}.`,
          `A number that grows past the width is printed in full, never cut short, so choose enough digits for the whole set at the start. The number is drawn on the page as real text in the font you pick, so it can be searched for and copied in any PDF reader.`,
        ],
      },
      {
        id: "several-files",
        heading: "Numbering a set of several files",
        body: [
          `${nameOf("page-numbers")} numbers one PDF at a time, and each file starts counting from First number. It has no way to carry the count from one file to the next on its own, so a set of files can be numbered in one of two ways.`,
          `The first is to combine the files with ${nameOf("merge-pdf")} before you number them, so the numbers run straight through one PDF. The second keeps the files apart: number the first file, note the last number on its last page, and set First number to the next one for the following file. A new batch of documents carries on from the last batch the same way.`,
        ],
      },
      {
        id: "every-page",
        heading: "Making sure no page is skipped",
        body: [
          "A Bates number usually goes on every page, the cover and the blank pages included. So keep Start on page at 1, and under Pages, font and color, leave Leave the cover unnumbered unticked and Skip last pages at zero: both of those leave pages without a number.",
          "The number is drawn on top of what is already on the page. If a footer or a page number already sits in that spot, choose another position under Placement or a larger Margin, and check the preview of the downloaded copy before you send it.",
        ],
      },
    ],
    faq: [
      {
        question: "What is a Bates number?",
        answer: `A unique reference printed on every page of a document set, made of a prefix and a number with a fixed count of digits, such as ${batesAt(1)}. Lawyers and auditors use it to refer to a single page without ambiguity.`,
      },
      {
        question: "Can I continue numbering from a previous batch?",
        answer: `Yes. Set First number to the number after the last one you used. If the last batch ended on ${batesAt(250)}, set First number to 251 and the first page reads ${batesAt(251)}.`,
      },
      {
        question: "Can I Bates number several PDFs in one go?",
        answer: `Not in one step: the tool numbers one PDF at a time, and each file starts from First number. Combine the files with ${nameOf("merge-pdf")} first so the numbers run through all of them, or number each file in turn and set First number to carry on from the last.`,
      },
      {
        question: "Can I write my own Bates template?",
        answer: `Yes. With ${PAGES_STYLE} chosen, type into the Custom format field: {n:${DEFAULT_BATES_DIGITS}} prints the number padded to ${DEFAULT_BATES_DIGITS} digits, so ${BATES_PREFIX}{n:${DEFAULT_BATES_DIGITS}} gives the same labels as the ${BATES_STYLE} style, and you can add your own text around it.`,
      },
      {
        question: "Is my PDF sent to a server?",
        answer:
          "No. The numbers are drawn in your browser tab and the copy is saved on your device; the PDF is not sent to pdf.xyz.",
      },
    ],
    published: "2026-10-30",
    updated: "2026-10-30",
  },
  {
    slug: "how-to-combine-double-sided-scans-into-one-pdf",
    title: "How to combine double-sided scans into one PDF",
    description: `Scanned the fronts and the backs of a stack as two PDFs? Interleave them into one in reading order, and reverse the backs if needed. Runs in your browser.`,
    tools: ["merge-pdf", "remove-pages", "organize-pages"],
    keywords: [
      "how to combine double sided scans into one pdf",
      "merge front and back scans pdf",
      "interleave two pdfs",
      "alternate pages from two pdfs",
      "collate odd and even pages pdf",
      "double sided scanning without duplex",
    ],
    intro: [
      `A scanner without a two-sided feeder scans one side at a time: you feed the stack for the fronts, turn it over and feed it again for the backs, and end up with two PDFs. To put them back in reading order, open ${nameOf("merge-pdf")}, add the fronts file and then the backs file, and set Page order to ${MERGE_ALTERNATE}. The merged PDF takes one page from each file in turn.`,
      "When you turn the stack over, the last sheet is usually scanned first, so the backs file runs backwards. Tick Reverse page order on that file and its pages are turned round before they are paired.",
      `It runs in your browser, so your scans stay on your device. Each PDF can be up to ${ceilingMb("merge-pdf")} MB.`,
    ],
    steps: [
      `Open the ${nameOf("merge-pdf")} tool and drop the PDF of front sides and the PDF of back sides where it says Drop your PDF here, or click browse. They stay on your device.`,
      "Check the list: the fronts file should be at the top. Drag a row, or use its arrow buttons, to move it.",
      `Under Page order, choose ${MERGE_ALTERNATE} in place of ${MERGE_APPEND}.`,
      "If the backs were scanned last sheet first, tick Reverse page order on the backs file's row.",
      "Press Merge 2 PDFs, then Download merged PDF. The copy is named after the top file, with -merged added.",
    ],
    sections: [
      {
        id: "how-pairing-works",
        heading: "How the pages are paired",
        body: [
          `With ${MERGE_ALTERNATE}, page 1 of the top file comes first, then page 1 of the next file, then page 2 of each, and so on. Fronts 1, 2 and 3 with backs 1, 2 and 3 come out as front 1, back 1, front 2, back 2, front 3, back 3.`,
          "If one file is longer, its extra pages go at the end in their own order. The same works for more than two files: one page from each in turn, top file first.",
        ],
      },
      {
        id: "reverse-page-order",
        heading: "When to tick Reverse page order",
        body: [
          `Reverse page order appears on each file's row once ${MERGE_ALTERNATE} is chosen, and turns that file's pages round before they are paired. To tell whether the backs need it, open the backs file and look at its first page: if it shows the back of the last sheet, tick it.`,
          "Each row's Pages box still works in this mode. The pages you type are taken in the file's own order first, and only then turned round.",
        ],
      },
      {
        id: "what-the-merge-keeps",
        heading: "Bookmarks, blank backs and fixing the order later",
        body: [
          `A bookmark for each file and a contents page are not offered with ${MERGE_ALTERNATE}, because each file's pages are spread through the result. Bookmarks already in your files are kept and still open the right pages.`,
          `Sheets printed on one side only leave blank backs in the merged PDF. Keep them while merging, because every back has to stay next to its front for the pairs to line up, and take them out afterwards with ${nameOf("remove-pages")}. If a page still lands in the wrong place, ${nameOf("organize-pages")} lets you drag it to where it belongs.`,
        ],
      },
    ],
    faq: [
      {
        question: "How do I merge front and back scans into one PDF?",
        answer: `Add the fronts file first and the backs file second, choose ${MERGE_ALTERNATE} under Page order, and merge. The result takes front 1, back 1, front 2, back 2, and so on.`,
      },
      {
        question: "Why are the back pages in the wrong order?",
        answer:
          "The stack was turned over to scan the backs, so the last sheet went through first. Tick Reverse page order on the backs file's row and merge again.",
      },
      {
        question: "What if the two files have different numbers of pages?",
        answer:
          "The extra pages of the longer file go at the end. A page missing from the middle of one file moves every pair after it, so check that both files hold one page per sheet, blank backs included.",
      },
      {
        question: "Can I still add bookmarks or a contents page?",
        answer: `Not with ${MERGE_ALTERNATE}: a file's pages are spread through the result, so there is no one page for its bookmark to open. With ${MERGE_APPEND}, both options are offered.`,
      },
      {
        question: "Are my scans sent to a server?",
        answer:
          "No. The PDFs are read and merged in your browser tab and the copy is saved on your device; they are not sent to pdf.xyz.",
      },
    ],
    published: "2026-10-30",
    updated: "2026-10-30",
  },
  {
    slug: "how-to-convert-webp-gif-or-bmp-to-pdf",
    title: `How to convert ${DECODED_NAMES_OR} images to PDF`,
    description: `Turn ${DECODED_NAMES} images into one PDF, mixed with JPGs and PNGs, one image per page. Your browser converts them, and no account is needed.`,
    tools: ["jpg-to-pdf", "png-to-pdf", "compress-pdf"],
    keywords: [
      "webp to pdf",
      "convert webp to pdf",
      "gif to pdf",
      "bmp to pdf",
      "webp images to one pdf",
      "convert image to pdf online",
    ],
    intro: [
      `To turn ${DECODED_NAMES} images into a PDF, open ${nameOf("jpg-to-pdf")}, add the images, put them in order and press Create PDF. Each image becomes one page of the PDF, and you can mix them with JPG and PNG files in the same document. ${nameOf("png-to-pdf")} takes the same files and works the same way.`,
      `A PDF can hold JPEG and PNG pictures but not the other formats as they are, so each ${DECODED_NAMES_OR} image is first decoded by your browser and saved again: as a JPEG at ${TRANSCODE_QUALITY_PCT}% quality when it has no transparent areas, and as a PNG when it has any.`,
      `It runs in your browser, so your images stay on your device. Each image can be up to ${MAX_IMAGE_MB} MB.`,
    ],
    steps: [
      `Open the ${nameOf("jpg-to-pdf")} tool and drop your images on the box at the top of the page, or click it to pick them. ${DECODED_NAMES} files are taken alongside JPG and PNG.`,
      // Was "press Remove": the button is an X icon whose only text is its
      // `title` tooltip — guide-ui-labels.test.ts, the screen-reader rule.
      "Put the pages in order with the up and down arrows on each image, and press the cross on an image to take it out.",
      "Choose the Page size, Orientation and Margin, or keep the ones shown.",
      "Under Output, keep One PDF, or choose One PDF per image (ZIP) to get several PDFs, one for each image.",
      "Press Create PDF, then Download PDF. With several images and a PDF per image, the button downloads them together as a ZIP instead.",
    ],
    sections: [
      {
        id: "saved-again",
        heading: "Why the image is saved again, and what that changes",
        body: [
          "A JPEG or PNG is copied into the PDF as it is. The other formats have to be redrawn first, and that is a second save of the picture, which has two costs worth knowing about.",
          "A WebP photo saved again as a JPEG can come out a little softer, or a little larger in bytes, than the file you had, because WebP often compresses better than JPEG. And what the image file carried beside its pixels, such as the camera details and the date it was taken, is not kept. Keep the original file if you need either.",
        ],
      },
      {
        id: "gif-and-bmp",
        heading: "GIF and BMP",
        body: [
          "An animated GIF gives its first frame only: one image, on one page. To keep a later frame, save that frame as an image of its own first.",
          "A BMP is stored without compression, so it is usually much larger than the same picture as a JPEG or PNG; once saved into the PDF, it usually takes far less room. A picture with transparent areas keeps them, and the white page shows through.",
        ],
      },
      {
        id: "other-formats",
        heading: "Formats that are turned away",
        body: [
          `${REFUSED_NAMES} images are not taken: browsers do not all have a decoder for them. Such a file is turned away when you add it, with a note naming its real format, so save or export it as a JPG or PNG first.`,
          `Each file is judged by its contents, not its name, so a WebP saved with a .jpg name still goes in as a WebP. If the finished PDF is larger than you want, ${nameOf("compress-pdf")} can make it smaller.`,
        ],
      },
    ],
    faq: [
      {
        question: "How do I convert a WebP image to PDF?",
        answer: `Open ${nameOf("jpg-to-pdf")}, drop the WebP file on the box, and press Create PDF. The image is decoded in your browser and saved into the PDF as a JPEG, or as a PNG if it has transparent areas.`,
      },
      {
        question: "Does an animated GIF keep its animation?",
        answer:
          "No. A PDF page holds a still picture, so only the GIF's first frame goes into the PDF.",
      },
      {
        question: "Will the image lose quality?",
        answer: `A little, possibly. A ${DECODED_NAMES_OR} image is saved again before it goes into the PDF, as a JPEG at ${TRANSCODE_QUALITY_PCT}% quality when it has no transparency, which can soften fine detail slightly. With transparency it is saved as a PNG, which does not soften detail.`,
      },
      {
        question: `Can I convert ${REFUSED_NAMES} images?`,
        answer:
          "No. They are turned away when you add them, with a note naming the format. Save or export them as JPG or PNG first, then add those.",
      },
      {
        question: "Are my images sent to a server?",
        answer:
          "No. The images are decoded and the PDF is made in your browser tab; the files are not sent to pdf.xyz.",
      },
    ],
    published: "2026-10-30",
    updated: "2026-10-31",
  },
];
