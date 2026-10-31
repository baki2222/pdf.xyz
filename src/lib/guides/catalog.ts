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
  DEFAULT_SUMMARY_FORMAT,
  DEFAULT_SUMMARY_LENGTH,
  MAX_SUMMARY_FOCUS_CHARS,
  summaryOutputName,
  type SummaryFormat,
  type SummaryLength,
} from "@/lib/jobs/summarize-pdf";
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
  RASTER_COLORS,
  RASTER_RESOLUTION_DPIS,
  pageImageName,
  rasterCapInches,
  resolutionById,
  zipOutputName,
  type RasterResolution,
} from "@/lib/pdf/pdf-to-image";
import { MAX_EDIT_IMAGE_BYTES } from "@/lib/pdf/edit";
import {
  DEEP_COMPRESSION_PRESETS,
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
import {
  KB as TARGET_KB,
  TARGET_EXAMPLE,
  TARGET_SIZE_LABELS,
  TARGET_SIZE_PRESETS,
  targetOutcome,
} from "@/lib/pdf/compress-target";
import {
  LIMIT_EXAMPLE,
  LIMIT_TIME_BUDGET_MS,
  MAX_LIMIT_ATTEMPTS,
  MAX_SIZE_LABELS,
  MAX_SIZE_PRESETS,
  MIN_LONG_EDGE_PX,
  REENCODE_LADDER,
  limitOutcome,
} from "@/lib/pdf/image-size-limit";
import { IMAGE_OUTPUTS } from "@/lib/pdf/image-page-layout";
import { RETENTION_WINDOWS } from "@/lib/retention-windows";
import { PDF_A_STANDARD } from "@/lib/jobs/pdfa-results";
import {
  PDFA_EXPECTED_CONFORMANCE,
  PDFA_EXPECTED_PART,
} from "@/lib/workers/pdf-archive/pdfa-markers";
import { pdfaOutputName } from "@/lib/workers/processor/pdf-archive";
import { LARGE_RASTER_PAGES } from "@/lib/intent/defaults";
import { textOutputName } from "@/lib/pdf/text";
import {
  GRAYSCALE_DPI_PRESETS,
  GRAYSCALE_GREW_NOTE,
  grayscaleOutputName,
  grayscalePresetById,
  grayscaleTitle,
} from "@/lib/pdf/grayscale";
import { annotatedOutputName } from "@/lib/pdf/annotate";
import { DEFAULT_HIGHLIGHT } from "@/lib/pdf/editor/model";
import { INITIAL_DEFAULTS } from "@/components/tools/runner/editor/editor-state";
import {
  MAX_QUESTION_CHARS,
  chatAnswerOutputName,
} from "@/lib/jobs/chat-with-pdf";
import { MAX_CONTEXT_EXCHANGES } from "@/lib/workers/chat-with-pdf-conversation";
import { tableExtractOutputName } from "@/lib/workers/processor/table-extract";
import { LONG_CELL_WORDS } from "@/lib/workers/pdf-text/flow";
import { MAX_SIGNIFICANT_DIGITS } from "@/lib/workers/ooxml/sheet-cells";
import {
  HEADING_MAX_CHARS,
  HEADING_SIZE_RATIO,
  PARAGRAPH_GAP_RATIO,
  markdownOutputName,
} from "@/lib/pdf/pdf-to-markdown";
import type { Guide } from "./types";

/**
 * Sign PDF's counts, from the lists the runner offers. The guide used to say
 * "five ways to make a signature", counting the typed signature once per font
 * style and naming a "print-and-scan style" the runner does not have.
 */
const signatureWays = countWord(SIGNATURE_SOURCES.length);

/** Compress PDF's Target size presets, labelled as its panel labels them. */
const TARGET_PRESET_LABELS = TARGET_SIZE_PRESETS.map((p) => p.label);
function targetPreset(bytes: number): string {
  const preset = TARGET_SIZE_PRESETS.find((p) => p.bytes === bytes);
  if (!preset) {
    throw new Error(
      `a guide names a target of ${bytes} that the panel does not offer`,
    );
  }
  return preset.label;
}
const KB_BYTES = TARGET_KB;
const TARGET_PRESET_100 = targetPreset(100 * KB_BYTES);
const TARGET_PRESET_200 = targetPreset(200 * KB_BYTES);
/** The ladder's floor and the panel's default Quality, by their own labels. */
const TARGET_FLOOR_LABEL = DEEP_COMPRESSION_PRESETS[0].label;
const TARGET_DEFAULT_QUALITY_LABEL = (() => {
  const preset = DEEP_COMPRESSION_PRESETS.find((p) => p.dpi === 150);
  if (!preset) throw new Error("the guide's default Quality is not offered");
  return preset.label;
})();
/** A whole-KB target under 100,000 bytes, for a portal that counts KB as 1,000. */
const PORTAL_SAFE_100_KB = Math.floor(100_000 / KB_BYTES);
/** The panel's own sentence for a met target, from the function it calls. */
const TARGET_EXAMPLE_SENTENCE = targetOutcome({
  ...TARGET_EXAMPLE,
  appliedTargetBytes: TARGET_EXAMPLE.targetBytes,
  grayscale: false,
}).text;

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
/** The OCR menu's name for Bengali, as the Bangla guide writes it. */
const BN = describeOcrLanguage("ben");
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

/**
 * JPG / PNG to PDF's Max file size (2026-10-31), every figure and label from
 * the panel's own constants (`image-size-limit.ts`): the presets are
 * Compress PDF's list itself, so the two guides name the same sizes.
 */
function limitPreset(bytes: number): string {
  const preset = MAX_SIZE_PRESETS.find((p) => p.bytes === bytes);
  if (!preset) {
    throw new Error(
      `a guide names a limit of ${bytes} that the panel does not offer`,
    );
  }
  return preset.label;
}
const LIMIT_100 = limitPreset(100 * KB_BYTES);
const LIMIT_200 = limitPreset(200 * KB_BYTES);
const LIMIT_PRESET_LABELS = MAX_SIZE_PRESETS.map((p) => p.label);
const LIMIT_MET_SENTENCE = limitOutcome({
  ...LIMIT_EXAMPLE,
  reencoded: false,
  flattened: false,
  images: 1,
}).text;
const LIMIT_TOP_QUALITY_PCT = Math.round(REENCODE_LADDER[0]!.quality * 100);
const LIMIT_LOW_QUALITY_PCT = Math.round(REENCODE_LADDER.at(-1)!.quality * 100);
const LIMIT_LOW_SCALE_PCT = Math.round(REENCODE_LADDER.at(-1)!.scale * 100);
const LIMIT_BUDGET_S = LIMIT_TIME_BUDGET_MS / 1000;
const PER_IMAGE_OUTPUT = IMAGE_OUTPUTS.find((o) => o.id === "per-image")!.label;

/**
 * Summarize PDF's choices, by the words its panel's selects show (a Record,
 * so a new length or format fails the build here; the label TEXT is held to
 * the panel by guide-ui-labels.test.ts, which reads the panel's options).
 */
const SUMMARY_LENGTH_LABEL: Record<SummaryLength, string> = {
  brief: "Brief",
  standard: "Standard",
  detailed: "Detailed",
};
const SUMMARY_FORMAT_LABEL: Record<SummaryFormat, string> = {
  paragraphs: "Paragraphs",
  bullets: "Bullet points",
  outline: "Section outline",
};
const SUMMARY_FORMAT_NAMES = listOr(Object.values(SUMMARY_FORMAT_LABEL));
const SUMMARY_FOCUS_CHARS = MAX_SUMMARY_FOCUS_CHARS.toLocaleString("en-US");
/** The download name the panel shows, from the function the worker uses. */
const SUMMARY_EXAMPLE_ZIP = summaryOutputName("report.pdf");

/**
 * PDF to PDF/A (2026-10-31). The prose explains conformance level b and the
 * engine's PDF/A-2 setting, so a change of target stops the build here
 * rather than shipping sentences true of the old one (the tool page's guard,
 * `content/pdf-to-pdfa.ts`, repeated where this guide's sentences are).
 */
if (PDF_A_STANDARD !== "PDF/A-2b") {
  throw new Error(
    `the PDF/A guide is written for PDF/A-2b; the engine now targets ${String(PDF_A_STANDARD)}`,
  );
}
/** The download name, from the function the worker names the output with. */
const PDFA_EXAMPLE_OUT = pdfaOutputName("report.pdf");

/**
 * PDF to PNG's choices (2026-10-31), by the labels its runner draws from the
 * same lists. The page-size cap is the one the Print chip's tooltip states.
 */
const PNG_COLOUR = labelOf(RASTER_COLORS, "color");
const PNG_GRAY = labelOf(RASTER_COLORS, "gray");
const PNG_SCREEN = rasterPreset("screen");
const PNG_PRINT = rasterPreset("print");
const PNG_PRINT_CAP_IN = rasterCapInches(PNG_PRINT.dpi, RASTER_MAX_DEVICE_PX);
const PNG_MAX_PX = RASTER_MAX_DEVICE_PX.toLocaleString("en-US");
const PNG_EXAMPLE_PAGES = 120;
const PNG_EXAMPLE_ZIP = zipOutputName("manual.pdf", "png");
const PNG_EXAMPLE_FIRST = pageImageName(
  "manual.pdf",
  0,
  PNG_EXAMPLE_PAGES,
  "png",
);
const PNG_EXAMPLE_PAGE_7 = pageImageName(
  "manual.pdf",
  6,
  PNG_EXAMPLE_PAGES,
  "png",
);
const PNG_EXAMPLE_SINGLE = pageImageName("logo.pdf", 0, 1, "png");

/** PDF to Text's download name, from the function its runner calls. */
const TEXT_EXAMPLE_OUT = textOutputName("report.pdf");
/** OCR PDF's plain-text output, by the label its panel shows. */
const OCR_TEXT_MODE = ocrModeLabel("text");
const OCR_PDF_MODE = ocrModeLabel("searchable-pdf");

/**
 * Grayscale PDF's Output quality choices (2026-10-31), as its runner labels
 * them. The runner opens on "print" (`useState("print")`, a literal the
 * module does not export), so the guide resolves that same id.
 */
const GRAY_SCREEN = grayscalePresetById("screen");
const GRAY_PRINT = grayscalePresetById("print");
const GRAY_PRESET_CHOICES = listOr(
  GRAYSCALE_DPI_PRESETS.map((p) => `${p.label} (${p.dpi} DPI)`),
);
const GRAY_EXAMPLE_OUT = grayscaleOutputName("report.pdf");
const GRAY_EXAMPLE_TITLE = grayscaleTitle("Annual report", "report.pdf");

/**
 * Annotate PDF's Highlight (2026-10-31): the opacity a new highlight starts
 * at, from the editor's own defaults, and the download name from the
 * function its runner names the file with. The guide calls the default
 * colour yellow, so a different default stops the build here.
 */
const HIGHLIGHT_OPACITY_PCT = Math.round(
  INITIAL_DEFAULTS.highlight.opacity * 100,
);
if (DEFAULT_HIGHLIGHT !== "#facc15") {
  throw new Error(
    `the highlight guide calls the default highlight yellow; it is now ${DEFAULT_HIGHLIGHT}`,
  );
}
const ANNOTATED_EXAMPLE_OUT = annotatedOutputName("report.pdf");

/** Chat with PDF (2026-10-31), from its job contract and conversation module. */
const CHAT_QUESTION_CHARS = MAX_QUESTION_CHARS.toLocaleString("en-US");
const CHAT_EXAMPLE_ZIP = chatAnswerOutputName("lease.pdf");

/** Extract Tables (2026-10-31): the worker's own names and detector bound. */
const TABLES_EXAMPLE_ZIP = tableExtractOutputName("report.pdf", "zip");

/** PDF to Markdown (2026-10-31), from the converter's own constants. */
const MD_HEADING_PCT = Math.round((HEADING_SIZE_RATIO - 1) * 100);
const MD_EXAMPLE_OUT = markdownOutputName("report.pdf");

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
      "Turn PDF pages into JPG or PNG images right in your browser — your file never leaves your device. Pick the pages, colour and resolution; several arrive as one ZIP.",
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
      "To convert a PDF to JPG, open the PDF to JPG tool — or PDF to PNG for lossless images — add your PDF, choose a resolution, and render. Each page you choose becomes its own image, drawn right in your browser. A single page downloads as one image; several pages arrive as one ZIP with an image for each page.",
      "The rendering happens on your own device. The tool draws each page with pdf.js, a PDF renderer bundled with the site, and encodes it in the browser, so your PDF stays on your device from start to finish. There is no account to create.",
      `That makes it a quick way to share a page in a chat or on a slide, to drop a page into a document that only takes images, or to show a PDF on a device with no viewer. Each PDF can be up to ${ceilingMb("pdf-to-jpg")} MB.`,
    ],
    steps: [
      "Open the PDF to JPG tool, or PDF to PNG for lossless images.",
      "Add your PDF. It is read in your browser, and the file stays on your device.",
      `Under Resolution, pick ${RASTER_RESOLUTION_CHOICES}.`,
      `Under Pages, keep All pages, or click Select pages and type the pages you want, such as 1-3, 5. Under Colour, keep ${PNG_COLOUR} or pick ${PNG_GRAY}.`,
      "Render the pages. A progress count shows each page as it is drawn.",
      `Download the result: a single page saves as one image, and several pages save as one ZIP with an image for each page. Each of the first ${RASTER_PREVIEW_LIMIT} pages can also be saved on its own from its preview.`,
    ],
    sections: [
      {
        id: "choosing-a-resolution",
        heading: "Choosing a resolution",
        body: [
          `DPI is how many image pixels each inch of the page becomes. ${presetText(rasterPreset("screen"))} is enough for a page read on a monitor or in a chat. ${presetText(rasterPreset("high"))} is a sharper all-rounder. ${presetText(rasterPreset("print"))} is for printing, or for zooming in on small text. Every step up draws more pixels per page, so the images get larger and take longer to render.`,
          `${DEFAULT_RESOLUTION_LABEL} is selected the first time you use the tool. After that, this browser remembers the resolution and colour you last rendered with, and a PDF of more than ${LARGE_RASTER_PAGES} pages opens at ${PNG_SCREEN.label}, with a note saying why. You can still pick another resolution before you render.`,
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
        answer:
          "Yes. Under Pages, click Select pages and type that page's number, such as 7; only the pages you list are rendered. The image keeps the page's number from the document in its name.",
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
    updated: "2026-10-31",
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
    title: `How to OCR a PDF in ${OCR_EXAMPLES.slice(0, 3).map(describeOcrLanguage).join(", ")} and more`,
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
    updated: "2026-10-31",
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
  // Added 2026-10-31 with the deep step's Target size. Every label is read
  // from the panel's constants (`compress-target.ts`, `offered-kinds.ts`),
  // the retention windows from the code the privacy page reads, and the
  // KB arithmetic from the same KB the panel compares with.
  {
    slug: "how-to-compress-a-pdf-to-100-kb",
    title: `How to compress a PDF to ${TARGET_PRESET_100} (or ${TARGET_PRESET_200})`,
    description: `Make a PDF fit an upload limit of ${listOr(TARGET_PRESET_LABELS)}: pick a target size, and our server shrinks the images until it fits or can go no smaller.`,
    tools: ["compress-pdf", "split-pdf", "remove-pages"],
    keywords: [
      "compress pdf to 100kb",
      "compress pdf to 200kb",
      "reduce pdf size to 100 kb",
      "make a pdf smaller for an upload form",
      "compress pdf to a specific size",
      "pdf size for online application",
    ],
    intro: [
      `To compress a PDF to ${TARGET_PRESET_100}, open ${nameOf("compress-pdf")}, add the file, and in the “Deep image compression (secure server)” panel choose a “${TARGET_SIZE_LABELS.heading}” of ${TARGET_PRESET_100} — or ${listOr(TARGET_PRESET_LABELS.slice(1))}, or “${TARGET_SIZE_LABELS.custom}” for a number of KB of your own. Then press Compress images on our server. Our server starts at your Quality setting, lowers the resolution of the images step by step, as far as ${TARGET_FLOOR_LABEL}, and gives back the highest-quality version that fits.`,
      "Whether a file can get that small depends on what is in it. A scan, or a phone photo of a page, is mostly picture, and picture resolution is what this lowers, so such files often shrink a long way. A PDF that is mostly typed text, or whose size comes from its fonts, may hardly shrink at all; then the panel tells you the smallest file it could make, and you can still download it.",
      `This step uploads your file to our server; the size breakdown and the lossless copy on the same page run in your browser. Our privacy policy says the uploaded file is deleted when the job ends, the result can be downloaded for ${RETENTION_WINDOWS.outputLink}, and the stored copy is erased by a daily storage rule some time after it is ${RETENTION_WINDOWS.outputStorageRule} old.`,
    ],
    steps: [
      `Open the ${nameOf("compress-pdf")} tool and drop your PDF on the box, or click it to pick one. Its size breakdown appears first.`,
      `In the “Deep image compression (secure server)” panel, keep the Quality at ${TARGET_DEFAULT_QUALITY_LABEL} or pick another. It is the best quality our server will try; with a target it only goes down from there.`,
      `Under “${TARGET_SIZE_LABELS.heading}”, choose ${listOr(TARGET_PRESET_LABELS)}, or choose “${TARGET_SIZE_LABELS.custom}” and type a whole number of KB. A size your file is already under cannot be chosen.`,
      "Press Compress images on our server, which uploads your file. A run with a target can take longer, because each step down is another run.",
      `Read the line on the result. “${TARGET_EXAMPLE_SENTENCE}” means it fits: press Download compressed PDF.`,
      `If the line says the file is above your target, tick “Grayscale” and run again, or make the document shorter with ${nameOf("split-pdf")} or ${nameOf("remove-pages")} first.`,
    ],
    sections: [
      {
        id: "how-the-target-is-reached",
        heading: "How the target is reached",
        body: [
          `Our server makes the file at your Quality setting first, then at each lower resolution in turn, as far as ${TARGET_FLOOR_LABEL}, and stops at the first one at or under the target: the sharpest version that fits. If none fits, it gives you the smallest file it made, with a line saying it is above your target.`,
          "A lower resolution usually makes a smaller file, but not always. For each picture, the program that does the work chooses how to store it, and at a lower setting it can choose a way that takes more room. So the server measures every file it makes rather than assuming, and a run where nothing fits tries every setting before it answers, which takes longer.",
          "Only the pictures in the file are made smaller. Typed text and drawn lines are not pictures, so they stay as sharp as before, and they are also why a text-heavy PDF cannot be squeezed much. The server checks that the result opens as a PDF and, when it can count them, that no page went missing.",
          `Colour is kept. The server never turns pages gray to reach a size: it does that only when you tick “Grayscale”, and gray pages are often much smaller.`,
        ],
      },
      {
        id: "how-big-is-a-kb",
        heading: "How big is 100 KB, here and on the form you are filling in",
        body: [
          `On this page 1 KB is ${KB_BYTES.toLocaleString("en-US")} bytes, so a ${TARGET_PRESET_100} target means at most ${(100 * KB_BYTES).toLocaleString("en-US")} bytes — the same unit every size on the page is shown in. Some upload portals count 1 KB as 1,000 bytes instead. If yours does, and is strict, choose “${TARGET_SIZE_LABELS.custom}” and enter ${PORTAL_SAFE_100_KB} KB, which is under 100,000 bytes.`,
          "The file usually comes back a little under your target rather than exactly on it, because the server stops at the first version that fits.",
        ],
      },
      {
        id: "when-it-will-not-fit",
        heading: "When the file will not fit",
        body: [
          `A target can be out of reach for a long document full of photos, or for a document that is mostly text. Running again with “Grayscale” ticked often helps a colour scan. Otherwise, make the document shorter: ${nameOf("split-pdf")} can cut it into parts that each fit, and ${nameOf("remove-pages")} can drop pages the form does not need.`,
          `Your original is never changed. Each run starts from the file you added, so you can try a different target or setting as often as you like. The per-file cap is ${ceilingMb("compress-pdf")} MB.`,
        ],
      },
    ],
    faq: [
      {
        question: `Can I compress a PDF to exactly ${TARGET_PRESET_100}?`,
        answer:
          "To at most that size, not to exactly it. Our server returns the sharpest version at or under your target, so the file usually comes back a little smaller than the number you chose.",
      },
      {
        question: "Why is my PDF still above the target?",
        answer: `Because none of the resolutions our server tried, down to ${TARGET_FLOOR_LABEL}, made a small enough file. That happens with a mostly-text PDF, where there are few pictures to shrink, and with long documents full of photos. Try “Grayscale”, or split the file.`,
      },
      {
        question: "Will my PDF turn black and white to hit the target?",
        answer:
          "No. Colour is kept unless you tick “Grayscale” yourself; the server never removes it to reach a size.",
      },
      {
        question: "Is my PDF uploaded?",
        answer: `Yes, to reach a target: the size breakdown and the lossless copy run in your browser, but a target is reached by the deep step on our server. ${HYBRID_WORKER_STEP} The uploaded file is deleted when the job ends, and the result can be downloaded for ${RETENTION_WINDOWS.outputLink}.`,
      },
      {
        question: "How large can my PDF be?",
        answer: `Up to ${ceilingMb("compress-pdf")} MB per file.`,
      },
    ],
    published: "2026-10-31",
    updated: "2026-10-31",
  },
  // Added 2026-10-31 with JPG / PNG to PDF's Max file size. Every label and
  // figure is read from the panel's constants (`image-size-limit.ts`), the
  // met sentence from the function the panel calls, and the KB arithmetic
  // from the same KB the compress guide uses.
  {
    slug: "how-to-convert-jpg-to-pdf-under-100-kb",
    title: `How to convert JPG to PDF under ${LIMIT_100} (or ${LIMIT_200})`,
    description: `Make a PDF of a photo, signature or scan that fits a limit of ${listOr(LIMIT_PRESET_LABELS)}. Your browser shrinks the image until it fits.`,
    tools: ["jpg-to-pdf", "png-to-pdf"],
    keywords: [
      "jpg to pdf under 100kb",
      "jpg to pdf under 200kb",
      "convert photo to pdf under 100 kb",
      "signature jpg to pdf under 100kb",
      "image to pdf less than 100kb",
      "jpg to pdf for online application",
    ],
    intro: [
      `To turn a JPG into a PDF under ${LIMIT_100}, open ${nameOf("jpg-to-pdf")}, add the image, and under “${MAX_SIZE_LABELS.heading}” choose ${LIMIT_100} — or ${listOr(LIMIT_PRESET_LABELS.slice(1))}, or “${MAX_SIZE_LABELS.custom}” for a number of KB of your own. Then press Create PDF. If the PDF comes out bigger than your limit, your browser saves the image again at a lower quality and a smaller pixel size, step by step, and keeps the sharpest version that fits.`,
      "Application portals for jobs, exams and visas often limit the PDF of a photo, a signature or a certificate scan at a size like this. A single phone photo is usually several times too big, and a scan of one page often is too, so the limit is what does the work here.",
      `It all happens in your browser tab: the image is not sent to pdf.xyz, and the PDF is saved straight to your device. ${nameOf("png-to-pdf")} has the same setting for PNG images.`,
    ],
    steps: [
      `Open the ${nameOf("jpg-to-pdf")} tool and drop your JPG on the box at the top of the page, or click it to pick one. Add more images if the form wants them in one PDF; each becomes a page.`,
      "Choose the Page size, Orientation and Margin, or keep the ones shown. They set the page, not the file size.",
      `Under “${MAX_SIZE_LABELS.heading}”, choose ${listOr(LIMIT_PRESET_LABELS)}, or choose “${MAX_SIZE_LABELS.custom}” and type a whole number of KB.`,
      "Press Create PDF. With a limit, it can take a few seconds longer, because each step down is another PDF made and measured.",
      `Read the line on the result. “${LIMIT_MET_SENTENCE}” means it fits: press Download PDF.`,
      `If the line says the PDF is above your limit, take out an image. With more than one image, you can also choose ${PER_IMAGE_OUTPUT} under Output, so that each image gets a PDF, and a limit, of its own.`,
    ],
    sections: [
      {
        id: "how-the-limit-is-reached",
        heading: "How the limit is reached",
        body: [
          `The PDF is made first exactly as it would be with “${MAX_SIZE_LABELS.none}”. If that is already at or under your limit, it is what you get, untouched. If not, the images are saved again as JPEGs, starting at ${LIMIT_TOP_QUALITY_PCT}% quality and full size and stepping down, as far as ${LIMIT_LOW_QUALITY_PCT}% quality and ${LIMIT_LOW_SCALE_PCT}% of their width. The long side of an image is never made shorter than ${MIN_LONG_EDGE_PX} pixels.`,
          `After each step the whole PDF is made again and measured, and the first one at or under the limit is the one you get: the sharpest version that fits. A lower setting usually makes a smaller file, but not always, so nothing is assumed — every PDF is measured. An image whose saved-again copy would be bigger than the original keeps its original. At most ${MAX_LIMIT_ATTEMPTS} versions are made, within about ${LIMIT_BUDGET_S} seconds; if none fits, you get the smallest one that was made, and a line saying it is above your limit.`,
        ],
      },
      {
        id: "what-changes",
        heading: "What saving the image again changes",
        body: [
          "A smaller file means fewer pixels and stronger compression, so a saved-again photo looks softer, and fine print on a scanned certificate can blur. Check the PDF before you send it in; if the text is hard to read, try the largest limit the form allows.",
          "What the image file carried beside its pixels, such as the camera details, the date and any location, is not kept in a saved-again image. A PNG with transparent areas becomes a JPEG, which has none, so those areas are filled with white — the colour of the page, so it looks the same — and the line on the result says so.",
        ],
      },
      {
        id: "how-big-is-a-kb",
        heading: "How big is 100 KB, here and on the form",
        body: [
          `On this page 1 KB is ${KB_BYTES.toLocaleString("en-US")} bytes, so a ${LIMIT_100} limit means at most ${(100 * KB_BYTES).toLocaleString("en-US")} bytes — the same unit every size on the page is shown in. Some application portals count 1 KB as 1,000 bytes instead. If yours does, and is strict, choose “${MAX_SIZE_LABELS.custom}” and enter ${PORTAL_SAFE_100_KB} KB, which is under 100,000 bytes.`,
          "The PDF usually comes back a little under your limit rather than exactly on it, because the first version that fits is the one kept.",
        ],
      },
    ],
    faq: [
      {
        question: `Can I convert a JPG to a PDF of exactly ${LIMIT_100}?`,
        answer:
          "To at most that size, not to exactly it. You get the sharpest version at or under your limit, so the PDF usually comes back a little smaller than the number you chose.",
      },
      {
        question: "Why is my PDF still above the limit?",
        answer: `Because even the smallest version made was too big. That happens with many images in one PDF, or with a limit far below what a page can hold. Take out an image; with more than one image, ${PER_IMAGE_OUTPUT} applies the limit to each image's PDF on its own.`,
      },
      {
        question: "Will my photo look worse?",
        answer:
          "Only if it has to. A PDF that already fits keeps the photo exactly as it was. One that does not is made with a softer, smaller copy of the photo, the sharpest that fits.",
      },
      {
        question: "Is my photo sent to a server?",
        answer:
          "No. The image is shrunk and the PDF is made in your browser tab; the file is not sent to pdf.xyz.",
      },
      {
        question: "How large can my image be?",
        answer: `Up to ${MAX_IMAGE_MB} MB per image.`,
      },
    ],
    published: "2026-10-31",
    updated: "2026-10-31",
  },
  // Added 2026-10-31 for the "Bangla PDF to Word" search family. Written
  // only after production read a Bengali page back, measured: the proof is
  // `pnpm worker:prove-tools bengali-ocr` (a typed page of Bengali body
  // text, scanned clean and degraded, read by both tools, with an English
  // read of the same scans as the positive control), and its bars and why
  // are in `@/lib/probes/bengali-ocr-proof`. No accuracy figure is printed
  // here: no test pins one. The shape of the DOCX described below (the
  // scan's picture, then the text, a scanned line sometimes a paragraph of
  // its own) is what that run's DOCX held; the labels are the panels'
  // constants, the retention windows the ones the privacy page reads.
  {
    slug: "how-to-convert-bangla-pdf-to-word",
    title: "How to convert Bangla PDF to Word",
    description: `Turn a scanned ${BN} PDF into editable Word: our server reads the text with OCR.`,
    tools: ["pdf-to-word", "ocr-pdf"],
    keywords: [
      "bangla pdf to word",
      "bengali pdf to word",
      "bangla ocr",
      "convert bangla scan to word",
      "বাংলা pdf থেকে word",
      "বাংলা ocr",
    ],
    intro: [
      `To turn a scanned ${BN} PDF into a Word document you can edit, open ${nameOf("pdf-to-word")}, add the PDF, tick “${WORD_OCR_LABEL}”, select ${BN} under Languages, and press Export DOCX. Our server reads the ${BN} letters on each page with OCR (optical character recognition), then writes them into a DOCX file as text you can edit, copy and search.`,
      `Choosing ${BN} is the step that decides the result. ${describeOcrLanguage(DEFAULT_OCR_LANGUAGE)} is selected when the page opens, and a ${BN} page read as ${describeOcrLanguage(DEFAULT_OCR_LANGUAGE)} does not fail: it comes back as Latin letters that look like words and mean nothing, with no error.`,
      `This runs on our secure server, not in your browser. Our privacy policy says the uploaded file is deleted when the job ends, the result can be downloaded for ${RETENTION_WINDOWS.outputLink}, and the stored copy is erased by a daily storage rule some time after it is ${RETENTION_WINDOWS.outputStorageRule} old.`,
    ],
    steps: [
      `Open the ${nameOf("pdf-to-word")} tool and drop your scanned PDF where it says Add your PDF, or click to pick one. Files up to ${ceilingMb("pdf-to-word")} MB are accepted.`,
      `Tick “${WORD_OCR_LABEL}”. Without it, a scan has no text for the conversion to carry.`,
      `Under Languages, select ${BN}. If the page also has English words, such as names, addresses or technical terms, leave the ${describeOcrLanguage(DEFAULT_OCR_LANGUAGE)} chip on as well; if it has none, deselect ${describeOcrLanguage(DEFAULT_OCR_LANGUAGE)}.`,
      "Press Export DOCX, which uploads your PDF over an encrypted connection to our server, where the OCR and the conversion run in one job.",
      `Download the DOCX when it is ready. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, so save it right away.`,
      "Open it in Word, LibreOffice or Google Docs and read the text through against the page before you use it.",
    ],
    sections: [
      {
        id: "what-the-word-file-holds",
        heading: "What the Word file holds",
        body: [
          `Each scanned page comes through as its picture, followed by the ${BN} text read from it, as plain paragraphs you can edit. The words are real ${BN} text in Unicode, so you can search them, copy them into another document, or change them.`,
          "The look of the page is not rebuilt. Fonts, columns, tables and spacing are not carried over, and a line of the scan can come through as a paragraph of its own, so expect to join some lines and to style the headings yourself. Delete the picture once you no longer need it to compare against.",
          "Word picks its own Bengali font to display the text, such as Nirmala UI or Vrinda on Windows. If the letters show as empty boxes, the computer has no Bengali font installed; the text in the file is still correct, and it shows once a Bengali font is installed.",
        ],
      },
      {
        id: "getting-a-good-result",
        heading: "Getting a good result",
        body: [
          `OCR reads printed and typed ${BN}: books, letters, forms, office documents and newspaper pages. It is not made for handwriting, which usually comes back as nonsense or not at all.`,
          "The clearer the scan, the fewer mistakes. Scan in your scanner's document or text setting rather than a low-resolution preview, keep the page straight and flat, and avoid shadows, glare and blur if you photograph it with a phone.",
          "Even on a clean scan, read the result through. A misread usually changes one letter cluster, not a whole word: a vowel sign or a small mark such as the chandrabindu (ঁ) can be dropped, or a conjunct read as a similar one.",
        ],
      },
      {
        id: "searchable-pdf-instead",
        heading: "When you want a searchable PDF instead",
        body: [
          `If you need to find and copy ${BN} words in the document but not edit it, use ${nameOf("ocr-pdf")}: select ${BN} under Languages, choose ${ocrModeLabel("searchable-pdf")} under Output, and press Recognize text. The page looks exactly as before, with the recognised text laid invisibly under it.`,
          `If your scan is a JPG or PNG photo rather than a PDF, ${nameOf("ocr-pdf")} takes it as it is; for a Word file, turn the photo into a PDF first with ${nameOf("jpg-to-pdf")}.`,
        ],
      },
    ],
    faq: [
      {
        question: "Can I convert a Bangla PDF to Word for free?",
        answer: `Yes. There is no account and no payment: open ${nameOf("pdf-to-word")}, tick “${WORD_OCR_LABEL}”, select ${BN}, and download the DOCX.`,
      },
      {
        question:
          "Why does my Bangla text come out as English-looking gibberish?",
        answer: `Because the page was read with the wrong language. ${describeOcrLanguage(DEFAULT_OCR_LANGUAGE)} is selected when the page opens; select ${BN} under Languages and run the job again. A blurry or sideways scan can cause the same symptom.`,
      },
      {
        question: "My PDF already has selectable Bangla text. Do I need OCR?",
        answer: `No. If you can select the words in your PDF viewer and they paste as ${BN} letters, leave “${WORD_OCR_LABEL}” unticked and ${nameOf("pdf-to-word")} carries that text across as it is.`,
      },
      {
        question:
          "Why does text copied from my Bangla PDF paste as Latin letters?",
        answer: `Because the PDF was typed in an older, non-Unicode Bangla font, such as the SutonnyMJ fonts used with Bijoy, which stores ${BN} letters as Latin ones. The conversion carries that text across exactly as stored, and OCR does not replace it: pages that already have text are kept as they are. One way round it is to make the pages pictures first, with ${nameOf("pdf-to-jpg")} and then ${nameOf("jpg-to-pdf")}, and convert that PDF with “${WORD_OCR_LABEL}” ticked.`,
      },
      {
        question: "Can it read handwritten Bangla?",
        answer:
          "No. The OCR is made for printed and typed text; handwriting usually comes back as nonsense or not at all.",
      },
      {
        question: "Is my file uploaded?",
        answer: `Yes. OCR needs a recognition engine that runs on our secure server, so your PDF is uploaded over an encrypted connection. The uploaded file is deleted when the job ends, and the result can be downloaded for ${RETENTION_WINDOWS.outputLink}.`,
      },
    ],
    published: "2026-10-31",
    updated: "2026-10-31",
  },
  {
    slug: "how-to-convert-excel-to-pdf",
    title: "How to convert Excel to PDF",
    description:
      "Turn an Excel workbook or CSV file into a PDF with LibreOffice on a secure server that deletes your file after the job. No account needed.",
    tools: ["excel-to-pdf", "merge-pdf", "word-to-pdf"],
    keywords: [
      "how to convert excel to pdf",
      "excel to pdf",
      "xlsx to pdf",
      "xls to pdf",
      "csv to pdf",
      "save spreadsheet as pdf",
    ],
    intro: [
      `To convert an Excel spreadsheet to PDF, open ${nameOf("excel-to-pdf")}, add your .xlsx, .xls or .csv file, press Convert to PDF, and download the result. Anyone can open, print or file the PDF without owning Excel, and nobody can overtype a cell by accident.`,
      "The PDF is a printout of your spreadsheet, not a working copy of it. Each formula cell shows the figure it displayed when the file was opened, and nothing in the PDF recalculates later. The pages are laid out by LibreOffice, the open-source office suite, using the page setup saved in your workbook.",
      `${nameOf("excel-to-pdf")} runs on a secure server. Your spreadsheet, up to ${ceilingMb("excel-to-pdf")} MB, travels over an encrypted connection and is deleted when the job ends; the download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes. No account is needed.`,
    ],
    steps: [
      `Open the ${nameOf("excel-to-pdf")} tool.`,
      "Before you start, set the page layout in Excel if a wide sheet must fit: choose landscape and fit-all-columns-on-one-page scaling, then save. The tool has no layout settings of its own.",
      "Drag your .xlsx, .xls or .csv onto the box that says “Add your document, or browse”, or click it to choose the file. Remove swaps it for another.",
      "Press Convert to PDF. Your spreadsheet uploads over an encrypted connection, and the button follows the job while LibreOffice converts it.",
      `When “Your PDF is ready.” appears, press Download. The link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, so save the PDF before you close the tab.`,
    ],
    sections: [
      {
        id: "how-the-pages-are-laid-out",
        heading: "How the pages are laid out",
        body: [
          "The converter gets your file and no settings at all. Orientation, scaling and where wide columns break onto a new page come from the page setup saved in the workbook, and LibreOffice's defaults fill in the rest. So if columns spill onto extra pages or the text comes out tiny, fix it in your spreadsheet app: set landscape and fit-to-width scaling, save, and convert again.",
          "A CSV file is plain text and cannot store any page setup, so it always gets the default layout and plain formatting. If a CSV export needs to fit the page, open it in your spreadsheet app, set the layout, save it as .xlsx and convert that copy.",
        ],
      },
      {
        id: "what-carries-over",
        heading: "Formulas, sheets and macros",
        body: [
          "Formulas do not come across as formulas. Each cell is printed as the result it shows, which suits a month-end report or an audit folder: later edits to the workbook never change the PDF.",
          "There is no sheet picker, so the whole workbook goes to the converter. To send just one sheet, copy it into a new workbook and convert that. A macro-enabled .xlsm is refused as soon as you add it, before anything uploads; save a copy as .xlsx first.",
          `${nameOf("excel-to-pdf")} converts one spreadsheet per job. To hand over several as a single file, convert each one, then combine the PDFs with ${nameOf("merge-pdf")}. For Word documents, ${nameOf("word-to-pdf")} works the same way.`,
        ],
      },
      {
        id: "where-your-file-goes",
        heading: "Where your spreadsheet goes",
        body: [
          `The conversion does not happen on your computer. Your spreadsheet travels over an encrypted connection to our secure server, is kept only for its job, and is deleted when that job ends, whether it worked or not. The finished PDF's download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and a daily storage rule erases the stored copy after that.`,
          `The page fetches the PDF as soon as it is ready, so the Download button saves the copy already in your tab. Files over ${ceilingMb("excel-to-pdf")} MB are refused when you add them, before anything is uploaded.`,
        ],
      },
    ],
    faq: [
      {
        question: "Can I choose which sheets go into the PDF?",
        answer:
          "Not on this page: there is no sheet picker, and the whole workbook goes to the converter. Copy the sheet you want into a new workbook and convert that.",
      },
      {
        question: "Why are my columns split across pages?",
        answer:
          "Because the converter follows the workbook's own page setup and has no layout options. In Excel or LibreOffice Calc, set landscape and fit-all-columns-on-one-page scaling, save, and convert again. A CSV stores no page setup, so save it as .xlsx first.",
      },
      {
        question: "Which files can I convert?",
        answer: `Excel workbooks in .xlsx or the older .xls format, and CSV files, one per conversion, up to ${ceilingMb("excel-to-pdf")} MB. A macro-enabled .xlsm is refused; save a copy as .xlsx and convert that.`,
      },
      {
        question: "Can I convert a password-protected workbook?",
        answer:
          "No. The page has no password field, so a workbook that asks for a password to open cannot be converted. Remove the password in your spreadsheet app, save a copy, and convert the copy.",
      },
      {
        question: "Is my spreadsheet uploaded?",
        answer: `Yes. It travels over an encrypted connection to our secure server, which deletes it when the conversion job ends. The PDF's download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and a daily storage rule erases the stored copy.`,
      },
    ],
    published: "2026-10-31",
    updated: "2026-10-31",
  },
  {
    slug: "how-to-convert-powerpoint-to-pdf",
    title: "How to convert PowerPoint to PDF",
    description:
      "Turn a .pptx or .ppt deck into a PDF with one slide per page, made by LibreOffice on a secure server that deletes your file after the job.",
    tools: ["powerpoint-to-pdf", "merge-pdf", "word-to-pdf"],
    keywords: [
      "how to convert powerpoint to pdf",
      "powerpoint to pdf",
      "pptx to pdf",
      "ppt to pdf",
      "save slides as pdf",
      "convert presentation to pdf",
    ],
    intro: [
      `To convert a PowerPoint presentation to PDF, open ${nameOf("powerpoint-to-pdf")}, add your .pptx or .ppt file, press Convert to PDF, and download the result. You get one slide per page, and anyone can open it without PowerPoint.`,
      "Each page keeps the slide's shape, so a widescreen deck is not squeezed onto a paper size. Text typed into text boxes stays text you can search and copy; words inside a picture stay part of the picture.",
      `${nameOf("powerpoint-to-pdf")} runs on a secure server. Your deck, up to ${ceilingMb("powerpoint-to-pdf")} MB, travels over an encrypted connection and is deleted when the job ends; the download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes. No account is needed.`,
    ],
    steps: [
      `Open the ${nameOf("powerpoint-to-pdf")} tool.`,
      "In PowerPoint, unhide any slide you want in the PDF and save. Hidden slides and speaker notes are left out.",
      "Drag your .pptx or .ppt onto the box that says “Add your document, or browse”, or click it to choose the file. Remove swaps it for another.",
      "Press Convert to PDF. The deck uploads over an encrypted connection, and the button follows the job while LibreOffice converts it.",
      `When “Your PDF is ready.” appears, press Download. The link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, so save the PDF before you close the tab.`,
      "Skim the pages before you send them: a missing font or an elaborate effect can come out slightly different.",
    ],
    sections: [
      {
        id: "what-the-pdf-looks-like",
        heading: "What the PDF looks like",
        body: [
          "The slides are drawn by LibreOffice, the open-source office suite, not by Microsoft PowerPoint, using its standard PDF settings. The result is usually close to what you see in PowerPoint, but not pixel for pixel: a font our server lacks is swapped for a stand-in, which can move a line break or overflow a text box, and complex effects or some SmartArt may be drawn differently.",
          "Animations do not carry over, so bullet points that appeared one click at a time all show together. Speaker notes and slides marked hidden are not exported, and the page has no option to add them.",
        ],
      },
      {
        id: "several-decks-and-other-formats",
        heading: "Several decks, and other presentation apps",
        body: [
          `The tool converts one presentation per job. For a workshop handout, convert each deck in turn, then combine the PDFs with ${nameOf("merge-pdf")}. Word documents go through ${nameOf("word-to-pdf")} the same way.`,
          "Only PowerPoint files are accepted; any other type is refused before anything is uploaded. From Google Slides, download the deck as a Microsoft PowerPoint file first. From Keynote, export it to PowerPoint, then convert that file here.",
        ],
      },
      {
        id: "where-your-deck-goes",
        heading: "Where your deck goes",
        body: [
          `Your presentation travels over an encrypted connection to our secure server and is deleted when the job finishes, whether it worked or not. The finished PDF's download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and a daily storage rule erases the stored copy after that.`,
          `A deck over ${ceilingMb("powerpoint-to-pdf")} MB is refused as soon as you pick it, before anything is uploaded. Decks that big usually carry large photos or video; PowerPoint's Compress Pictures command can shrink them before you try again.`,
        ],
      },
    ],
    faq: [
      {
        question: "Are speaker notes included?",
        answer:
          "No. The PDF has the slides only, one per page, and the page has no option to add notes. Hidden slides are left out too, so unhide any you want before converting.",
      },
      {
        question: "Why do some slides look different in the PDF?",
        answer:
          "LibreOffice, not PowerPoint, draws the slides. A font our server does not have is replaced by a substitute, which can move line breaks, and some effects and SmartArt may be drawn differently. Check the pages before you send them.",
      },
      {
        question: "Can I convert a password-protected presentation?",
        answer:
          "No. The page has no password field, so a deck that needs a password to open cannot be converted. Remove the password in PowerPoint, save an unprotected copy, and convert that.",
      },
      {
        question: "How big can the presentation be?",
        answer: `Up to ${ceilingMb("powerpoint-to-pdf")} MB, one deck per conversion. A bigger file is refused when you pick it, before it is uploaded.`,
      },
      {
        question: "Is my presentation uploaded?",
        answer: `Yes. It travels over an encrypted connection to our secure server, which deletes it when the job finishes. The PDF's download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and a daily storage rule erases the stored copy.`,
      },
    ],
    published: "2026-10-31",
    updated: "2026-10-31",
  },
  {
    slug: "how-to-extract-pages-from-a-pdf",
    title: "How to extract pages from a PDF",
    description:
      "Save just the pages you need as a new PDF by clicking thumbnails or typing a range, right in your browser, so the file never leaves your device.",
    tools: ["extract-pages", "split-pdf", "remove-pages"],
    keywords: [
      "how to extract pages from a pdf",
      "extract pages from pdf",
      "save pages of a pdf as a new file",
      "pull pages out of a pdf",
      "select pages from pdf",
    ],
    intro: [
      `To extract pages from a PDF, open ${nameOf("extract-pages")}, pick your file, select the pages you want, and download them as a new PDF. Every page appears as a thumbnail, so you can see exactly what you are keeping.`,
      `The work happens in your browser: the PDF stays on your device from start to finish, and there is no account to create. Your original is never changed, and the new file is named after it with -extracted added. Files up to ${ceilingMb("extract-pages")} MB are accepted.`,
      `This guide covers the ways to select pages, what the new file keeps, and when ${nameOf("split-pdf")} or ${nameOf("remove-pages")} is the better fit.`,
    ],
    steps: [
      `Open the ${nameOf("extract-pages")} tool.`,
      "Pick the PDF, or drop it on the dashed area. It stays on your device, and a grid of page thumbnails fills in.",
      "Click each page you want to keep. Hold Shift and click to select a whole run of pages at once.",
      "Or type the pages as a list, such as 1-3, 5, and press Select.",
      "Press the button under the pages to build the new file on your device. It counts your selection, so it reads Extract 4 pages when four are chosen.",
      "Press Download PDF to save the new file, or Start over to load another document.",
    ],
    sections: [
      {
        id: "selecting-pages",
        heading: "Ways to select pages",
        body: [
          "Clicking a thumbnail selects that page, and clicking it again deselects it. Holding Shift while you click selects every page between the one you touched last and this one.",
          `In a long document, typing is faster. Enter single pages and ranges separated by commas, such as 1-3, 5, and press Select. A range can be left open: 8- runs from page eight to the end. To keep every other page, list them: ${EVERY_OTHER_PAGE_EXAMPLE}. Typing a list replaces the current selection, and you can fine-tune it by clicking thumbnails afterwards.`,
          "Select all, Clear and Invert change the whole selection at once. Invert is handy when it is easier to click the few pages you do not want: select those, press Invert, and extract the rest.",
        ],
      },
      {
        id: "what-the-new-file-keeps",
        heading: "What the new file keeps",
        body: [
          pageToolKeeps("subset"),
          "The new PDF always follows the original page order, so picking page 9 before page 2 still gives you 2, then 9. Pages are copied as they are rather than redrawn, so text stays selectable and images are not recompressed.",
          "A link from a kept page to a page you left out is switched off, so the skipped page is not copied as a page. Two things can still come along. When a file's pages share one list of resources, as some programs write them, an image drawn only on a left-out page can still sit inside the new file, unseen; if it must not travel, black it out with Redact PDF first. And text you can see is copied as it is, so a contents page still lists sections you did not keep.",
        ],
      },
      {
        id: "related-tools",
        heading: "When another tool fits better",
        body: [
          `${nameOf("extract-pages")} always makes one combined file. To cut a document into several files, such as one per chapter or one per page, use ${nameOf("split-pdf")}; more than one piece downloads as a ZIP.`,
          `If it is quicker to name the pages to throw away, ${nameOf("remove-pages")} is the mirror image: select the pages to remove and download what is left. Both run in your browser as well.`,
        ],
      },
    ],
    faq: [
      {
        question: "Is my PDF sent to a server when I extract pages?",
        answer:
          "No. Extract Pages runs entirely in your browser, and the file stays on your device from start to finish.",
      },
      {
        question: "Can I put the extracted pages in a different order?",
        answer:
          "Not in this tool: the new PDF follows the original order whatever order you click in. Use Organize Pages afterwards if you need to rearrange them.",
      },
      {
        question: "Does the new PDF keep bookmarks and form fields?",
        answer: pageToolKeepsAnswer("subset"),
      },
      {
        question: "How do I save each page as its own PDF?",
        answer: `Use ${nameOf("split-pdf")} instead. ${nameOf("extract-pages")} always produces one file; Split PDF can make one file per page and gives you the pieces as a ZIP.`,
      },
      {
        question: "Why won't my PDF open?",
        answer: `The message on screen names the cause. A file over ${ceilingMb("extract-pages")} MB is too large. An encrypted PDF has to be unlocked first, even one that only restricts printing or copying; if you know the password, Unlock PDF makes a decrypted copy you can bring back here. Unlike this tool, Unlock PDF runs on our secure server rather than in your browser.`,
      },
    ],
    published: "2026-10-31",
    updated: "2026-10-31",
  },
  {
    slug: "how-to-summarize-a-pdf",
    title: "How to summarize a PDF with AI",
    description:
      "Get an AI summary of a PDF as paragraphs, bullet points or an outline, brief to detailed, with an optional focus. No account needed.",
    tools: ["summarize-pdf", "ocr-pdf", "translate-pdf"],
    keywords: [
      "how to summarize a pdf",
      "summarize pdf",
      "ai pdf summarizer",
      "pdf summary",
      "summarize a pdf online",
      "tl;dr of a pdf",
    ],
    intro: [
      `To summarize a PDF, open ${nameOf("summarize-pdf")}, add your file, choose a length and a format, and press Summarize PDF. An AI model writes a summary of the document's text, and you download it as a ZIP with Markdown and plain-text copies.`,
      "Use the summary to decide what to read, not in place of reading. The model is told to work only from the document's text and to add no facts, yet a summary can still leave a point out or get one wrong, so check anything you plan to act on against the original pages.",
      `${nameOf("summarize-pdf")} is one of the AI tools, so the work does not happen in your browser. Your PDF uploads over an encrypted connection to our secure server, which extracts the selectable text and sends that text, not the file, to a third-party AI provider. Your PDF is deleted when the job ends, and the download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes. No account is needed.`,
    ],
    steps: [
      `Open the ${nameOf("summarize-pdf")} tool.`,
      "Drop your PDF on the box that says “Add your PDF, or browse”, or click it to choose the file. It takes one PDF with selectable text; for a scan, run OCR PDF first.",
      `Pick a length under Summary length (${listOr(Object.values(SUMMARY_LENGTH_LABEL))}) and a shape under Format (${SUMMARY_FORMAT_NAMES}). The page starts on ${SUMMARY_LENGTH_LABEL[DEFAULT_SUMMARY_LENGTH]} and ${SUMMARY_FORMAT_LABEL[DEFAULT_SUMMARY_FORMAT]}.`,
      `Optionally, type up to ${SUMMARY_FOCUS_CHARS} characters in Focus (optional), such as “deadlines and costs”, to say what the summary should pay attention to.`,
      "Press Summarize PDF. Your PDF uploads over an encrypted connection to our secure server, and the button follows the job while the model writes.",
      `Download the ZIP; report.pdf comes back as ${SUMMARY_EXAMPLE_ZIP}. The link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, so save it to your device.`,
    ],
    sections: [
      {
        id: "choosing-length-and-format",
        heading: "Choosing a length, a format and a focus",
        body: [
          "Brief asks for a short TL;DR followed by the key points, which suits a report you need to grasp before a meeting. Standard covers the main points, and Detailed works through every major section.",
          `The format sets the shape: ${SUMMARY_FORMAT_NAMES}. A section outline under headings is useful for comparing several papers side by side. The focus line asks the model to pay special attention to what you name, such as payment terms or risks; leave it empty for a general summary.`,
          `The model is told to write in the document's own language, so a Spanish report should come back summarized in Spanish. There is no setting for a different summary language; for the full text in another language, use ${nameOf("translate-pdf")}.`,
        ],
      },
      {
        id: "what-you-get-back",
        heading: "What you get back",
        body: [
          "The download is a ZIP holding summary.md, summary.txt, manifest.json and README.txt. The Markdown and plain-text files hold the same summary; the manifest and README record which provider and model wrote it and the options you chose.",
          `The model reads a bounded amount of the document's text, and the exact figure is stated on the Summarize PDF page itself. A longer document is summarized from its first page up to that point, and both the results panel and summary.md say how far the reading got, by page. Files themselves are capped at ${ceilingMb("summarize-pdf")} MB.`,
        ],
      },
      {
        id: "allowance-and-privacy",
        heading: "The free allowance and where your text goes",
        body: [
          `Summaries are free, within a daily allowance. ${aiAllowanceFactFor("summarize-pdf")} The charge is taken when the job is submitted, so a job our server refuses or that fails still uses it.`,
          "Our server sends the PDF's extracted text, with your length, format and focus, to a third-party AI provider; the PDF file itself is never sent to the provider. The settings in our provider account that would let it use this text to improve its models are switched off, though the provider may keep what it receives for a limited time to watch for abuse. Section 3 of our privacy policy covers the provider's side.",
        ],
      },
      {
        id: "scanned-pdfs-need-ocr-first",
        heading: "Scanned PDFs need OCR first",
        body: [
          `The tool reads only text stored in the PDF as text. A scan is a picture of text, so a PDF with no text layer is turned away with a message pointing you to ${nameOf("ocr-pdf")}. Your browser checks for text before the upload starts, so that refusal takes nothing from the allowance.`,
          `Run the scan through ${nameOf("ocr-pdf")} with the document's language selected, then bring the result back to ${nameOf("summarize-pdf")}.`,
        ],
      },
    ],
    faq: [
      {
        question: "Is the AI summary accurate?",
        answer:
          "Treat it as a reading aid. The model is told to use only the document's text and add no facts, figures or names, but a summary can still leave out a point or state it wrongly. Check anything you plan to rely on against the original pages.",
      },
      {
        question: "How many PDFs can I summarize for free?",
        answer: aiAllowanceFactFor("summarize-pdf"),
      },
      {
        question: "Who sees the text of my PDF?",
        answer: `A third-party AI provider receives the extracted text and your options; the PDF file never reaches it. Our server deletes your PDF when the job ends, and the download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes.`,
      },
      {
        question: "How long a PDF can it summarize?",
        answer: `Files up to ${ceilingMb("summarize-pdf")} MB can be added, and the model reads a bounded amount of their text, stated on the Summarize PDF page. Past that, the summary covers the opening pages, and the result says how far the reading got.`,
      },
      {
        question: "Can it summarize a scanned PDF?",
        answer: `Not directly. Run it through ${nameOf("ocr-pdf")} first to add a text layer, then summarize the result. A PDF with no text is refused before it uploads, so it costs nothing from the allowance.`,
      },
    ],
    published: "2026-10-31",
    updated: "2026-10-31",
  },
  {
    slug: "how-to-convert-pdf-to-pdfa",
    title: "How to convert a PDF to PDF/A",
    description: `Convert a PDF to ${PDF_A_STANDARD} for archiving with Ghostscript on a secure server, and read what it had to drop before you download. No account needed.`,
    tools: ["pdf-to-pdfa", "ocr-pdf", "unlock-pdf"],
    keywords: [
      "how to convert pdf to pdf/a",
      "pdf to pdf/a",
      "convert pdf to pdfa",
      "pdf/a-2b",
      "save pdf as pdf/a",
      "archive pdf",
    ],
    intro: [
      `To convert a PDF to PDF/A, open ${nameOf("pdf-to-pdfa")}, add your PDF, press Convert to PDF/A, read any notes, and download the copy. PDF/A is the archiving form of PDF, meant for documents that must still open and look the same years from now, and every job here targets ${PDF_A_STANDARD}.`,
      "The copy is rewritten by Ghostscript, the open-source PDF engine, with its PDF/A-2 setting switched on. Conformance level b (basic) is about how the pages look; the tagged structure that level a requires is not added. Nothing checks the result against the PDF/A specification afterwards, so treat it as a best-effort conversion, not a certificate.",
      `${nameOf("pdf-to-pdfa")} runs on a secure server, because that is where Ghostscript is installed. Your PDF, up to ${ceilingMb("pdf-to-pdfa")} MB, travels over an encrypted connection and is deleted once the job is over; the download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes. No account is needed.`,
    ],
    steps: [
      `Open the ${nameOf("pdf-to-pdfa")} tool. The badge at the top reads Secure server when conversion is available; otherwise Convert to PDF/A stays off and nothing is sent.`,
      "Drop one PDF on the area that says “Add a PDF, or browse”, or click it to choose the file. Remove, beside its name, swaps it for another.",
      "Press Convert to PDF/A. Your PDF uploads over an encrypted connection to our secure server, and the button follows the job while Ghostscript rewrites it.",
      "If Ghostscript reported anything, “What PDF/A could not keep” lists it above “Your PDF/A file is ready.” Read it before you replace your original.",
      `Press Download to save the copy: report.pdf comes back as ${PDFA_EXAMPLE_OUT}. The link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, so save it before you close the tab.`,
      "If an archive or portal asked for PDF/A, check the copy with its own checker before you submit it.",
    ],
    sections: [
      {
        id: "what-the-conversion-drops",
        heading: "What the conversion drops, and how you find out",
        body: [
          "Some of what a PDF can carry has no place in PDF/A. Ghostscript is told to drop it and carry on rather than abandon the job, and what it reports while doing so is shown above your download in its own words, with any line that names a file path held back. The line you are most likely to meet ends in “discarding DOCINFO”: DOCINFO is the older place a PDF keeps its title, author and producer, and the notice does not say which fields went, so open the copy's document properties if they matter.",
          "PDF/A also requires every font to be embedded. Where your original only names a font without carrying it, Ghostscript uses one from its own set; on our secure server, NimbusSans was seen standing in for Helvetica. The notes do not report that swap, so compare the copy with the original page by page before you rely on it.",
        ],
      },
      {
        id: "what-is-checked",
        heading: "What is checked, and what is not",
        body: [
          `Before the copy is returned, our server checks that it is not empty, that it has a PDF header and end-of-file marker, and that it declares ${PDF_A_STANDARD}: PDF/A identification part ${PDFA_EXPECTED_PART} and conformance ${PDFA_EXPECTED_CONFORMANCE} in its metadata, plus an embedded colour profile. If either declaration is missing, no file is returned.`,
          "A declaration is not proof of conformance. If a university repository, court or records system needs PDF/A, run its own checker, or an independent validator such as veraPDF, on the copy. There is no level picker either: a portal that names PDF/A-1b or PDF/A-3b needs other software.",
        ],
      },
      {
        id: "scans-and-passwords",
        heading: "Scans, passwords and damaged files",
        body: [
          `Converting a scan to PDF/A does not make its text searchable: a scanned page stays a picture of words. Run it through ${nameOf("ocr-pdf")} first, which adds a searchable text layer on our secure server, then convert that file and search the PDF/A copy to confirm the words survived.`,
          `The page has no password field, so Ghostscript is never given one. If your file asks for a password when it opens, ${nameOf("unlock-pdf")} removes it once you enter that password; then convert the unlocked copy. The PDF/A copy is written without encryption, which PDF/A does not allow in any case.`,
          "Our server first looks for a PDF header at the start of your file and an end-of-file marker near its end. A file missing either, such as a download that stopped partway, is refused as one that could not be read as a PDF, and nothing is produced.",
        ],
      },
      {
        id: "where-your-pdf-goes",
        heading: "Where your PDF goes",
        body: [
          `Your PDF travels over an encrypted connection to our secure server, where Ghostscript works in a temporary folder that a cleanup step deletes whether or not the conversion worked. The stored upload is deleted once the job ends, or held for a retry if the job hit a temporary error. The PDF/A copy's download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and a daily storage rule erases the stored copy after that.`,
        ],
      },
    ],
    faq: [
      {
        question: "Will the converted file pass a PDF/A validator?",
        answer: `It targets ${PDF_A_STANDARD}, but pdf.xyz runs no PDF/A validator. Our server checks that the copy declares the standard and carries a colour profile, and returns no file if it does not; a declaration is not proof, so check the copy with the validator your archive uses.`,
      },
      {
        question: "Can I convert to a different PDF/A level?",
        answer: `No. There is no level picker, and every conversion targets ${PDF_A_STANDARD}. If an archive asks for another level, such as PDF/A-1b or PDF/A-3b, you need software that offers it.`,
      },
      {
        question: "What does “discarding DOCINFO” mean?",
        answer:
          "Ghostscript found text in the PDF's older information dictionary, where the title, author and producer live, that it could not carry into PDF/A's metadata, and dropped that dictionary. It does not list which fields went, so check the copy's document properties if the title or author matters.",
      },
      {
        question: "Does PDF/A make a scanned PDF searchable?",
        answer: `No. A scanned page stays a picture of text. Run the scan through ${nameOf("ocr-pdf")} first, then convert the result and search the PDF/A copy to check the words came through.`,
      },
      {
        question: "Is my PDF uploaded?",
        answer: `Yes. Ghostscript runs on our secure server, so the PDF travels there over an encrypted connection and is deleted once the job ends. The PDF/A copy's download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and a daily storage rule erases the stored copy.`,
      },
    ],
    published: "2026-10-31",
    updated: "2026-10-31",
  },
  {
    slug: "how-to-convert-pdf-to-png",
    title: "How to convert a PDF to PNG images",
    description: `Save PDF pages as lossless PNG images at ${RASTER_RESOLUTION_DPIS} DPI, every page or only the ones you pick, in colour or grayscale. Your PDF stays on your device.`,
    tools: ["pdf-to-png", "pdf-to-jpg", "extract-images"],
    keywords: [
      "how to convert pdf to png",
      "pdf to png",
      "convert pdf to png",
      "save pdf page as png",
      "pdf to png high resolution",
      "pdf page to image",
    ],
    intro: [
      `To convert a PDF to PNG, open ${nameOf("pdf-to-png")}, add your PDF, choose a resolution, and press the Render button. Each page becomes one PNG picture of the whole page, with its text, drawings and photos together. A single page downloads as one PNG; more than one arrives as a ZIP.`,
      "PNG is lossless: every pixel is kept exactly, so small type and thin lines keep clean edges instead of the smudges JPEG compression can leave around them. The cost is larger files, and as with any picture of a page, the words in it can no longer be selected or searched.",
      `The pages are drawn in your browser by pdf.js, a PDF renderer bundled with the site, so your PDF stays on your device and there is no account to create. Each PDF can be up to ${ceilingMb("pdf-to-png")} MB.`,
    ],
    steps: [
      `Open the ${nameOf("pdf-to-png")} tool.`,
      "Drop your PDF on the panel that says “Drop your PDF here, or browse”, or click it to choose the file. Its name, page count and size appear once it has loaded.",
      `Under Resolution, pick ${RASTER_RESOLUTION_CHOICES}.`,
      `Under Pages, keep All pages, or click Select pages and type the pages you want, such as 1-3, 5. Under Colour, keep ${PNG_COLOUR} or pick ${PNG_GRAY}.`,
      "Press the Render button. It counts the pages it will draw, so it reads Render 3 pages when three are chosen, and a progress count follows each page.",
      `Press Download PNG for a single page, or Download ZIP when there are several. Each of the first ${RASTER_PREVIEW_LIMIT} pages also has its own download button on its preview.`,
    ],
    sections: [
      {
        id: "choosing-a-resolution",
        heading: "Choosing a resolution",
        body: [
          `DPI is how many pixels each inch of the page becomes. ${presetText(PNG_SCREEN)} suits a page read on a monitor or in a chat, ${presetText(rasterPreset("high"))} is a sharper all-rounder, and ${presetText(PNG_PRINT)} is for printing or zooming in on small print. Doubling the DPI roughly quadruples the pixels on a page, so files grow and rendering slows.`,
          `${DEFAULT_RESOLUTION_LABEL} is selected the first time you use the tool. After that, this browser remembers the resolution and colour you last rendered with in ${nameOf("pdf-to-png")} or ${nameOf("pdf-to-jpg")}, and a PDF of more than ${LARGE_RASTER_PAGES} pages opens at ${PNG_SCREEN.label}, with a note saying why: every page is held in memory as an image, and a long document at a high resolution is the job most likely to run a browser tab out of memory. You can still pick another resolution before you render.`,
          `Neither side of a page image may exceed ${PNG_MAX_PX} pixels. At ${PNG_PRINT.label}, a page longer than ${PNG_PRINT_CAP_IN} inches on a side, such as a poster or a drawing, is rendered below the preset rather than failing, and the result says what resolution it got.`,
        ],
      },
      {
        id: "pages-and-colour",
        heading: "Choosing pages and colour",
        body: [
          `Select pages takes single pages and ranges separated by commas, the same way ${nameOf("extract-pages")} reads them: 1-3, 5 gives four pages, and 8- runs from page eight to the end. Only those pages are rendered, and the Render button counts them.`,
          `${PNG_GRAY} draws the pages in shades of gray instead of ${PNG_COLOUR.toLowerCase()}. The files are still ordinary PNGs holding gray pixels, not one-channel grayscale images. If you need a gray PDF rather than images, ${nameOf("grayscale-pdf")} makes one.`,
        ],
      },
      {
        id: "what-you-download",
        heading: "What you download",
        body: [
          `A one-page PDF saves as a single image named after the file: logo.pdf gives ${PNG_EXAMPLE_SINGLE}. With more than one page rendered, the images come in one ZIP, numbered with leading zeros so they sort in reading order: all pages of a ${PNG_EXAMPLE_PAGES}-page manual.pdf give ${PNG_EXAMPLE_ZIP}, starting with ${PNG_EXAMPLE_FIRST}. A page keeps its number from the document when you pick only some, so page 7 of that manual is ${PNG_EXAMPLE_PAGE_7}.`,
          "Pages are painted onto white, so every PNG has a solid white background. If a picture inside the PDF cannot be decoded, it comes out blank while the rest of the page renders, and the result gives the number of images affected across the document.",
        ],
      },
      {
        id: "png-jpg-or-embedded-images",
        heading: "PNG, JPG, or the images inside the PDF",
        body: [
          `PNG suits text, line drawings, charts and screenshots. For photo-heavy pages, ${nameOf("pdf-to-jpg")} usually makes smaller files, with the same resolution and page choices.`,
          `Both draw whole pages. To save the photos embedded in a PDF at their own resolution instead of pictures of whole pages, use ${nameOf("extract-images")}, which also runs in your browser.`,
        ],
      },
    ],
    faq: [
      {
        question: "Is my PDF sent anywhere when I convert it to PNG?",
        answer:
          "No. pdf.js draws the pages inside your browser tab and the PNG files are made there too, so the PDF stays on your device from start to finish.",
      },
      {
        question: "Is PNG or JPG better for PDF pages?",
        answer: `PNG is lossless, which suits text, line drawings and flat colour. JPEG is built for photographs and usually makes smaller files from photo-heavy pages; ${nameOf("pdf-to-jpg")} offers the same resolutions. Neither keeps the text selectable.`,
      },
      {
        question: "Can I convert just one page?",
        answer: `Yes. Click Select pages under Pages and type its number. A single page downloads on its own as a PNG and keeps its page number in the file name, as in ${PNG_EXAMPLE_PAGE_7}.`,
      },
      {
        question: "Why does my PNG have fewer pixels than the DPI I chose?",
        answer: `Because the page is large. No side of an image may pass ${PNG_MAX_PX} pixels, so at ${PNG_PRINT.label} a page longer than ${PNG_PRINT_CAP_IN} inches is rendered lower, and the result panel says at what DPI.`,
      },
      {
        question: "Can it convert a password-protected PDF?",
        answer: `Not one that needs a password to open: it stops while loading and asks you to unlock it first. ${nameOf("unlock-pdf")} removes the password if you know it, but it runs on our secure server rather than in your browser. A PDF that opens without a password and only restricts printing or copying converts like any other.`,
      },
    ],
    published: "2026-10-31",
    updated: "2026-10-31",
  },
  {
    slug: "how-to-convert-pdf-to-text",
    title: "How to convert a PDF to text",
    description:
      "Copy the selectable text out of a PDF into a plain UTF-8 .txt file, preview it before you save, and see which pages had none. Your PDF stays on your device.",
    tools: ["pdf-to-text", "ocr-pdf", "pdf-to-markdown"],
    keywords: [
      "how to convert pdf to text",
      "pdf to text",
      "pdf to txt",
      "extract text from pdf",
      "copy text from pdf",
      "save pdf as text file",
    ],
    intro: [
      `To convert a PDF to text, open ${nameOf("pdf-to-text")}, add your PDF, press Extract text, check the preview, and press Download TXT. You get the words stored in the PDF as a plain UTF-8 .txt file, without fonts, pictures or layout.`,
      `It reads only the text a PDF stores as text, the kind you can select in a viewer. A scanned page is a picture of words, so it gives nothing until ${nameOf("ocr-pdf")} has recognised them.`,
      `The text is read in your browser by pdf.js, so your PDF stays on your device and there is no account to create. It takes one PDF at a time, up to ${ceilingMb("pdf-to-text")} MB, and there are no settings to choose.`,
    ],
    steps: [
      `Open the ${nameOf("pdf-to-text")} tool.`,
      "Drop your PDF on the panel that says “Drop your PDF here, or browse”, or click it to choose the file. Its name, page count and size appear.",
      "Press Extract text. The button reads Extracting text… while the pages are read.",
      "Under “Text extracted”, check the character and page counts and read the text in the scrollable box. Select any part of it to copy just that passage.",
      `Press Download TXT, which shows the size of the file it will save. report.pdf is saved as ${TEXT_EXAMPLE_OUT}. Start over clears the page for another document.`,
    ],
    sections: [
      {
        id: "what-the-file-holds",
        heading: "What the text file holds",
        body: [
          "A PDF records where each run of text sits on the page rather than where its lines end, so the extractor works the breaks out from positions: a new line where the text drops down the page, and a space where the gap between letters is wide enough to be one. Pages are separated by one blank line, and no page numbers or markers are added. Typefaces, bold, colour, pictures and ruled lines are left behind.",
          "The file is UTF-8, so any script comes through as long as the PDF maps its letters back to characters. A font embedded without that map gives wrong characters or none, and this tool cannot repair them.",
        ],
      },
      {
        id: "reading-order",
        heading: "Reading order, columns and tables",
        body: [
          "Where a PDF stores its text out of step with the page, the extractor puts it back in reading order: a heading stored after the text under it, a running header stored last, or a page number stored first is moved to where it reads. A page stored a column at a time comes out a column at a time, and a page with rotated or vertical text keeps the order stored in the file.",
          "Horizontal alignment is lost. Columns and table cells come out as plain text, split by spaces and line breaks, so a table will not line up in a text editor.",
          `If you want paragraphs and obvious list lines kept as Markdown instead of plain text, ${nameOf("pdf-to-markdown")} reads the same selectable text, also in your browser.`,
        ],
      },
      {
        id: "pages-with-no-text",
        heading: "Pages with no text, and scanned PDFs",
        body: [
          "When some pages give nothing, the counts say how many of the document's pages the text came from, and a note names the pages with no selectable text. They may be blank, or scanned images. When no page has any text, the result reads “No selectable text found” and no file is made.",
          `For scanned pages, use ${nameOf("ocr-pdf")}. It recognises the words and can return them as a .txt file with its ${OCR_TEXT_MODE} output, or as a ${OCR_PDF_MODE} you can bring back here. Unlike this tool, ${nameOf("ocr-pdf")} runs on our secure server rather than in your browser.`,
        ],
      },
      {
        id: "hidden-text",
        heading: "Hidden text comes out too",
        body: [
          "The extractor reads every character stored on the page, not only the ones you can see. White lettering, words under a black box drawn on top of them, and the invisible layer an OCR pass adds are all extracted, which makes this a quick test of whether a redaction really removed the words.",
          `Answers typed into fillable form fields belong to the form, not the page, so they are not extracted. Run the file through ${nameOf("flatten-pdf")} first, which also works in your browser, and the entries become page text.`,
        ],
      },
    ],
    faq: [
      {
        question: "Is my PDF sent anywhere when I extract the text?",
        answer:
          "No. The text is read in your browser tab and the .txt file is made there too, so the PDF stays on your device from start to finish.",
      },
      {
        question: "What does “No selectable text found” mean?",
        answer: `No page of the PDF stores characters, usually because the pages are scans or photos, or the lettering was turned into outlines. ${nameOf("ocr-pdf")} can recognise the words and return a .txt file, but it runs on our secure server rather than in your browser.`,
      },
      {
        question: "Are columns and tables kept?",
        answer:
          "A new line on the page becomes a new line in the file, but horizontal alignment is lost. Columns and table cells come out as plain text split by spaces and line breaks.",
      },
      {
        question: "Why are my form entries missing from the text?",
        answer: `Entries typed into fillable fields are part of the form, not the page, so they are not extracted. Flatten the PDF first with ${nameOf("flatten-pdf")}, then extract the text from the flattened copy.`,
      },
      {
        question: "Can it read a password-protected PDF?",
        answer: `Not one that needs a password to open: it stops while loading and says the file is password-protected. ${nameOf("unlock-pdf")} removes that password if you know it, but it runs on our secure server. A PDF that opens without a password, even one set to forbid copying, is read like any other.`,
      },
    ],
    published: "2026-10-31",
    updated: "2026-10-31",
  },
  {
    slug: "how-to-convert-a-pdf-to-black-and-white",
    title: "How to convert a PDF to black and white",
    description: `Turn a color PDF into shades of gray for printing, right in your browser. Choose ${GRAY_SCREEN.dpi} or ${GRAY_PRINT.dpi} DPI; pages become images, so keep the original.`,
    tools: ["grayscale-pdf", "pdf-to-png", "ocr-pdf"],
    keywords: [
      "how to convert a pdf to black and white",
      "pdf to black and white",
      "convert pdf to grayscale",
      "make pdf grayscale",
      "black and white pdf for printing",
      "remove color from pdf",
    ],
    intro: [
      `To make a PDF black and white, open ${nameOf("grayscale-pdf")}, add your PDF, choose an output quality, press Convert to grayscale, and download the copy. Every page comes back in shades of gray, ready for a monochrome printer or a portal that asks for grayscale files.`,
      "Shades of gray, not pure black and white: each pixel becomes a brightness value that counts green most and blue least, so pure red and pure green end up as two different grays. Nothing is pushed to solid black or white, so photos and shaded charts keep their tones.",
      `The conversion runs in your browser with pdf.js, so your PDF stays on your device and there is no account to create. It takes one PDF of up to ${ceilingMb("grayscale-pdf")} MB.`,
    ],
    steps: [
      `Open the ${nameOf("grayscale-pdf")} tool.`,
      "Drop your PDF on the panel that says “Drop your PDF here, or browse”, or click it to choose the file.",
      `Under Output quality, choose ${GRAY_PRESET_CHOICES}. ${GRAY_PRINT.label} is selected to start; ${GRAY_SCREEN.label} draws fewer pixels per page and usually makes a smaller file.`,
      "Press Convert to grayscale. A progress count follows each page, and the new PDF is put together after the last one.",
      `Press Download grayscale PDF. The copy is named after your file, so report.pdf becomes ${GRAY_EXAMPLE_OUT}.`,
    ],
    sections: [
      {
        id: "pages-become-images",
        heading: "Every page becomes an image",
        body: [
          "The tool draws each page to an image, turns it gray, and builds a new PDF from those images alone, each page at the size the original shows it. Each page image is stored as a single-channel gray image, either losslessly compressed or as a JPEG, whichever is smaller for that page.",
          `So the copy is for printing or submitting, not for editing. Text can no longer be selected or searched, sharp vector lines become pixels, and links and bookmarks do not carry over. Form fields and comments are painted in from their saved appearance, so they can no longer be filled in or clicked. The new file's title is the original's with the word grayscale added in brackets, as in ${GRAY_EXAMPLE_TITLE}, or is made from the file name when the original has no title. Keep the original alongside it.`,
        ],
      },
      {
        id: "file-size",
        heading: "Why the file can get bigger",
        body: [
          `A page of text is a few drawing instructions in the original and a full picture in the copy, so a text-only PDF usually grows, often by a lot. A scanned or photo-heavy PDF can shrink instead. The result shows both sizes, and when the copy is larger it says so: “${GRAYSCALE_GREW_NOTE}”`,
          `${GRAY_SCREEN.label} (${GRAY_SCREEN.dpi} DPI) draws fewer pixels per page than ${GRAY_PRINT.label} (${GRAY_PRINT.dpi} DPI), so it gives a lighter file that reads well on a monitor. ${GRAY_PRINT.label} keeps small type and fine lines crisper on paper.`,
        ],
      },
      {
        id: "printing-and-portals",
        heading: "Printers, portals and charts",
        body: [
          "Converting before you print sends the printer gray pixels instead of leaving the color-to-gray mapping to its driver, and you can check the result on screen first. A print shop's or a portal's check that reads the declared color space reports grayscale, because no page image is stored in color. A check that also expects live text or vector artwork will not find any.",
          "Two chart series told apart only by hue, with similar brightness, come out as nearly the same gray. A quick conversion flags a chart that needs patterns or labels before it goes on black-and-white handouts.",
        ],
      },
      {
        id: "related-tools",
        heading: "Gray images, or searchable text again",
        body: [
          `If you want gray page images rather than a PDF, ${nameOf("pdf-to-png")} has a ${PNG_GRAY} option under Colour, and it also runs in your browser.`,
          `To make the gray copy searchable again, run it through ${nameOf("ocr-pdf")}, which adds a recognised text layer; ${GRAY_PRINT.label} gives it more pixels to read. Unlike this tool, ${nameOf("ocr-pdf")} runs on our secure server rather than in your browser.`,
        ],
      },
    ],
    faq: [
      {
        question: "Will the pages be pure black and white, with no gray?",
        answer:
          "No. The tool converts to grayscale: every color becomes a shade of gray, and nothing is forced to solid black or white. Black text on a white page stays black on white; photos, colored areas and shading become gray tones.",
      },
      {
        question: "Is my PDF sent anywhere when I convert it?",
        answer: `No. Drawing the pages, turning them gray and building the new PDF all happen in your browser tab, so the PDF stays on your device. ${offlineAnswer("grayscale-pdf")}`,
      },
      {
        question: "Can I still select or search the text afterwards?",
        answer: `No. Each page is stored as one image, so the text is part of the picture. ${nameOf("ocr-pdf")} can add a recognised text layer to the gray copy, but it runs on our secure server rather than in your browser.`,
      },
      {
        question: "Why is the gray PDF bigger than the original?",
        answer: `Because every page is now a picture. A text-only PDF usually grows, while a scanned one can shrink. ${GRAY_SCREEN.label} draws fewer pixels than ${GRAY_PRINT.label} and usually makes a smaller file.`,
      },
      {
        question: "Does it work on password-protected PDFs?",
        answer: `No. Any encrypted PDF is turned away when you choose it, including one that opens without a password but restricts printing or copying, and the message says which lock it has. ${nameOf("unlock-pdf")} removes the encryption if you give it the password, but it runs on our secure server; bring the unlocked copy back here.`,
      },
    ],
    published: "2026-10-31",
    updated: "2026-10-31",
  },
  {
    slug: "how-to-highlight-text-in-a-pdf",
    title: "How to highlight text in a PDF",
    description:
      "Drag a highlight over the words on a PDF page, set its colour and opacity, then flatten it into the page or keep it as a comment. It runs in your browser.",
    tools: ["annotate-pdf", "edit-pdf", "redact-pdf"],
    keywords: [
      "how to highlight text in a pdf",
      "highlight pdf",
      "highlight text in pdf online",
      "pdf highlighter",
      "highlight a pdf for free",
      "mark up a pdf",
    ],
    intro: [
      `To highlight text in a PDF, open ${nameOf("annotate-pdf")}, add your PDF, and drag across the words you want to mark. Highlight is already chosen when the pages appear, and a see-through yellow bar lands where you drag. Press Apply & download when you are done, and the marked copy downloads.`,
      "A highlight here is a rectangle you draw over the words, not a selection of the text itself, so you decide how much it covers: half a line, or a whole paragraph in one drag. If you save it as a comment rather than into the page, it is fitted to the lines of text under it, the way a PDF viewer's own highlight looks.",
      `The PDF is drawn, marked and saved in your browser, so it stays on your device, and there is no account to create. It takes one PDF of up to ${ceilingMb("annotate-pdf")} MB.`,
    ],
    steps: [
      `Open the ${nameOf("annotate-pdf")} tool.`,
      "Drop your PDF on the panel that says “Drop your PDF here, or browse”, or click it to choose the file. Its pages appear in a scrolling view, with Highlight already selected in the toolbar.",
      "Drag across the words you want to mark. A single click instead drops a short bar you can stretch afterwards.",
      `To change the colour, use Colour in the panel beside the page; Opacity starts at ${HIGHLIGHT_OPACITY_PCT}%. With nothing selected, these set the next highlight; to change one already on the page, choose Select, click it, and the panel sets that one. With Select you can also drag a highlight to move it, or drag a handle to resize it.`,
      "Under “Highlights, drawings, notes and shapes”, beside Apply & download, keep Flatten into the page, or choose to save markups as comments instead.",
      `Press Apply & download. The copy downloads at once, named after your file: report.pdf becomes ${ANNOTATED_EXAMPLE_OUT}. Under Annotated PDF ready, Download annotated PDF saves it again.`,
    ],
    sections: [
      {
        id: "flattened-or-comments",
        heading: "Flattened into the page, or saved as comments",
        body: [
          "Flatten into the page, the choice selected to start, draws each highlight into the page itself, with its colour multiplied over the words so they stay readable. It shows in every viewer and printout, the original text stays selectable, and nothing becomes an image. The cost is that it cannot be taken out later except with an editor that changes page content, so keep the original if you may want an unmarked copy.",
          "Saving markups as comments writes each highlight as a standard PDF highlight annotation instead. Where the box lies over lines of text, it is fitted to them: one band per line, as tall as the line and as wide as your box. Over a picture of text, such as a scanned page, it stays the box you drew. Other PDF apps list it as a comment and let you select, edit or delete it; there are no reply threads here.",
        ],
      },
      {
        id: "other-marks",
        heading: "Notes, drawings and covers on the same page",
        body: [
          "Highlight sits in the toolbar's Mark up group, beside Whiteout, Redact, Draw for freehand ink, and Note for a typed note on coloured paper; the Shapes group has Rectangle, Ellipse, Line and Arrow. Anything you place can be moved, resized, restyled or deleted before you apply, and Undo and Redo step back and forward.",
          `Whiteout only paints a white box: the words under it are still in the file, and search, copy and text extraction can find them. Redact removes what lies under its box. Both are always written into the page, even when the other markups are saved as comments, because a comment can be deleted by whoever opens the file. For a document you need to hand over with words removed, ${nameOf("redact-pdf")} also works in your browser and can search the text for what to remove.`,
          `${nameOf("edit-pdf")} opens the same editor on Select, with the same Highlight in its toolbar, for when you also need to change the PDF's own words.`,
        ],
      },
      {
        id: "locked-and-signed-pdfs",
        heading: "Locked, restricted and signed PDFs",
        body: [
          `A PDF that needs a password to open has to be unlocked first; ${nameOf("unlock-pdf")} removes the password if you know it, but it runs on our secure server rather than in your browser. A PDF that opens without a password but whose author restricted changes opens here with the author's rules in force: if the author allows comments, highlights are always saved as comments and the copy keeps the author's encryption, and if not, the mark-up tools stay locked. Typing the owner password into the page unlocks every tool for that file.`,
          "On an ordinary PDF, the copy is written out as a new file, so an existing digital signature will no longer validate, and the file's Creator and Producer become this site's name. Its pages, text, bookmarks and form fields are otherwise kept.",
        ],
      },
    ],
    faq: [
      {
        question: "Can I highlight text by selecting it, like in a PDF viewer?",
        answer:
          "No. You drag a see-through box over the words instead of selecting them. Flattened, it covers exactly the area you draw. Saved as a comment, it fits itself to the lines of text under the box, one band per line, the way a viewer's own text highlight looks.",
      },
      {
        question: "Can I change the highlight colour?",
        answer: `Yes. Use Colour in the panel beside the page, which opens your browser's colour picker; highlights start yellow at ${HIGHLIGHT_OPACITY_PCT}% opacity. Set it before you drag to colour the next highlight, or select one already on the page to change just that one.`,
      },
      {
        question: "Can I remove a highlight after saving?",
        answer:
          "Saved as a comment, yes: a PDF app that edits comments can select and delete it. Flattened, only with an editor that can change page content, because the highlight is drawn into the page. Before you press Apply & download, any highlight can be selected and deleted, or undone.",
      },
      {
        question: "Can I highlight a scanned PDF?",
        answer: `Yes. A highlight is a box drawn over the page, so it works on a picture of text too. Saved as a comment, it stays the box you drew, because there are no text lines under it to fit to. To make the words searchable as well, run the scan through ${nameOf("ocr-pdf")} first, which runs on our secure server rather than in your browser.`,
      },
      {
        question: "Is my PDF sent anywhere when I highlight it?",
        answer:
          "No. The PDF is read, marked and saved by code running in your browser tab. If you also add a note in a script beyond the Western European character set, the page fetches a Noto typeface from this site to draw it; your PDF is not sent.",
      },
    ],
    published: "2026-10-31",
    updated: "2026-10-31",
  },
  {
    slug: "how-to-chat-with-a-pdf",
    title: "How to chat with a PDF using AI",
    description:
      "Ask a PDF questions and get AI answers from its text, with [p.N] page citations to check and follow-up questions. Scans need OCR first. No account needed.",
    tools: ["chat-with-pdf", "ocr-pdf", "summarize-pdf"],
    keywords: [
      "how to chat with a pdf",
      "chat with pdf",
      "ask questions about a pdf",
      "ai pdf chat",
      "talk to a pdf",
      "pdf question answering",
    ],
    intro: [
      `To chat with a PDF, open ${nameOf("chat-with-pdf")}, add your PDF, type a question in the Your question box, and press Ask the PDF. An AI model answers from the document's text and marks the pages it drew on as [p.N], and the box then becomes Ask a follow-up for your next question.`,
      "Use the answers to find your way around a document, not in place of reading it. The model is told to answer only from the document's text, to use no outside knowledge, and to say plainly when the answer is not there, yet nothing checks an answer against the pages afterwards, so an answer can still be wrong. Each answer carries a reminder to check it against your PDF.",
      `${nameOf("chat-with-pdf")} is one of the AI tools, so the work does not happen in your browser. With each question, your PDF uploads over an encrypted connection to our secure server, which extracts the selectable text and sends that text, with your question and the recent exchanges, to a third-party AI provider; the PDF file itself is never sent to the provider. The upload is deleted when the job ends, and our server's link to each answer stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes. No account is needed.`,
    ],
    steps: [
      `Open the ${nameOf("chat-with-pdf")} tool. Ask the PDF works once the status badge reads Secure server.`,
      "Drop one PDF on the box that says “Add your PDF, or browse”, or click it to choose the file. It needs selectable text; for a scan, run OCR PDF first.",
      `Type your question in the Your question box, up to ${CHAT_QUESTION_CHARS} characters, in plain language: the notice period in a lease, say, or the total due on an invoice.`,
      "Press Ask the PDF. Your PDF uploads over an encrypted connection to our secure server, and the button follows the job while the model answers.",
      "Read the answer in the conversation above the box. Where it shows a [p.N] marker, open that page of your PDF and check the wording before you rely on it.",
      `For another question, type in Ask a follow-up and press Send follow-up. Each answer has a button named after its ZIP that saves it to your device: lease.pdf gives ${CHAT_EXAMPLE_ZIP}.`,
    ],
    sections: [
      {
        id: "what-a-citation-is",
        heading: "What a [p.N] citation is, and what it is not",
        body: [
          "Before the model sees the text, our server marks each page that has text with its number, and the model is told to cite the pages it uses as [p.N]. The number is the page's position in the file, counted from the first page with blank pages included, so it can differ from the number printed on the page when a document opens with a cover or roman-numbered front matter.",
          "A citation is the model's own pointer, not a quotation checked by software. The answer.md file in each download lists the cited pages, keeping only page numbers that exist in your file, but nothing checks that a cited page says what the answer says it does. Treat [p.N] as where to look, and read that page. An answer with no citation gives you nothing to look up, so search the document for it before you rely on it.",
        ],
      },
      {
        id: "follow-up-questions",
        heading: "Follow-up questions and long documents",
        body: [
          `The conversation lives in your browser tab, and every question is a job of its own: the page uploads the PDF again and sends the most recent exchanges with it, up to ${MAX_CONTEXT_EXCHANGES}. A note above the button says how many travel with the next question, and whether any were shortened or left out to stay within the request limits.`,
          "Our server does not link one question to the next. Reloading the page, choosing another file, or pressing Remove beside the file name starts a new conversation.",
          `Each question reads a bounded amount of text, with your question and the conversation sent with it counted first, and the exact figure is stated on the ${nameOf("chat-with-pdf")} page. Past that point the model is told not to claim the document lacks something, and a notice above the answer says how far into the document the reading got. For a long file, pull the part you need into its own PDF with ${nameOf("extract-pages")} and ask that; its [p.N] citations then count the pages of the extracted copy. Files are capped at ${ceilingMb("chat-with-pdf")} MB.`,
        ],
      },
      {
        id: "allowance-and-privacy",
        heading: "The free allowance and where your text goes",
        body: [
          `Questions are free, within a daily allowance. ${aiAllowanceFactFor("chat-with-pdf")} The charge is taken when the job is submitted, so a question our server refuses or that fails still uses it.`,
          "Our server sends the PDF's extracted text, with your question and the recent exchanges, to a third-party AI provider; the PDF file itself is never sent to the provider. The settings in our provider account that would let it use this text to improve its models are switched off, though the provider may keep what it receives for a limited time to watch for abuse. Because the same text goes again with every follow-up, the provider also holds it in a short-lived cache, measured in minutes rather than days. Section 3 of our privacy policy covers the provider's side.",
        ],
      },
      {
        id: "scanned-pdfs-need-ocr-first",
        heading: "Scanned PDFs need OCR first",
        body: [
          `The tool reads only text stored in the PDF as text. Your browser checks the file for text before anything is sent, and a scan with none is stopped there with a message pointing you to ${nameOf("ocr-pdf")}; that refusal takes nothing from the allowance.`,
          `Run the scan through ${nameOf("ocr-pdf")} with the document's language selected, then ask your questions of the searchable copy. Answers can only be as good as the recognised text.`,
        ],
      },
    ],
    faq: [
      {
        question: "Can I trust the page citations?",
        answer:
          "Use them as pointers, not proof. The model is told to cite the pages it used as [p.N], and the download lists only page numbers that exist in your file, but nothing checks that the page says what the answer claims. Open the cited page and read it before you rely on the answer.",
      },
      {
        question: "How many questions can I ask for free?",
        answer: aiAllowanceFactFor("chat-with-pdf"),
      },
      {
        question: "Who sees the text of my PDF?",
        answer: `A third-party AI provider receives the extracted text, your question and the recent exchanges; the PDF file never reaches it. Our server deletes each upload when its job ends, and the link to each answer stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes.`,
      },
      {
        question: "Does it remember my conversation?",
        answer:
          "Only in your open browser tab. The page re-sends the recent exchanges with each follow-up, and our server keeps nothing that links one question to the next, so reloading the page or removing the file starts over.",
      },
      {
        question: "Should I chat with the PDF or summarize it?",
        answer: `Chat when you have a specific question, such as a date, a figure or a clause. For an overview of the whole document as paragraphs, bullet points or an outline, ${nameOf("summarize-pdf")} draws on the same daily allowance.`,
      },
    ],
    published: "2026-10-31",
    updated: "2026-10-31",
  },
  {
    slug: "how-to-extract-tables-from-a-pdf",
    title: "How to extract tables from a PDF",
    description:
      "Pull the tables out of a text-based PDF into CSV files and one Excel workbook, a sheet per table. It runs on a secure server; scans need OCR first.",
    tools: ["extract-tables", "pdf-to-excel", "ocr-pdf"],
    keywords: [
      "how to extract tables from a pdf",
      "extract tables from pdf",
      "pdf table to csv",
      "pdf table to excel",
      "copy a table from a pdf",
      "pdf table extractor",
    ],
    intro: [
      `To extract tables from a PDF, open ${nameOf("extract-tables")}, add your PDF, press Extract tables, and download the ZIP. Each table it finds comes back as its own CSV file and as its own sheet in one Excel workbook, with the titles and paragraphs around it left out.`,
      "It finds tables by where the words sit on the page: words on one line form a row, words set a normal space apart stay in one cell, and columns come from the white space that runs down the rows. There are no settings to choose. It reads only text stored in the PDF as text, so a scanned table needs OCR first.",
      `${nameOf("extract-tables")} runs on a secure server, not in your browser, because the word positions come from a native PDF text engine. Your PDF, up to ${ceilingMb("extract-tables")} MB, travels over an encrypted connection and is deleted when the job finishes; the download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes. No account is needed.`,
    ],
    steps: [
      `Open the ${nameOf("extract-tables")} tool. Extract tables works once the status badge reads Secure server.`,
      `Drop one PDF on the box that says “Add your PDF, or browse”, or click it to choose the file. A file over ${ceilingMb("extract-tables")} MB is refused as soon as you pick it, before anything is sent.`,
      "Press Extract tables. Your PDF uploads over an encrypted connection to our secure server, and the button follows the job until the ZIP is back in the page.",
      `When the tables are ready, press Download ${TABLES_EXAMPLE_ZIP}, the button named after your file: report.pdf comes back as ${TABLES_EXAMPLE_ZIP}. The link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, so save it right away.`,
      "Open each sheet beside the page named on its tab, such as Table 1 (p3), and check its rows and columns before you use them.",
    ],
    sections: [
      {
        id: "what-counts-as-a-table",
        heading: "What counts as a table",
        body: [
          `A block of lines is kept as a table only when at least two columns each hold something in two or more rows, one column holds short values of fewer than ${LONG_CELL_WORDS} words each and is not mostly bullet items, and no sentence wraps from one row into the next. Titles, captions, paragraph lines and footnotes end a table rather than joining it, so one page can give several tables.`,
          "Two columns of prose, side-by-side bulleted lists and letterhead lines fail those tests on purpose. A table whose every column holds longer text can fail them too. If nothing in the file passes, the job ends with a message that no table-like structure was detected, and no ZIP is made.",
        ],
      },
      {
        id: "what-you-download",
        heading: "What you download",
        body: [
          "The ZIP holds table-1.csv, table-2.csv and so on, one per table, plus tables.xlsx with a sheet per table named by its number and page, such as Table 1 (p3). The CSV files follow the common RFC 4180 layout with no byte-order mark, so a script can read them directly; if accented letters look wrong after a double-click, open the file through Excel's text import.",
          `In tables.xlsx, a cell that holds exactly one number, such as ${XLSX_AMOUNTS}, is stored as a number, so a formula can add up the column. A code with leading zeros such as 00123, a number of more than ${MAX_SIGNIFICANT_DIGITS} significant digits, a European 1.250,00, a date and a negative in brackets stay text, exactly as printed.`,
        ],
      },
      {
        id: "layouts-to-check",
        heading: "Layouts to check by hand",
        body: [
          "Three layouts trip the detector: two tables side by side on the same rows come out as one wide table, a cell that wraps in the first column ends its table early, and a centred one-line note directly under a table can be taken as its last row. A one-line subheading set in a table's first column also ends it, so a sectioned table can come back as several. Merged header cells are not rebuilt.",
          "Each page is read on its own, so a table that runs over three pages comes out as at least one table per page, with any header row the PDF repeats on each page repeated in each sheet. Stack the sheets and delete the repeated headers to rebuild it.",
        ],
      },
      {
        id: "tables-or-excel",
        heading: "Extract Tables, PDF to Excel, or OCR first",
        body: [
          `${nameOf("pdf-to-excel")} puts every line of the PDF's text into one sheet, each value in the column it sits in, which suits getting all of the text into a grid. ${nameOf("extract-tables")} keeps only the table-shaped blocks, each on its own sheet. Both run on our secure server.`,
          `A scanned page has no text to read, so it produces nothing, and a file with no text on any page stops with a message pointing you to ${nameOf("ocr-pdf")}. Run it there with the page's language selected, choose a searchable PDF as the result, and bring that file back.`,
        ],
      },
    ],
    faq: [
      {
        question: "Can it extract tables from a scanned PDF?",
        answer: `Not directly. A scan holds a picture of its words, so there are no word positions to read. Run it through ${nameOf("ocr-pdf")} first to add a text layer, then extract the tables from the searchable copy, and check the figures, since recognition can misread them.`,
      },
      {
        question: "Why did a page with an obvious table give nothing?",
        answer: `A block counts as a table only when two columns each hold something in two or more rows, one column holds short values of fewer than ${LONG_CELL_WORDS} words, and no sentence runs on from one row into the next. A table of long text, or one cut into single rows by one-line subheadings, can miss those tests.`,
      },
      {
        question: "Will Excel see my numbers as numbers?",
        answer: `Yes, in tables.xlsx, when a cell holds exactly one number such as ${XLSX_AMOUNTS}. Dates, codes with leading zeros, European-style 1.250,00 and negatives in brackets stay text. The CSV files are plain text, so the program that opens them decides.`,
      },
      {
        question: "Is my PDF uploaded?",
        answer: `Yes. The word positions are read by a native program a browser cannot run, so your PDF travels over an encrypted connection to our secure server, which deletes it when the job finishes. The download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and a daily storage rule erases the stored ZIP.`,
      },
      {
        question: "Can I choose which pages to read?",
        answer: `No. There are no options: every page is read. To work on a few pages, make a smaller PDF of them first with ${nameOf("extract-pages")}, which runs in your browser, and remember that the page numbers on the sheet tabs then count the pages of that copy.`,
      },
    ],
    published: "2026-10-31",
    updated: "2026-10-31",
  },
  {
    slug: "how-to-convert-pdf-to-markdown",
    title: "How to convert a PDF to Markdown",
    description:
      "Turn a PDF's selectable text into a Markdown .md file with a title, page headings, paragraphs and list items worked out from the page, in your browser.",
    tools: ["pdf-to-markdown", "pdf-to-text", "ocr-pdf"],
    keywords: [
      "how to convert pdf to markdown",
      "pdf to markdown",
      "pdf to md",
      "convert pdf to md file",
      "pdf text to markdown",
      "pdf to markdown for notes",
    ],
    intro: [
      `To convert a PDF to Markdown, open ${nameOf("pdf-to-markdown")}, add your PDF, press Create Markdown, check the preview, and press Download MD. You get a UTF-8 .md file built from the text stored in the PDF.`,
      "A PDF stores positioned lines, not headings, paragraphs or lists, so the structure is worked out from the size and position of each line. It is usually close, rarely perfect: read the result before you publish it or paste it into a wiki.",
      `The Markdown is made in your browser with pdf.js, so your PDF stays on your device and there is no account to create. It takes one PDF at a time, up to ${ceilingMb("pdf-to-markdown")} MB, and there are no settings to choose.`,
    ],
    steps: [
      `Open the ${nameOf("pdf-to-markdown")} tool.`,
      "Drop your PDF on the panel that says “Drop your PDF here, or browse”, or click it to choose the file. Its name, page count and size appear.",
      "Press Create Markdown. The button reads Creating Markdown… while every page's text is read and arranged.",
      "Under “Markdown created”, check the character and page counts and read the Markdown in the scrollable box. Select any part of it to copy just that passage.",
      `Press Download MD. report.pdf is saved as ${MD_EXAMPLE_OUT}. Start over clears the page for another document.`,
    ],
    sections: [
      {
        id: "what-structure-you-get",
        heading: "What structure you get",
        body: [
          "The file name, minus its extension, becomes the # title. In a PDF of more than one page, each page that has text gets its own ## Page heading with its page number.",
          `Within a page, lines that wrap are joined back into sentences, and a word hyphenated at a line end is rejoined. A new paragraph starts where the gap between two lines is more than ${PARAGRAPH_GAP_RATIO} times the spacing of a paragraph's wrapped lines, where a line is indented like a first line, or where the text moves back up the page to a new column without a sentence running on across it. A page with no wrapped line gives no spacing to measure and can arrive as one paragraph.`,
          `A short line set at least ${MD_HEADING_PCT}% larger than the body text becomes a heading, larger sizes ranking higher; one longer than ${HEADING_MAX_CHARS} characters or ending in a full stop, comma or semicolon stays ordinary text. Lines that start with -, *, +, a number, or a bullet character such as • stay list items.`,
        ],
      },
      {
        id: "what-is-left-out",
        heading: "What is left out",
        body: [
          "Font weight and style are not read, so nothing comes out bold or italic. Images are dropped, and so are the web addresses behind links. A table's cells run together as plain words, without its grid.",
          `For the tables themselves, ${nameOf("extract-tables")} detects them by where the words sit and returns CSV files and an Excel workbook, but it runs on our secure server rather than in your browser. For the text with its line breaks as they are and no Markdown added, ${nameOf("pdf-to-text")} reads the same text, also in your browser.`,
        ],
      },
      {
        id: "markdown-characters",
        heading: "Characters that look like Markdown",
        body: [
          "Words are not rewritten. A paragraph that would otherwise read as Markdown syntax, such as one starting with # and a space, a rule like ---, a > quote or a | table row, gets a backslash in front so a Markdown viewer shows it as typed, and a < or & that would open an HTML tag or entity is escaped. Other asterisks, underscores and backticks pass through, so a Markdown viewer may format them.",
        ],
      },
      {
        id: "scanned-pdfs",
        heading: "Scanned PDFs and “No selectable text found”",
        body: [
          "A page with no stored text, such as a scan or a phone photo, adds nothing to the Markdown. When no page has any text, the result reads “No selectable text found” and no file is made.",
          `${nameOf("ocr-pdf")} can recognise the words and return a searchable PDF to bring back here; select every language printed on the pages. Unlike this tool, ${nameOf("ocr-pdf")} runs on our secure server rather than in your browser.`,
        ],
      },
    ],
    faq: [
      {
        question: "Is my PDF sent anywhere when I convert it to Markdown?",
        answer:
          "No. The text is read in your browser tab and the .md file is made there too, so the PDF stays on your device from start to finish.",
      },
      {
        question: "Are tables kept?",
        answer: `Not as Markdown tables. Their cells come through as plain words. ${nameOf("extract-tables")} returns tables as CSV and Excel files instead, on our secure server.`,
      },
      {
        question: "Why are my headings missing?",
        answer: `A line becomes a heading only when it is short and set at least ${MD_HEADING_PCT}% larger than the body text. A heading in the body size, made bold instead of larger, stays ordinary text, because font weight is not read.`,
      },
      {
        question: `How is this different from ${nameOf("pdf-to-text")}?`,
        answer: `Both read the same text in your browser. ${nameOf("pdf-to-text")} writes a plain .txt file with the PDF's line breaks and no markers; ${nameOf("pdf-to-markdown")} joins lines into paragraphs, turns larger type into headings, keeps list lines apart and adds the title and page headings.`,
      },
      {
        question: "Can it convert a password-protected PDF?",
        answer: `Not one that needs a password to open: it is refused as it opens. ${nameOf("unlock-pdf")} removes that password if you know it, but it runs on our secure server. A PDF that opens without a password and only restricts copying or printing converts like any other.`,
      },
    ],
    published: "2026-10-31",
    updated: "2026-10-31",
  },
];
