/**
 * The per-tool derived facts source (owner requirement, TASK-20): every
 * figure or capability statement a tool page renders beyond the catalogue's
 * own prose lives HERE, derived from the constants that govern behavior —
 * never hand-written per page. The numbers census walks the rendered output
 * and the overclaim guard walks THIS FILE, which was added to that walk
 * before the first answer was written (the TASK-07 lesson, applied in
 * order).
 *
 * Shapes:
 *  - `toolFacts(slug)`  — short, per-tool fact lines ("Rotate 90°, 180° or
 *    270° — any page or all pages"), each derived from an exported constant
 *    a runner also imports, so the fact and the behavior share one source.
 *  - `toolFaq(slug)`    — question/answer pairs ONLY where the code answers
 *    (size caps, processing mode, retention, the AI allowance, OCR
 *    languages). These feed FAQPage JSON-LD — the same channel that once
 *    carried fabricated pricing to crawlers — so nothing speculative ships.
 *  - `howToSteps(tool)` — the tool's own catalogue steps when present, else
 *    the mode-true default flow. A client tool's steps NEVER claim an
 *    upload; the structured-data guard pins that relationship.
 */
import { AI_INPUT_LIMITS, DEFAULT_RETENTION } from "@/lib/jobs/types";
import { TRANSLATE_MAX_INPUT_CHARS } from "@/lib/jobs/translate-limits";
import { CHAT_TOOL_SLUG } from "@/lib/jobs/chat-with-pdf";
import {
  aiReadLimitFor,
  aiReadPagesAtDensest,
  aiReadPagesAtSparsest,
} from "@/lib/jobs/ai-read-limit";
import {
  AI_ALLOWANCE_FACT,
  AI_CHARACTER_ALLOWANCE_DELIVERED,
  aiAllowanceFactFor,
} from "@/lib/jobs/ai-allowance";
import { CROP_KEEPS_CONTENT } from "@/lib/pdf/crop-disclosure";
import { capabilityForMode, getToolInputKind } from "@/lib/jobs/capabilities";
import { HYBRID_SUMMARY } from "./processing";
import { OCR_LANGUAGES, MAX_OCR_LANGUAGES } from "@/lib/jobs/ocr";
import { STAMP_POSITIONS } from "@/lib/pdf/stamp";
import {
  XLSX_CELL_BREAK_PHRASE,
  XLSX_MERGE_CAVEAT,
  XLSX_NUMBER_EXAMPLES,
  XLSX_SHEET_NAME,
  XLSX_TEXT_EXAMPLE,
} from "@/lib/jobs/pdf-office-export";
import { PDF_A_STANDARD } from "@/lib/jobs/pdfa-results";
import {
  MAX_DOCX_PICTURES,
  MAX_LAYERS_PER_PAGE,
} from "@/lib/workers/pdf-office-export/picture-limits";
import { MAX_TOOL_NOTES } from "@/lib/jobs/tool-notes";
import {
  MAX_REQUEST_SIGNERS,
  REQUEST_PACKAGE_FILES,
} from "@/lib/jobs/request-signatures";
import { LANGUAGE_NAMES, TRANSLATE_LANGUAGES } from "@/lib/jobs/translate-pdf";
import {
  DEFAULT_PDF_KEY_LENGTH,
  PDF_ENCRYPTION_LEVELS,
  describePdfKeyLength,
} from "@/lib/jobs/pdf-security";
import { SUMMARY_FORMATS, SUMMARY_LENGTHS } from "@/lib/jobs/summarize-pdf";
import {
  EXTRACTION_FIELD_TYPES,
  MAX_EXTRACTION_FIELDS,
} from "@/lib/jobs/ai-extract";
import { MAX_CONTEXT_EXCHANGES } from "@/lib/workers/chat-with-pdf-conversation";
import { IMAGE_HEAVY_SHARE } from "@/lib/pdf/analyze";
import { buildSplitParts } from "@/lib/pdf/ranges";
import {
  DEFAULT_REDACT_PRESET_ID,
  REDACTED_PDF_TITLE,
  REDACT_DPI_PRESETS,
  REDACT_IMAGE_FORMAT,
} from "@/lib/pdf/redact-output";
import {
  ANNOTATION_FACT,
  ANNOTATION_TYPES,
  DEEP_COMPRESSION_GRAYSCALE_HINT,
  DEEP_COMPRESSION_PRESETS,
  EDIT_OP_FACT,
  EDIT_OP_TYPES,
  FIELD_TYPE_FACT,
  GRAYSCALE_DPI_PRESETS,
  NEW_FIELD_TYPES,
  OVERLAY_FITS,
  SIGNATURE_SOURCE_FACT,
  SIGNATURE_SOURCES,
  SPLIT_MODE_FACT,
  SPLIT_MODES,
} from "@/lib/pdf/offered-kinds";
import {
  IMAGE_PAGE_MARGIN_PT,
  MIN_CROP_DIMENSION,
  PT_PER_INCH,
  TEXT_PAGE_MARGIN_PT,
  US_LETTER_LABEL,
  inches,
} from "@/lib/pdf/page-geometry";
import {
  RASTER_MAX_DEVICE_PX,
  RASTER_PREVIEW_LIMIT,
  RASTER_RESOLUTION_CHOICES,
  pageImageName,
  rasterFormatForSlug,
} from "@/lib/pdf/pdf-to-image";
import {
  MARKDOWN_BLOCK_KINDS,
  type MarkdownBlockKind,
} from "@/lib/pdf/markdown-blocks";
import { HEADING_SIZE_RATIO } from "@/lib/pdf/pdf-to-markdown";
import { getRunnerKind, type RunnerKind } from "@/lib/pdf/registry";
import { tools } from "./catalog";
import { toolFileCeilingMb } from "./file-ceilings";
import type { Tool } from "./types";

/* ------------------------------------------------------------------ *
 *  Owned constants the runners import back, so fact and behavior agree.
 *  They live in ./limits (a leaf) so the catalogue can also derive from
 *  them without a cycle; re-exported here for the runners and tests.
 * ------------------------------------------------------------------ */
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_MB,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_MB,
} from "./limits";

export { MAX_IMAGE_BYTES, MAX_IMAGE_MB, MAX_SOURCE_BYTES, MAX_SOURCE_MB };

/*
 * `MAX_FILE_MB` used to sit here — `JOB_LIMITS.maxFileBytes` in megabytes, the
 * one figure every "How large can my file be?" answer was built from. It is
 * gone rather than kept beside the per-tool ceiling: a module-level number
 * spelling out ONE tier's cap is exactly what the FAQ reached for when it
 * needed a cap for a tool of another tier. `toolFileCeilingMb(tool)` cannot be
 * reached for without naming which tool is being answered about.
 */

/**
 * Translate's page floors, derived from ITS ceiling at the same measured
 * densities the read-bound floors use. `aiReadPagesAtDensest`/`Sparsest`
 * divide what one per-call run READS; translate is bounded by the model's OUTPUT budget
 * (its output is as long as its input), so its floors divide
 * `TRANSLATE_MAX_INPUT_CHARS` instead — a right ceiling with the shared cap's
 * page range beside it would be the same 49x defect one notch over.
 */
const translatePagesAtDensest = Math.floor(
  TRANSLATE_MAX_INPUT_CHARS / AI_INPUT_LIMITS.densestCharactersPerPage,
);
const translatePagesAtSparsest = Math.floor(
  TRANSLATE_MAX_INPUT_CHARS / AI_INPUT_LIMITS.sparsestCharactersPerPage,
);

/** "1 page" / "5 pages" — the dense floor IS 1 today, so this is exercised. */
const pluralPages = (n: number) => (n === 1 ? "page" : "pages");

/**
 * Grayscale's quality presets as the runner labels them — "Screen (96 DPI)" —
 * built from the constant the runner's SegmentedControl renders from, so a
 * changed preset changes the page's steps and facts with it
 * (`derived-tool-copy.test.ts`).
 */
const grayscalePresetNames = listed(
  GRAYSCALE_DPI_PRESETS.map((preset) => `${preset.label} (${preset.dpi} DPI)`),
  "or",
);

/**
 * Another tool's CURRENT name, for copy that sends the reader there. Typed
 * names went stale the day three tools were renamed for their head term; a
 * slug that stops resolving fails at import rather than shipping "undefined".
 * `tool-page-content.test.ts` requires every tool a page names to be one of
 * its visible related links.
 */
function toolName(slug: string): string {
  const tool = tools.find((t) => t.slug === slug);
  if (!tool) throw new Error(`tool-facts names unknown tool "${slug}"`);
  return tool.name;
}

/** The encryption strengths as the protect panel's selector labels them. */
const encryptionLabels = listed(
  PDF_ENCRYPTION_LEVELS.map((l) => l.label),
  "or",
);

/** Overlay scale modes as the overlay runner's control labels them. */
const overlayFitLabels = listed(
  OVERLAY_FITS.map((fit) => fit.label),
  "or",
);

/* ------------------------------------------------------------------ *
 *  Facts — each line's source is the runner constant or UI it names.
 * ------------------------------------------------------------------ */

export interface ToolFact {
  readonly label: string;
  readonly value: string;
  /**
   * The list a spelled count in this fact counts — the SAME array a runner
   * iterates, never a copy. `counted-facts.test.ts` finds every count word on
   * every fact and requires it to equal this list's length, and requires this
   * list to be one of the `offered-kinds` arrays by identity, so a count cannot
   * be typed by hand again.
   */
  readonly counts?: readonly string[];
}

const COUNT_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
] as const;

/** A count as a word, for prose ("three ways"); throws past twelve. */
export function countWord(n: number): string {
  const word = COUNT_WORDS[n];
  if (word === undefined) throw new Error(`no count word for ${n}`);
  return word;
}

/**
 * "Four element types: text, boxes, lines, and images." — the count word and the
 * named items both come from `ids`, so neither can drift from the other or from
 * the runner. Throws past twelve rather than printing a numeral in prose.
 */
function countedFact<Id extends string>(
  label: string,
  noun: string,
  ids: readonly Id[],
  phrase: Record<Id, string>,
  conjunction: "and" | "or",
): ToolFact {
  const word = countWord(ids.length);
  const names = ids.map((id) => phrase[id]);
  const list =
    names.length <= 2
      ? names.join(` ${conjunction} `)
      : `${names.slice(0, -1).join(", ")}, ${conjunction} ${names.at(-1)}`;
  return {
    label,
    value: `${word[0]!.toUpperCase()}${word.slice(1)} ${noun}: ${list}.`,
    counts: ids,
  };
}

/* ------------------------------------------------------------------ *
 *  Page and output facts for the in-browser converters, each built from
 *  the constant the engine draws with (see src/lib/pdf/page-geometry.ts).
 * ------------------------------------------------------------------ */

/** Image to PDF's page, as the engine lays it out. */
export const IMAGE_PAGE_FACT = `Each image goes on its own ${US_LETTER_LABEL} portrait page with a ${inches(IMAGE_PAGE_MARGIN_PT)} in margin, centred. Larger images are scaled down to fit; smaller ones are never enlarged.`;

/** Text and Markdown to PDF's page, as the engines lay it out. */
export const TEXT_PAGE_FACT = `${US_LETTER_LABEL} portrait pages with ${inches(TEXT_PAGE_MARGIN_PT)} in margins and a page number (1 / N) at the foot of each page.`;

/** What each block kind is called on the page. */
const MARKDOWN_BLOCK_PHRASE: Record<MarkdownBlockKind, string> = {
  heading: "headings",
  paragraph: "paragraphs",
  "list-item": "bulleted and numbered lists",
  quote: "block quotes",
  code: "fenced code blocks",
  rule: "horizontal rules",
  table: "tables",
};

/**
 * The syntax Markdown to PDF typesets — every kind in MARKDOWN_BLOCK_KINDS,
 * which cannot disagree with the renderer's own union (a compile check in
 * markdown-to-pdf.ts). What it does NOT style is said too, because a reader
 * pasting a README will have bold and links in it.
 *
 * It said "Tables, bold, italics and links print as plain text" until the
 * merge with L09 (20ba6ce), which draws GFM tables as a grid and horizontal
 * rules as rules; both joined the renderer's union and, through the compile
 * check, this list.
 */
export const MARKDOWN_SYNTAX_FACT = (() => {
  const names = MARKDOWN_BLOCK_KINDS.map((k) => MARKDOWN_BLOCK_PHRASE[k]);
  const list = `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${list[0]!.toUpperCase()}${list.slice(1)}. Bold and italics print as plain text, and a link keeps its address in parentheses.`;
})();

/**
 * PDF to Markdown: how much larger than the body text a short line must be to
 * become a heading, read off the converter's own ratio ("20").
 * `pdf-to-markdown-copy.test.ts` runs the converter either side of it.
 */
const PDF_TO_MARKDOWN_HEADING_PERCENT = Math.round(
  (HEADING_SIZE_RATIO - 1) * 100,
);

/** PDF to JPG / PNG: the presets, and what one page becomes. */
function rasterFact(slug: string): ToolFact {
  const ext = rasterFormatForSlug(slug).toUpperCase();
  return {
    label: "Resolutions",
    value: `${RASTER_RESOLUTION_CHOICES} — every page becomes one ${ext} image, rendered in your browser.`,
  };
}

/* ------------------------------------------------------------------ *
 *  Redact PDF — what the output is, from the constants its assembler
 *  uses (src/lib/pdf/redact-output.ts). `redact-answers.test.ts` builds
 *  a real redacted file with `assembleRedactedPdf` and reads it back.
 * ------------------------------------------------------------------ */

/** "JPEG", as a reader calls the format the engine embeds. */
const IMAGE_FORMAT_NAME: Readonly<Record<"jpg" | "png", string>> = {
  jpg: "JPEG",
  png: "PNG",
};
const REDACT_IMAGE_NAME = IMAGE_FORMAT_NAME[REDACT_IMAGE_FORMAT];

/** "Screen (96 DPI) or Print (150 DPI)" — the runner's own option labels. */
export const REDACT_PRESET_CHOICES = REDACT_DPI_PRESETS.map(
  (p) => `${p.label} (${p.dpi} DPI)`,
).join(" or ");

const REDACT_DEFAULT_PRESET = REDACT_DPI_PRESETS.find(
  (p) => p.id === DEFAULT_REDACT_PRESET_ID,
)!;

/**
 * What a redacted PDF is — every page, not only the ones with a box. The
 * catalogue says "the text and vectors underneath are permanently removed",
 * which is true and undersells the cost: `redactPdf` renders EVERY page to an
 * image and `assembleRedactedPdf` builds a new document from the images alone,
 * so nothing on any page stays selectable, searchable or clickable. A reader
 * choosing a redaction tool needs that before they run it, not after.
 */
export const REDACT_OUTPUT_FACT = `Every page — not only the ones with a box — is rebuilt as a flat ${REDACT_IMAGE_NAME} image, so the result has no selectable or searchable text, links, form fields, annotations or bookmarks on any page.`;

/** Why a redaction cannot be undone, as the assembler makes it. */
export const REDACT_MECHANISM = `The box is not laid over the text: each page is rendered to a ${REDACT_IMAGE_NAME} image, the box is painted into that image's pixels, and a new PDF is built from the images alone. None of the original's text, drawings, form fields or annotations is copied into it, and neither is its document information — the new file's only title is “${REDACTED_PDF_TITLE}”.`;

export const REDACT_RECOVERY_ANSWER = `No. ${REDACT_MECHANISM}`;

/** The searchability trade-off, and the one tool that recovers part of it. */
export const REDACT_SEARCH_ANSWER = `No — and that is true of every page, including the ones you did not redact, because every page is now an image. To make the text you left visible searchable again, run the redacted file through ${toolName("ocr-pdf")}. The text under a box is gone, so OCR cannot bring it back.`;

const FACTS: Record<string, readonly ToolFact[]> = {
  "redact-pdf": [
    {
      label: "Resolution",
      value: `${REDACT_PRESET_CHOICES} — ${REDACT_DEFAULT_PRESET.label} is selected when the tool opens.`,
    },
    { label: "What you get", value: REDACT_OUTPUT_FACT },
  ],
  "rotate-pdf": [
    {
      label: "Angles",
      value:
        "Rotate in 90° steps, left or right — 90°, 180° or 270° in either direction.",
    },
    {
      label: "Scope",
      value: "Rotate every page, or only the pages you select.",
    },
  ],
  "merge-pdf": [
    {
      label: "Ordering",
      value:
        "Drag files to reorder before merging, use each row's move buttons, or sort by name — the output follows top to bottom.",
    },
  ],
  "split-pdf": [
    countedFact(
      "Split modes",
      "ways to split",
      SPLIT_MODES,
      SPLIT_MODE_FACT,
      "or",
    ),
  ],
  "organize-pages": [
    {
      label: "Operations",
      value:
        "Reorder, rotate, duplicate, or delete pages in one pass — drag pages or use keyboard moves.",
    },
  ],
  "watermark-pdf": [
    {
      label: "Colors",
      value:
        "Gray, red, blue or any custom color for watermark text, in Helvetica, Times or Courier — or a PNG or JPEG image instead.",
    },
    {
      label: "Placement",
      // STAMP_POSITIONS is the list the runner's PositionPicker renders;
      // the tile and page list are `position: "tile"` and `pages` in
      // watermarkPdf, both read back from the output by stamp-options.test.ts.
      value: `Diagonal across the middle by default; any of ${STAMP_POSITIONS.length} positions, or tiled in rows across the page, on every page or only the ones you list.`,
    },
  ],
  "page-numbers": [
    {
      label: "Formats",
      // Every preset the runner offers, named — plus the free-form field
      // beside them. The old entry said "Three numbering formats" and was
      // wrong twice: it undercounted (there are four) and omitted the custom
      // template entirely. `page-numbers-formats.test.ts` pins this line to
      // PAGE_NUMBER_PRESETS so a new preset cannot leave it stale.
      value:
        "Presets “Page 1 of N”, “1 / N”, “1”, or “– 1 –” — or write your own template using {n} and {total}.",
    },
    {
      label: "Placement",
      // STAMP_POSITIONS is the list the runner's PositionPicker renders; the
      // upright claim is placeStamp's rotation cancel, checked on a decoded
      // output page by tool-page-content.test.ts.
      value: `Any of ${STAMP_POSITIONS.length} positions — each corner, the middle of each edge, or the center — at a Small, Medium or Large margin, mirrored on even pages for facing pages. On a rotated page the number still lands there and reads upright.`,
    },
    {
      label: "Numbering",
      // The runner's NumberField labels, verbatim; the cover and tail
      // options are numberingPlan's, read back by stamp-options.test.ts.
      value:
        "Start on page skips earlier pages, such as a cover; First number sets the number counting starts from; Skip last pages leaves the end unnumbered.",
    },
  ],
  "header-footer": [
    {
      label: "Fields",
      // The runner's token buttons, pinned to its export by
      // tool-page-content.test.ts and to applyTokens by running it.
      value:
        "{n} inserts the page number, {total} the page count and {date} today's date — in the header, the footer or both.",
    },
  ],
  "overlay-pdf": [
    {
      label: "Vector overlay",
      // overlay.ts embeds the overlay page as a Form XObject; the test decodes
      // an output page and finds a Form, not an Image.
      value:
        "The overlay is drawn as vector content, not pasted in as a picture, so text in both PDFs stays sharp and selectable.",
    },
  ],
  "sign-pdf": [
    // Was "Five ways to make a signature: draw it, type it, pick an image, use a
    // script font, or print-and-scan style" — the typed signature counted once
    // per font style, and a "print-and-scan" style the runner does not have.
    countedFact(
      "Signature modes",
      "ways to make a signature",
      SIGNATURE_SOURCES,
      SIGNATURE_SOURCE_FACT,
      "or",
    ),
  ],
  "crop-pdf": [
    {
      label: "Crop modes",
      value:
        "Uniform margins or per-side control, applied to all pages or only the ones you select.",
    },
    {
      label: "Hidden, not deleted",
      value: CROP_KEEPS_CONTENT,
    },
  ],
  // Was "Eight element types, including text, boxes, lines, images, and filled
  // shapes" over an editor with four — a filled box is an option on the box.
  "edit-pdf": [
    countedFact(
      "Elements",
      "element types",
      EDIT_OP_TYPES,
      EDIT_OP_FACT,
      "and",
    ),
  ],
  "create-forms": [
    countedFact(
      "Field types",
      "field types",
      NEW_FIELD_TYPES,
      FIELD_TYPE_FACT,
      "and",
    ),
  ],
  // Was "Six annotation kinds, including highlights, boxes, notes, and lines"
  // over a tool with four.
  "annotate-pdf": [
    countedFact(
      "Annotation kinds",
      "annotation kinds",
      ANNOTATION_TYPES,
      ANNOTATION_FACT,
      "and",
    ),
  ],
  "jpg-to-pdf": [
    {
      label: "Per-image limit",
      value: `Up to ${MAX_IMAGE_MB} MB per image, assembled into one PDF on your device.`,
    },
    { label: "Page", value: IMAGE_PAGE_FACT },
  ],
  "png-to-pdf": [
    {
      label: "Per-image limit",
      value: `Up to ${MAX_IMAGE_MB} MB per image, assembled into one PDF on your device.`,
    },
    { label: "Page", value: IMAGE_PAGE_FACT },
  ],
  "text-to-pdf": [
    {
      label: "Source limit",
      value: `Plain-text sources up to ${MAX_SOURCE_MB} MB, typeset in your browser.`,
    },
    { label: "Page", value: TEXT_PAGE_FACT },
  ],
  "markdown-to-pdf": [
    {
      label: "Source limit",
      value: `Markdown sources up to ${MAX_SOURCE_MB} MB, rendered and typeset in your browser.`,
    },
    { label: "Supported syntax", value: MARKDOWN_SYNTAX_FACT },
    { label: "Page", value: TEXT_PAGE_FACT },
  ],
  "grayscale-pdf": [
    {
      // Not "Two presets": a spelled count must declare the list it counts
      // (`counted-facts.test.ts`), and naming both says it already.
      label: "Quality",
      value: `${grayscalePresetNames} — the resolution each page is rendered at.`,
    },
    {
      label: "Raster output",
      // grayscale.ts renders every page to a single-channel grayscale image
      // (a JPEG, or a lossless plane when that is smaller) and builds a NEW
      // document from those images — nothing of the source's text layer,
      // outline, links or form fields is copied across.
      value:
        "Every page becomes a grayscale image, so text is no longer selectable or searchable, and links, bookmarks and form fields are not carried over.",
    },
    {
      label: "Undecodable images",
      value:
        "An image your browser cannot decode comes out blank, and the result says how many did.",
    },
  ],
  "pdf-to-markdown": [
    {
      label: "Structure",
      value: `The file name becomes the # title, a PDF with more than one page gets a ## Page N heading before each page's text, and short lines set at least ${PDF_TO_MARKDOWN_HEADING_PERCENT}% larger than the body text become headings.`,
    },
    {
      label: "Paragraphs and lists",
      value:
        "Lines that wrap are joined into paragraphs, split where the page leaves a wider gap or indents a line; a line that starts with a list marker (-, *, +, •, ▪ or a number) stays a list item.",
    },
    {
      label: "Not rebuilt",
      value: `Tables, images and text styling are not recreated — table rows come through as plain text. For tables, use ${toolName("extract-tables")}.`,
    },
  ],
  "pdf-to-text": [
    {
      label: "Output",
      value:
        "The PDF's embedded text as a plain .txt file, previewed on the page before you download it.",
    },
  ],
  "pdf-to-excel": [
    {
      label: "Cells",
      // Said "Blank cells are dropped, so a value can shift left" until the
      // wave-1 L03 merge (2026-09-28): the engine then placed cells by column
      // position (workers/pdf-office-export/layout-grid.ts). The limits named
      // here are the ones layout-grid.ts documents as NOT promised;
      // claims-vs-capability.test.ts holds the blank-cell sentence to a
      // decoded XLSX in both directions.
      value: `Every line of text becomes a row, and each value goes in the column it sits in on the page, so an empty cell stays empty. ${XLSX_MERGE_CAVEAT}`,
    },
    {
      label: "Tables",
      value: `For tables detected by their layout, exported as CSV and Excel files, use ${toolName("extract-tables")}.`,
    },
  ],
  "pdf-to-jpg": [rasterFact("pdf-to-jpg")],
  "pdf-to-png": [rasterFact("pdf-to-png")],
  "compress-pdf": [
    {
      // Was "Two paths": a count with no list behind it. The value names both.
      label: "Where it runs",
      value:
        "Lossless structural repack always runs in your browser; deep image compression is an optional, clearly-labeled secure-worker step that needs a native engine.",
    },
  ],
  "ocr-pdf": [
    {
      label: "Languages",
      value: `${OCR_LANGUAGES.length} recognition languages advertised, up to ${MAX_OCR_LANGUAGES} per job — the worker's own live report governs which packs are actually installed.`,
    },
  ],
  "summarize-pdf": [
    {
      label: "Free allowance",
      value: aiAllowanceFactFor("summarize-pdf"),
    },
  ],
  "translate-pdf": [
    {
      label: "Free allowance",
      value: aiAllowanceFactFor("translate-pdf"),
    },
    {
      label: "Languages",
      value: `${TRANSLATE_LANGUAGES.length} languages to translate into — the source language is detected automatically, or picked from the same list.`,
    },
  ],
  "request-signatures": [
    {
      label: "Signers",
      value: `Up to ${MAX_REQUEST_SIGNERS} per request, each given a named, fillable signature field — with a date field beside it if you ask for one.`,
    },
  ],
  "ai-extract": [
    {
      label: "Free allowance",
      value: aiAllowanceFactFor("ai-extract"),
    },
  ],
  "chat-with-pdf": [
    {
      label: "Free allowance",
      value: aiAllowanceFactFor("chat-with-pdf"),
    },
  ],
};

export function toolFacts(slug: string): readonly ToolFact[] {
  return FACTS[slug] ?? [];
}

/** The slugs with authored facts — exported so tests can pin the scoped set. */
export const FACTS_SLUGS = Object.keys(FACTS);

/* ------------------------------------------------------------------ *
 *  FAQ — derived by construction: every answer is built from the mode,
 *  the governing constants, or a fact above. No entry is speculative.
 * ------------------------------------------------------------------ */

export interface ToolFaqEntry {
  readonly question: string;
  readonly answer: string;
}

/**
 * What an in-browser tool's offline answer says about the network — and what
 * it must NOT say.
 *
 * It said "a dropped connection does not interrupt work in progress", on every
 * in-browser page and six guides. Then it said that with "One exception" — the
 * font a text-drawing engine fetches mid-run — which made the font fetch the
 * ONLY mid-run dependency. It is not: every pdfjs `getDocument` spreads
 * `PDFJS_DOCUMENT_DEFAULTS` (`src/lib/pdf/wasm-assets.ts`), so pdfjs fetches
 * its JPEG 2000 / JBIG2 decoders and its CJK character maps from our origin
 * the moment a page needs one — mid-render, mid-extraction. PDF to JPG, PDF to
 * PNG, Grayscale, Redact, the text extractors and every thumbnail grid depend
 * on that, and the page told readers and Google otherwise.
 *
 * So the answer makes no exclusivity claim at all. It says the engine arrives
 * in parts, and then names each document-dependent fetch the tool's runner can
 * actually reach. `tool-page-substance.test.ts` DISCOVERS the fetch sites (every
 * `fetch(` and every `getDocument` in the code a runner calls) and walks each
 * runner's call graph to them, so this table is held to the code in both
 * directions, and a runner that reaches an unclassified fetch fails loudly.
 */
export type MidRunFetch = "drawing-font" | "image-decoder" | "character-map";

export const MID_RUN_FETCH_SENTENCE: Readonly<Record<MidRunFetch, string>> = {
  "drawing-font":
    "Drawing text in a script outside the Western European alphabet downloads a matching font from our site the first time it is needed, and that step needs a connection.",
  "image-decoder":
    "Rendering a page that holds a JPEG 2000 or JBIG2 image, as scanned documents often do, downloads an image decoder from our site the first time it is needed, and that step needs a connection.",
  "character-map":
    "Chinese, Japanese or Korean text whose font is not embedded in the PDF needs a character map, downloaded from our site the first time it is needed, and that step needs a connection.",
};

/**
 * Per runner, the document-dependent fetches its call graph reaches. A full
 * `Record` over `RunnerKind`, so a new runner is a compile error until someone
 * decides — and the test then checks the decision against the code.
 */
export const RUNNER_MID_RUN_FETCHES: Readonly<
  Record<RunnerKind, readonly MidRunFetch[]>
> = {
  merge: ["image-decoder", "character-map"],
  split: [],
  rotate: ["image-decoder", "character-map"],
  "delete-pages": ["image-decoder", "character-map"],
  "extract-pages": ["image-decoder", "character-map"],
  organize: ["image-decoder", "character-map"],
  compress: [],
  "pdf-to-text": ["character-map"],
  "pdf-to-markdown": ["character-map"],
  "text-to-pdf": ["drawing-font"],
  "markdown-to-pdf": ["drawing-font"],
  "image-to-pdf": [],
  "pdf-to-image": ["image-decoder", "character-map"],
  "page-numbers": ["drawing-font"],
  watermark: ["drawing-font"],
  "header-footer": ["drawing-font"],
  crop: [],
  sign: ["drawing-font"],
  flatten: [],
  overlay: [],
  grayscale: ["image-decoder", "character-map"],
  redact: ["image-decoder", "character-map"],
  "fill-forms": [],
  "create-forms": [],
  annotate: ["drawing-font"],
  edit: ["drawing-font"],
  "extract-images": [],
  compare: ["character-map"],
};

/** The document-dependent fetches the tool behind `slug` can make mid-run. */
export function midRunFetches(slug: string): readonly MidRunFetch[] {
  const kind = getRunnerKind(slug);
  if (!kind) throw new Error(`midRunFetches: ${slug} mounts no runner`);
  return RUNNER_MID_RUN_FETCHES[kind];
}

/** How the engine arrives — true of every in-browser tool, exclusive of nothing. */
export const ENGINE_ARRIVES_FACT =
  "The page and its processing engine load over the network, and parts of the engine are fetched the first time a step needs them. The processing itself runs on your device.";

/**
 * The in-browser offline answer for one tool: how the engine arrives, then
 * every fetch its runner can make because of what is in the document.
 */
export function offlineAnswer(slug: string): string {
  return [
    ENGINE_ARRIVES_FACT,
    ...midRunFetches(slug).map((f) => MID_RUN_FETCH_SENTENCE[f]),
  ].join(" ");
}

/** The list a reader types to pick every other page (parsed by `parsePageList`). */
export const EVERY_OTHER_PAGE_EXAMPLE = "2, 4, 6, 8";

/** A document-level part of a PDF: what a page tool's export may or may not keep. */
export type DocumentPart =
  | "bookmarks"
  | "form"
  | "titleAuthor"
  | "pageLabels"
  | "language"
  | "attachments"
  | "tags";

export const DOCUMENT_PARTS: readonly DocumentPart[] = [
  "bookmarks",
  "form",
  "titleAuthor",
  "pageLabels",
  "language",
  "attachments",
  "tags",
];

/** Each part as the answers name it, in a list. */
const DOCUMENT_PART_NAME: Record<DocumentPart, string> = {
  bookmarks: "bookmarks",
  form: "fillable form fields",
  titleAuthor: "the title and author",
  pageLabels: "page labels",
  language: "the document language",
  attachments: "attached files",
  tags: "a tagged PDF's accessibility tags",
};

/** The two document states the page assembler builds (`AssembleOptions`). */
export type PageToolState = "subset" | "merge";

/**
 * What each state of the page assembler (`src/lib/pdf/page-copy.ts`
 * `AssembleOptions`, with `document-structure.ts`) carries besides the pages.
 * `tool-page-substance.test.ts` runs the engine each page runner calls on a
 * PDF that has every part and holds the served answer's state to this table.
 */
export const PAGE_TOOL_CARRIES: Readonly<
  Record<PageToolState, Readonly<Record<DocumentPart, boolean>>>
> = {
  subset: {
    bookmarks: true,
    form: true,
    titleAuthor: true,
    pageLabels: true,
    language: true,
    attachments: false,
    tags: false,
  },
  merge: {
    bookmarks: true,
    form: true,
    titleAuthor: false,
    pageLabels: false,
    language: false,
    attachments: false,
    tags: false,
  },
};

/** How bookmarks and fields come across, in each state that keeps both. */
const BOOKMARKS_AND_FORM: Record<PageToolState, string> = {
  subset:
    "Bookmarks and form fields travel with the pages you keep: a bookmark to a kept page still opens it, and the kept pages' fields stay fillable with their values. A bookmark that opens only a page you left out is not carried.",
  merge:
    "Every file's bookmarks come across, one file's after another, and every file's form fields stay fillable with their values; a field whose name an earlier file already uses is renamed, so two copies of one form keep separate answers.",
};

const capitalized = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

/**
 * What a page tool's export keeps, composed from {@link PAGE_TOOL_CARRIES}:
 * so the sentence and the table cannot disagree, and the test holds the
 * table to the engine. `inPlaceWhenOnlyTurned` is Organize's: a plan that
 * keeps every page once, in order, is saved in place (`organizePages`), and
 * stamp() still rewrites its Producer, Creator and ModDate — the sentence said
 * it "keeps everything" until 2026-10-08 (tool-page-substance.test.ts runs
 * that plan and requires each rewritten entry to be named).
 */
export function pageToolKeeps(
  state: PageToolState,
  { inPlaceWhenOnlyTurned = false }: { inPlaceWhenOnlyTurned?: boolean } = {},
): string {
  const carries = PAGE_TOOL_CARRIES[state];
  if (!carries.bookmarks || !carries.form) {
    throw new Error(
      `pageToolKeeps: no sentence for a ${state} export that drops bookmarks or the form`,
    );
  }
  const others = DOCUMENT_PARTS.filter(
    (p) => p !== "bookmarks" && p !== "form",
  );
  const kept = others
    .filter((p) => carries[p])
    .map((p) => DOCUMENT_PART_NAME[p]);
  const dropped = others
    .filter((p) => !carries[p])
    .map((p) => DOCUMENT_PART_NAME[p]);
  return [
    BOOKMARKS_AND_FORM[state],
    kept.length > 0 ? `The file also keeps ${listed(kept)}.` : "",
    dropped.length > 0
      ? `${capitalized(listed(dropped))} ${dropped.length > 1 ? "are" : "is"} not carried.`
      : "",
    inPlaceWhenOnlyTurned
      ? "If you only turn pages, the export is not rebuilt at all: the file is saved in place and keeps everything, attached files and tags included, except its Producer and Creator entries, which now name pdf.xyz, and its modification date, which becomes the time you exported."
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The bookmarks question's answer for a page tool in `state`. */
export function pageToolKeepsAnswer(
  state: PageToolState,
  options: { inPlaceWhenOnlyTurned?: boolean } = {},
): string {
  return `Yes. ${pageToolKeeps(state, options)}`;
}

/**
 * The bookmarks question, asked of every runner whose engine builds its
 * export through the page assembler.
 *
 * CHANGED 2026-10-06 (history kept). This answered "No. " + PAGE_REBUILD_KEEPS
 * — "the export is rebuilt from the pages alone, so the document's bookmarks
 * and its fillable form are not carried over" — on Organize, Delete, Merge,
 * Split and Extract, and in the Delete Pages guide. That was true when the
 * engines called `copyPages` into `PDFDocument.create()`, and wave 1's page
 * assembler made it false: a subset carries the bookmarks, the kept pages'
 * form, the title, author, page labels and language, and a merge every file's
 * bookmarks and form. The test meant to hold the sentence to the engine read
 * a fixture whose outline had no items, so "No" passed for every engine. The
 * answer is now composed from PAGE_TOOL_CARRIES, and
 * `tool-page-substance.test.ts` runs each runner's engine on a file with a
 * real bookmark, form, title and attachment and holds the table to it.
 */
function rebuildEntry(
  tool: Tool,
  state: PageToolState,
  options: { inPlaceWhenOnlyTurned?: boolean } = {},
): ToolFaqEntry {
  return {
    question: `Does ${tool.name} keep bookmarks and form fields?`,
    answer: pageToolKeepsAnswer(state, options),
  };
}

/**
 * Names Split PDF gives two pieces of `report.pdf`, built by the same
 * `buildSplitParts` the runner calls — so the example cannot drift from the
 * names a reader actually downloads.
 */
export const SPLIT_NAME_EXAMPLES: readonly string[] = buildSplitParts(
  "report",
  [
    { start: 0, end: 2 },
    { start: 3, end: 3 },
  ],
).map((part) => part.name);

/**
 * Asked of the in-browser tools that read a PDF's text layer and nothing else
 * (`extractPdfText` performs no OCR, and says so by returning `hasText:false`).
 */
function scannedTextEntry(tool: Tool): ToolFaqEntry {
  return {
    question: `Does ${tool.name} work on a scanned PDF?`,
    answer: `Not on its own. ${tool.name} reads the text a PDF already contains, and a scanned page is a picture with no text inside it, so there is nothing to read. Run the scan through ${toolName("ocr-pdf")} first, then use the result here.`,
  };
}

/** A whole-number percentage of a 0–1 share, as the answers print it. */
const percent = (share: number) => Math.round(share * 100);

/** "Label (N DPI)" for each preset, the way the runners label their buttons. */
const dpiChoices = (presets: readonly { label: string; dpi: number }[]) =>
  listed(
    presets.map((p) => `${p.label} (${p.dpi} DPI)`),
    "or",
  );

/**
 * Questions only one runner can answer, keyed by the runner a tool mounts
 * (`getRunnerKind`) so the two tools sharing a runner cannot drift apart.
 * Every answer is either a constant the engine draws with or a behaviour a
 * test runs the engine to confirm — never a description of a UI nobody built.
 */
function runnerFaq(tool: Tool): ToolFaqEntry[] {
  switch (getRunnerKind(tool.slug)) {
    case "organize":
      return [
        {
          question: `Can I undo a change in ${tool.name}?`,
          answer:
            "Yes. “Undo” and “Redo” (Ctrl/⌘+Z and Ctrl/⌘+Shift+Z) step back and forward through your moves, rotations, duplicates and deletions before you export, and “Reset” returns the board to the file as you opened it. Your original file is never changed — the export is a new PDF.",
        },
        rebuildEntry(tool, "subset", { inPlaceWhenOnlyTurned: true }),
      ];
    case "delete-pages":
      return [
        rebuildEntry(tool, "subset"),
        {
          question: "How do I delete every other page?",
          answer: `Type the pages as a list — for example ${EVERY_OTHER_PAGE_EXAMPLE} — and press “Select”; those pages are selected, and “Delete” removes them.`,
        },
        {
          question: "Can I get a deleted page back?",
          answer:
            "Yes, from your original: it is never changed. The download is a new PDF, so every page you removed is still in the file on your device.",
        },
      ];
    case "rotate":
      return [
        {
          question: `Does rotating reduce the quality of my PDF?`,
          answer:
            "No. The turn is saved as each page's orientation setting in the file; the page's text, images and drawings are left as they are, not re-rendered.",
        },
        {
          question: "Is the rotation permanent?",
          answer:
            "Yes — it is saved in the PDF you download, so every viewer shows the pages the way you turned them.",
        },
      ];
    case "image-to-pdf":
      return [
        {
          question: `What page size does ${tool.name} use?`,
          answer: `${IMAGE_PAGE_FACT} There is no page-size, orientation or margin setting.`,
        },
        {
          question: `Can I combine several images into one PDF?`,
          answer:
            "Yes — each image becomes one page, in the order shown. Use “Move up” and “Move down” to change it before you create the PDF.",
        },
        ...(tool.accept.includes("PNG")
          ? [
              {
                question: "What happens to transparent areas of a PNG?",
                answer:
                  "They show as white: each page is filled white before the image is drawn on it.",
              },
            ]
          : []),
      ];
    case "pdf-to-image": {
      const format = rasterFormatForSlug(tool.slug);
      const ext = format.toUpperCase();
      return [
        {
          question: `What resolution are the ${ext} images?`,
          answer: `You choose: ${RASTER_RESOLUTION_CHOICES}. Higher DPI gives sharper, larger files. Neither side of a rendered page may exceed ${RASTER_MAX_DEVICE_PX.toLocaleString("en-US")} pixels, so a very large page is rendered below the preset.`,
        },
        {
          question: `Do I get one ${ext} or a ZIP?`,
          answer: `A one-page PDF downloads as a single ${ext} named after your file. With more than one page, every page goes into one ZIP, named in reading order — for example ${pageImageName("report.pdf", 2, 12, format)} — and the first ${RASTER_PREVIEW_LIMIT} pages can also be saved one by one from their previews.`,
        },
      ];
    }
    case "text-to-pdf":
      return [
        {
          question: `What does the PDF from ${tool.name} look like?`,
          answer: `${TEXT_PAGE_FACT} There is no page-size or margin setting.`,
        },
      ];
    case "markdown-to-pdf":
      return [
        {
          question: "Which Markdown does it support?",
          answer: MARKDOWN_SYNTAX_FACT,
        },
        {
          question: `What does the PDF from ${tool.name} look like?`,
          answer: `${TEXT_PAGE_FACT} There is no page-size or margin setting.`,
        },
      ];
    /*
     * Below: the questions a searcher asks of each remaining in-browser tool
     * (audited at 67e8d0f, twenty-eight pages answered only the templated
     * upload / offline / size questions). `tool-faq-substance.test.ts` runs the
     * engine each answer describes and reads the answer off the served page.
     */
    case "merge":
      return [
        {
          question: "Can I merge PDFs with different page sizes?",
          answer:
            "Yes. Every page keeps its own size and orientation: nothing is resized or turned to match the others, so a Letter page and an A4 page sit side by side in the merged file, each as it was.",
        },
        {
          question: "Can I merge password-protected PDFs?",
          answer: `Not while they are locked. A password-protected PDF is turned away when you add it, with a note saying so; remove the password with ${toolName("unlock-pdf")}, then add the unlocked copy.`,
        },
        rebuildEntry(tool, "merge"),
      ];
    case "split":
      return [
        {
          question: `How are the files from ${tool.name} named?`,
          answer: `After your file, then each piece's number and the pages it holds — for example ${listed(SPLIT_NAME_EXAMPLES)}. More than one piece downloads as a ZIP; a single piece saves as a PDF.`,
        },
        rebuildEntry(tool, "subset"),
      ];
    case "extract-pages":
      return [
        {
          question: `Can ${tool.name} change the order of the pages?`,
          answer: `No. The new PDF keeps the pages you pick in their original order, whatever order you pick them in. To put pages in a new order, use ${toolName("organize-pages")}.`,
        },
        rebuildEntry(tool, "subset"),
      ];
    case "compress":
      // A hybrid tool: the privacy answers above already split the two paths,
      // and these keep the same split — the browser step is lossless, and only
      // the worker step the user starts changes any pixel.
      return [
        {
          question: "Does compressing reduce the quality of my PDF?",
          answer: `Not in your browser: that step re-saves the same pages, packed more tightly, and every page looks exactly as before. Only the optional secure-worker step changes quality — it lowers the resolution of images sharper than the level you pick: ${dpiChoices(DEEP_COMPRESSION_PRESETS)}. Its Grayscale switch is off unless you tick it: ${DEEP_COMPRESSION_GRAYSCALE_HINT}`,
        },
        {
          question: "How much smaller will my PDF get?",
          answer: `That depends on what the file holds, so no figure is promised in advance. The in-browser step measures the exact saving before you download, and offers the download only when the file got smaller. When it saves little and images make up ${percent(IMAGE_HEAVY_SHARE)}% or more of the file, it points you to the secure-worker step, which is where the images themselves are made smaller.`,
        },
      ];
    case "sign":
      return [
        {
          question: `Is a signature from ${tool.name} legally binding?`,
          answer: `That depends on the document, the law that governs it and the person who receives it — pdf.xyz cannot decide it for you. What ${tool.name} makes is a visible mark on the page: you ${listed(
            SIGNATURE_SOURCES.map((s) => SIGNATURE_SOURCE_FACT[s]),
            "or",
          )}. It is not a certificate-based digital signature — the file carries no certificate and nothing that would show a later change. Where a verifiable signature is required, use a certificate-based signing service.`,
        },
        {
          question: "Can I sign more than one page?",
          answer: `Each run places one signature, on the page you choose. To sign another page, open the signed PDF in ${tool.name} again and place the next one.`,
        },
      ];
    case "edit":
      return [
        {
          question: `Can ${tool.name} change the text already in my PDF?`,
          answer: `No. ${tool.name} adds new content on top of the page — ${listed(
            EDIT_OP_TYPES.map((t) => EDIT_OP_FACT[t]),
          )} — and the text and objects already there are kept exactly as they were. It cannot retype, move or delete the existing text. To rework the existing text, convert the file with ${toolName("pdf-to-word")}.`,
        },
        {
          question: "How do I cover something up?",
          answer: `Draw a filled box over it. That hides it on the page, but the text underneath is still in the file, where it can be selected, copied or searched. To remove something for good, use ${toolName("redact-pdf")}.`,
        },
      ];
    case "annotate":
      return [
        {
          question: "Will my markup show up as comments in other PDF readers?",
          answer: `No. ${tool.name} draws its ${listed(
            ANNOTATION_TYPES.map((t) => ANNOTATION_FACT[t]),
          )} into the page itself rather than adding comment objects, so a reader shows them as part of the page: they are not listed as comments, and they cannot be replied to, hidden or edited there.`,
        },
        {
          question: "How do I place a highlight?",
          answer: `By position and size, in points measured from the page's bottom-left corner (${PT_PER_INCH} points to an inch): set “X (pt)”, “Y (pt)”, “Width (pt)” and “Height (pt)”. A highlight is a see-through box, so it covers whatever lies under it rather than following the words.`,
        },
      ];
    case "watermark":
      return [
        {
          question: "Can I use an image or logo as the watermark?",
          answer: `Yes: switch the Watermark type to Image and drop a PNG or JPEG. Image size sets its width as a share of the page width, and it takes the same opacity, angle, position and tiling as text. For a full letterhead kept as a PDF, ${toolName("overlay-pdf")} draws a page of that PDF on each of yours instead.`,
        },
        {
          question: "Can someone remove the watermark?",
          answer:
            "Not by switching it off: it is drawn into every page's content, not added as a layer or a comment a reader can hide. Anyone with a PDF editor can still delete drawn text, though, so a watermark labels a document; it does not lock it.",
        },
      ];
    case "page-numbers":
      return [
        {
          question: "Can I leave the cover page unnumbered?",
          answer:
            "Yes. Set “Start on page” to the first page that should carry a number — the pages before it are left as they are — and “First number” to the number that page should show. {total} is the last number printed: “First number” plus the count of numbered pages, minus one. Set “First number” to the same value as “Start on page” and the cover is counted, so {total} is the document's full page count. Ticking “Leave the cover unnumbered” does the same for a one-page cover: page 1 is counted but carries no number.",
        },
      ];
    case "header-footer":
      return [
        {
          question: "What can a header or footer show?",
          answer:
            "Any text you type, plus {n} for the page number, {total} for the number of pages and {date} for today's date, written the way your device writes dates — or, when that form has characters none of our fonts can draw beside your text, in Latin digits in the same order, or as YYYY-MM-DD. Each is one line, aligned left, center or right.",
        },
        {
          question: "Can I leave the first page without a header or footer?",
          answer: `No: the header and footer go on every page. To number the pages but skip a cover, use ${toolName("page-numbers")}, which can start on a later page.`,
        },
      ];
    case "crop":
      return [
        {
          question: "Does cropping delete what is outside the crop?",
          answer: `No. ${tool.name} changes each page's visible area — the crop box every viewer and printer follows — so what lies outside it is hidden, not removed, and is still in the file. To take something out for good, use ${toolName("redact-pdf")}.`,
        },
        {
          question: "What units are the crop margins in?",
          answer: `Points, measured in from each edge — ${PT_PER_INCH} points to an inch. A page is never cropped smaller than ${MIN_CROP_DIMENSION} points in either direction.`,
        },
      ];
    case "flatten":
      return [
        {
          question: `What does ${tool.name} flatten?`,
          answer:
            "Each fillable form field — text boxes, checkboxes, radio buttons, dropdowns, list boxes and push buttons — is drawn into the page as it appears and removed as a field, unless it cannot be drawn: then it is left interactive and listed in the result with the reason. Signature fields are always left as signature fields.",
        },
        {
          question: "What if my PDF has no form fields?",
          answer:
            "Nothing is flattened: the file is re-saved as it is, and the result says no fillable form fields were found. A dynamic XFA form, whose fields exist only in Adobe's XFA layer, is refused instead, before anything is saved.",
        },
        {
          question: "Can every filled form be flattened?",
          answer:
            "Not yet. An answer that has to be redrawn with the form's built-in font and holds characters outside the basic PDF alphabet — Bengali, Chinese or Greek, for example — is refused with a message saying so, rather than flattened with those characters missing. A dynamic XFA form is refused before anything is saved.",
        },
        {
          question: "Can a flattened form be edited again?",
          answer:
            "Not the fields that were flattened: each one is drawn into the page and removed as a field, so no PDF reader offers it for editing. Signature fields stay signature fields, and any field the result lists as left as-is is still editable. Keep your original if you might need to change an answer.",
        },
        {
          question: `Does ${tool.name} flatten comments and annotations too?`,
          answer:
            "No — only fillable form fields: text boxes, checkboxes, radio buttons, dropdowns, list boxes and push buttons. Comments, ink drawings and layers are saved as they were.",
        },
      ];
    case "overlay":
      return [
        {
          question: "Can I add a letterhead or logo to every page?",
          answer:
            "Yes. Save it as a PDF and add it as the overlay: its first page is drawn over every page of your document. With a multi-page overlay you can choose “Cycle pages” instead, to use its pages in turn.",
        },
        {
          question: "How is the overlay sized on each page?",
          answer: `${OVERLAY_FITS.map((f) => `${f.label}: ${f.hint}`).join(" ")} Your own pages keep their size either way.`,
        },
      ];
    case "grayscale":
      return [
        {
          question: "Can I still select and search the text after converting?",
          answer:
            "No. Every page is rendered to a grayscale image and the PDF is rebuilt from those images, so text, links and form fields become part of the picture. Keep your original for anything you need to search or copy.",
        },
        {
          question: `What resolution does ${tool.name} use?`,
          answer: `You choose: ${dpiChoices(GRAYSCALE_DPI_PRESETS)}. The higher setting gives sharper pages and a larger file.`,
        },
      ];
    case "fill-forms":
      return [
        {
          question:
            "Can I stop the answers being changed after I fill them in?",
          answer:
            "Yes. Tick “Flatten after filling”: the values are drawn into the page and the fields removed, so the download can no longer be edited as a form. Leave it unticked and the fields stay fillable.",
        },
        {
          question: `Why does ${tool.name} find no fields in my PDF?`,
          answer: `Because the PDF has no fillable form. A scanned form, or one with only printed lines and boxes, has nothing to fill: add fields with ${toolName("create-forms")} first, or place text with ${toolName("edit-pdf")}. A form built only in XFA, an older dynamic format, is not read either.`,
        },
      ];
    case "create-forms":
      return [
        {
          question: `Can ${tool.name} add a signature field?`,
          answer: `No. It adds ${listed(
            NEW_FIELD_TYPES.map((t) => FIELD_TYPE_FACT[t]),
          )}. To sign a document yourself, use ${toolName("sign-pdf")}; to prepare one for other people to sign, use ${toolName("request-signatures")}.`,
        },
        {
          question: "How do I place a field?",
          answer: `By numbers: pick the “Page”, then set “X” and “Y” — points from the page's bottom-left corner, ${PT_PER_INCH} to an inch — and the field's “Width” and “Height”.`,
        },
      ];
    case "extract-images":
      return [
        {
          question: "Are the images extracted at full quality?",
          answer:
            "Yes. Each image is taken out of the file as it is stored, at its own resolution: a JPEG is saved byte for byte, and other images are rebuilt losslessly as PNG. No page is rendered and nothing is re-compressed.",
        },
        {
          question: "Why are some images skipped?",
          answer:
            "Some ways of storing an image cannot be turned back into an ordinary picture file faithfully — JPEG 2000, black-and-white fax images (CCITT and JBIG2), CMYK and other print-colour images (palette images built on them included), and images written inline in a page's drawing instructions among them. Those are listed as skipped, with the reason, instead of being guessed at.",
        },
      ];
    case "compare":
      return [
        {
          question: `What does ${tool.name} compare?`,
          answer:
            "The selectable text, line by line, plus the page count and the file size. A change to images, layout, fonts or colors that leaves the text the same does not show up.",
        },
        {
          question: `What counts as a change in ${tool.name}?`,
          answer:
            "A line of selectable text that is in one PDF and not the other. Lines only in the first PDF are listed as removed (-), and lines only in the second as added (+). Extra spaces inside a line and blank lines are ignored.",
        },
        {
          question: `Can ${tool.name} compare scanned PDFs?`,
          answer: `Not on their own: a scanned page is a picture with no text inside it, so there is nothing to compare. Run both files through ${toolName("ocr-pdf")} first, then compare the results.`,
        },
      ];
    case "pdf-to-text":
      return [
        {
          question: `Does ${tool.name} keep the layout?`,
          answer:
            "No. You get the words as plain text — one block per page, with a blank line between pages — without fonts, images, columns or table layout.",
        },
        scannedTextEntry(tool),
      ];
    case "pdf-to-markdown":
      return [
        {
          question: `Does ${tool.name} keep headings, bold text and tables?`,
          answer: `Partly. A PDF stores text as positioned lines, not as headings or tables, so the converter infers structure from size and position. The file's name becomes the title, each page gets a "Page N" heading when there is more than one, short lines set at least ${PDF_TO_MARKDOWN_HEADING_PERCENT}% larger than the body text become headings, lines are joined into paragraphs, and lines that begin with a bullet (-, *, + or a character such as •) or a number stay list items. Bold, italics, links and table layout are not carried over — table rows come through as plain text — and images are not exported. For tables, ${toolName("extract-tables")} detects them by their layout and exports CSV and Excel files.`,
        },
        scannedTextEntry(tool),
      ];
    case "redact":
      // The two questions a searcher asks before trusting a redaction tool.
      // `redact-answers.test.ts` holds both to the file `assembleRedactedPdf`
      // writes.
      return [
        {
          question: "Can the redacted text be recovered?",
          answer: REDACT_RECOVERY_ANSWER,
        },
        {
          question: "Is the redacted PDF still searchable?",
          answer: REDACT_SEARCH_ANSWER,
        },
      ];
    default:
      return [];
  }
}

/** What each file in a signature-request package is for, keyed like the package. */
const REQUEST_PACKAGE_ROLE: Readonly<
  Record<keyof typeof REQUEST_PACKAGE_FILES, string>
> = {
  prepared: "the PDF with each signer's fields added",
  manifest:
    "a manifest recording the signers, their fields and the signing order",
  audit: "an audit trail holding the request's preparation event",
  readme: "a README explaining the package",
};

/** "a, b, c and d" (or "a, b or c"). */
function listed(
  items: readonly string[],
  conjunction: "and" | "or" = "and",
): string {
  return items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} ${conjunction} ${items.at(-1)}`;
}

/**
 * What PDF to Word's DOCX holds. The catalogue and the guide said "preserving
 * layout and text flow" for the life of the product; `worker-tool-answers.test.ts`
 * decodes the DOCX the engine writes from REAL poppler output and holds each
 * clause of this sentence to it (and bans that one).
 *
 * Said "Each line of the PDF's selectable text becomes its own paragraph"
 * until the wave-1 L03 merge (2026-09-28), when the engine began reading
 * poppler's reading order (`workers/pdf-text/flow.ts`). The table clause is
 * limited to cells that fit on one line: flow.ts documents that a table whose
 * cells wrap is read in poppler's order instead.
 *
 * CHANGED 2026-10-17, with the engine (`pdf-office-export/docx-layout.ts`):
 * it said "Images, tables, fonts, colors and the page layout are not carried
 * over", true until then. Every raster picture now comes through between the
 * paragraphs above and below it, at the size the page shows it, scaled down
 * only to fit the Word page's text area; `worker-tool-answers.test.ts` runs
 * a page with a picture and holds the picture clause to the .docx.
 *
 * CHANGED with the review of 2026-10-17: what the page draws over a picture
 * is drawn into it (so "drawings made of lines and shapes" are kept THERE,
 * and left behind elsewhere), and "each picture" has its exception — the
 * pictures past MAX_DOCX_PICTURES, one file's size or one conversion's time
 * are left out and counted. `claims-vs-capability.test.ts` holds both.
 */
export const PDF_TO_WORD_KEEPS = `The text arrives as paragraphs in reading order: lines that wrap in the PDF are joined into one paragraph, a page set in two columns is read one column at a time, and a table whose cells each fit on one line comes through one row per line, its cells separated by tabs. Each picture on a page, such as a photo, a screenshot or a scan, comes through on a line of its own between the paragraphs above and below it, at the size the page shows it, scaled down if it is wider or taller than the Word page, with anything the page draws over it, such as a box or an arrow, drawn into it. Past ${MAX_DOCX_PICTURES.toLocaleString("en-US")} pictures, or past the size of one file or the time one conversion may take, a document's remaining pictures are left out and counted in the note beside the download; the text still comes through whole. Tables, fonts, colors, drawings made of lines and shapes elsewhere on the page, and the page layout are not carried over, and bold or italics only where a whole paragraph is set in them, so the text arrives in Word's default style, ready to format — not as a copy of the page.`;

/** Every language Translate PDF offers, named, from the list its panel renders. */
export const TRANSLATE_LANGUAGES_ANSWER = `${TRANSLATE_LANGUAGES.length} languages: ${listed(
  TRANSLATE_LANGUAGES.map((c) => LANGUAGE_NAMES[c]),
)}. The source language is detected automatically (“Auto-detect”), or you can pick it from the same list.`;

/**
 * What Repair PDF takes in and what it refuses to hand back — the input floor
 * (`looksRepairable`, via `acceptsDamagedPdf`) and the output check
 * (`looksLikePdf`) of `workers/pdf-structure/engine.ts`, which
 * `worker-tool-answers.test.ts` runs on a truncated file, a non-PDF and a
 * repair that returns rubble.
 */
export const REPAIR_TAKES =
  "Any file that starts like a PDF, including one that is truncated or whose internal structure is broken: the worker rewrites what it can read into a new, well-formed PDF. If what comes back is still not a readable PDF, the job fails and you get no file rather than a broken one. A file that does not start like a PDF is refused.";

/** What the warning list beside a repaired download means (`RepairWarnings`). */
export const REPAIR_WARNINGS_ANSWER =
  "That the file was damaged and has been rebuilt. The repair succeeded, and the list under “This PDF was damaged and has been rebuilt.” names what had to be reconstructed, so you can check those parts against your original. A file that needed no reconstruction comes back without the list.";

/**
 * Addresses the URL check refuses, named in Webpage to PDF's answer —
 * exported so `worker-tool-answers.test.ts` can put each one through the
 * worker's own `isSafePublicHttpUrl` and require a refusal.
 */
export const PRIVATE_ADDRESS_EXAMPLES = ["localhost", "192.168.1.1"] as const;

/**
 * Questions only one secure-worker tool can answer. Each answer describes what
 * that tool's engine writes, and `worker-tool-answers.test.ts` RUNS the engine
 * — decoding the DOCX's paragraphs, the XLSX's cells, the PPTX's slides and
 * the signature-request package — to hold the served page to it.
 */
function workerFaq(tool: Tool): ToolFaqEntry[] {
  const scanned: ToolFaqEntry = {
    question: `Can ${tool.name} convert a scanned PDF?`,
    answer: `Not directly. A scanned page is a picture with no selectable text: a PDF with none at all is refused rather than exported empty, and in a PDF that mixes the two, the scanned pages come through with no text. Run the scan through ${toolName("ocr-pdf")} first, then export the result.`,
  };
  switch (tool.slug) {
    case "pdf-to-word":
      // CHANGED 2026-10-17: "Its selectable text, and nothing else." and the
      // shared `scanned` answer, whose "the scanned pages come through with
      // no text" left out that their pictures now come through.
      return [
        {
          question: `What does ${tool.name} keep from my PDF?`,
          answer: `Its selectable text and its pictures. ${PDF_TO_WORD_KEEPS}`,
        },
        {
          question: `Can ${tool.name} convert a scanned PDF?`,
          answer: `Not into text. A scanned page is a picture with no selectable text: a PDF with none at all is refused, since a document of page pictures would have nothing to edit, and in a PDF that mixes the two, each scanned page comes through as its picture, with no editable words. Run the scan through ${toolName("ocr-pdf")} first, then export the result: each page's scan then comes through as a picture, followed by its words as text.`,
        },
      ];
    case "pdf-to-excel":
      return [
        {
          question: `How does ${tool.name} lay out the spreadsheet?`,
          answer: `In one sheet, named “${XLSX_SHEET_NAME}”. Each line of the PDF's selectable text becomes a row, split into cells at ${XLSX_CELL_BREAK_PHRASE}, and each cell goes in the column where its text sits on the line, so an empty cell stays empty. A comma never splits a cell, and an amount or a percentage, such as ${listed([...XLSX_NUMBER_EXAMPLES], "or")}, is stored as a number a formula can add up. A date such as ${XLSX_TEXT_EXAMPLE} stays text, and nothing becomes a formula. ${XLSX_MERGE_CAVEAT}`,
        },
        {
          question: `Should I use ${tool.name} or ${toolName("extract-tables")}?`,
          answer: `For a table on its own, ${toolName("extract-tables")}: it looks for tables by where the text sits on the page and exports each one it finds. ${tool.name} puts every line of the PDF's text in one sheet, placing each value in the column it sits in, so it suits getting all of the text into a grid rather than pulling one table out.`,
        },
        scanned,
      ];
    case "pdf-to-powerpoint":
      // CHANGED 2026-10-10 with the engine (`pdf-office-export/page-scan.ts`).
      // Until then: "Each slide holds that page's selectable text in a single
      // text box, one paragraph per line. Images, drawings and the page's
      // layout are not carried over, and a page with no selectable text
      // becomes an empty slide." — and the shared `scanned` answer, which
      // said such a PDF "is refused". Both were true of that engine and are
      // false of this one; worker-tool-answers.test.ts runs it to hold these.
      // CHANGED 2026-10-11: "Every picture on the page is a picture on the
      // slide" was not true of a stencil mask or a repeated tile (drawn into
      // the drawing pictures), nor of a picture too large or undecodable
      // (left out, then silently; now counted and named in the note).
      // CHANGED again 2026-10-11 (the second review): "a picture of its own"
      // and "a text box … in its size, weight and colour" were not true of a
      // page drawn as ONE picture past MAX_LAYERS_PER_PAGE layers, and "the
      // note … names its page" was not true of a picture over
      // MAX_DECODED_IMAGE_PIXELS on a page the reader cannot read ahead (an
      // encrypted or damaged file). claims-vs-capability.test.ts held the
      // page to neither: it read `toolFacts()`, which is empty for this
      // tool, and never this answer. Both exceptions are now stated, from
      // the constants, and that test reads what the page serves.
      // CHANGED again the same day (the second re-review): an encrypted
      // page is now read (`standard-security.ts`) and an unreadable one is
      // held to the page budget, so the note's exception names neither
      // encrypted files nor a size: a page the worker cannot read before
      // it is drawn, as in a damaged PDF.
      return [
        {
          question: "What goes on each slide?",
          answer: `One slide per PDF page, in the same order, each the shape of the first page. A photo or screenshot on the page is a picture of its own on the slide, where the page shows it; every line of selectable text is a text box at its place, in its size, weight and colour, with its font matched rather than copied; and the page's other drawing, such as lines, boxes, backgrounds and stencilled images, comes as pictures. A page whose drawing would take more than ${MAX_LAYERS_PER_PAGE.toLocaleString("en-US")} such pictures to stack in order becomes one picture of the page instead, with its text in invisible text boxes over it, selectable but not shown. A picture too large for the worker, or one it cannot decode, is left out, and the note beside the download names its page, except on a page the worker cannot read before it is drawn, as in a damaged PDF, where a picture can be left out with no note. A page with nothing on it becomes an empty slide.`,
        },
        {
          question: `Can ${tool.name} convert a scanned PDF?`,
          answer: `Yes, as pictures. A scanned page has no selectable text, only a picture of its words, so its slide carries the page as a picture and those words are not editable text; the note beside the download names those pages. Run the scan through ${toolName("ocr-pdf")} first to have its words as text as well: the converted slides then carry them in invisible text boxes over each picture.`,
        },
      ];
    case "repair-pdf":
      return [
        {
          question: `Which damaged files can ${tool.name} take?`,
          answer: REPAIR_TAKES,
        },
        {
          question: "What does it mean when the repair lists warnings?",
          answer: REPAIR_WARNINGS_ANSWER,
        },
      ];
    case "pdf-to-pdfa":
      return [
        {
          question: `Is the ${PDF_A_STANDARD} file validated?`,
          answer: `No. Ghostscript converts the file to ${PDF_A_STANDARD}, but the result is not checked against the PDF/A specification, so treat it as a best-effort conversion rather than a certificate of compliance.`,
        },
        {
          question: "What does the conversion remove?",
          answer: `Whatever ${PDF_A_STANDARD} cannot hold. Ghostscript drops it and reports it, and up to ${MAX_TOOL_NOTES} of its messages are listed with your download under “What PDF/A could not keep:”, followed by a count of any it leaves out. Document metadata is the usual casualty.`,
        },
      ];
    case "request-signatures": {
      const files = (
        Object.keys(
          REQUEST_PACKAGE_FILES,
        ) as (keyof typeof REQUEST_PACKAGE_FILES)[]
      ).map((k) => `${REQUEST_PACKAGE_FILES[k]} (${REQUEST_PACKAGE_ROLE[k]})`);
      return [
        {
          question: `Does ${tool.name} email my signers?`,
          answer: `No. It prepares the request: you add up to ${MAX_REQUEST_SIGNERS} signers, and the worker adds a named, fillable field for each of them to the PDF and packages it for you to send. Nothing is sent from pdf.xyz, and nothing is signed until each signer fills in their fields.`,
        },
        {
          question: "What is in the download?",
          answer: `A ZIP holding ${listed(files)}.`,
        },
        {
          question: "How do my signers fill it in?",
          answer: `Each signer opens ${REQUEST_PACKAGE_FILES.prepared} and types into the fields named for them — in ${toolName("fill-forms")}, or in any PDF reader that fills form fields. They are text fields, not certified digital signatures.`,
        },
      ];
    }
    case "translate-pdf":
      return [
        {
          question: `Which languages can ${tool.name} translate into?`,
          answer: TRANSLATE_LANGUAGES_ANSWER,
        },
      ];
    case "webpage-to-pdf":
      return [
        {
          question: `Which pages can ${tool.name} convert?`,
          answer: `A public web page, by its http:// or https:// address. Addresses on a private network, such as ${listed(PRIVATE_ADDRESS_EXAMPLES, "or")}, are refused, and so is an address with a username or password written into it. The browser on our server has none of your cookies, so the page prints the way it looks to a first-time visitor — anything a site shows only to you will not be in it.`,
        },
      ];
    case "html-to-pdf":
      return [
        {
          question: "Will the images and styles my HTML links to appear?",
          answer:
            "Only those it can reach without other files from your computer: the .html file is uploaded on its own, so an image, stylesheet or script it links by a relative path (such as images/logo.png) is missing from the PDF. Styles written into the file itself, and files linked by a full web address, are loaded.",
        },
      ];
    case "protect-pdf":
      return [
        {
          question: `Which encryption does ${tool.name} use?`,
          answer: `AES only — the older RC4 cipher is never used. ${PDF_ENCRYPTION_LEVELS.map((level) => level.description).join(" ")} ${describePdfKeyLength(DEFAULT_PDF_KEY_LENGTH)} is the default. The password you set is the one needed to open the file.`,
        },
        {
          question: `Can ${tool.name} protect a PDF that already has a password?`,
          answer: `No — it is turned away rather than encrypted twice. That includes a PDF that opens without a password but has its printing, copying or editing locked by an owner (permissions) password. Remove the current password with ${toolName("unlock-pdf")} first — the one that opens the file, or that owner password — then protect the unlocked copy.`,
        },
        {
          question: "What if I forget the password?",
          answer: forgottenPasswordAnswer(),
        },
      ];
    case "unlock-pdf":
      return [
        {
          question: `Can ${tool.name} remove a password I don't know?`,
          answer:
            "No. You type the password that opens the PDF — or, if it opens without one, its owner (permissions) password; an empty one is refused — and the worker uses it to decrypt the file. It does not guess or crack passwords, and nothing is recovered or bypassed. With a wrong password the job fails and no file is produced.",
        },
        {
          question: "What if my PDF has no password?",
          answer:
            "Then there is nothing to unlock: the job stops and says so, and no file is produced. A PDF that opens freely but locks printing, copying or editing does have one — an owner (permissions) password — and Unlock removes those restrictions only with it.",
        },
      ];
    case "optimize-web":
      return [
        {
          question: `What does ${tool.name} change?`,
          answer:
            "It linearizes the PDF (Fast Web View): the parts needed to show the first page are moved to the front, with an index, so a browser that loads a PDF in pieces can show page one while the rest is still downloading. What is on the pages — text and images — is not changed.",
        },
        {
          question: `Does ${tool.name} make my PDF smaller?`,
          answer: `Not reliably — linearizing is not compression, and reducing size is not what it is for. It rearranges the file rather than compressing it, and the whole file is rewritten, so its size can change in either direction. To make a PDF smaller, use ${toolName("compress-pdf")}.`,
        },
      ];
    case "extract-tables":
      return [
        {
          question: `What does ${tool.name} download?`,
          answer:
            "A ZIP with one CSV file per table it found (table-1.csv, table-2.csv and so on) and tables.xlsx, an Excel workbook holding every table on its own sheet, named after the table's number and page.",
        },
        {
          question: `How does ${tool.name} find a table?`,
          answer:
            "By where the text sits: words set a normal space apart are joined into one cell, columns come from the white-space gutters that run down the rows, and a block is kept only where at least two columns hold values in two or more rows and one column holds short values rather than sentences. Ruled lines and cell borders are not read, so a table is found by its alignment alone.",
        },
        {
          question: `Can ${tool.name} read a scanned PDF?`,
          answer: `No. A scanned page is a picture with no selectable text, so the job stops and says so rather than guessing. Run the scan through ${toolName("ocr-pdf")} first, then extract from the result.`,
        },
      ];
    case "summarize-pdf":
      return [
        {
          question: "Can I choose how long the summary is?",
          answer: `Yes. Pick a length — ${listed(SUMMARY_LENGTHS, "or")} — and a shape — ${listed(SUMMARY_FORMATS, "or")} — and, if you like, name what it should focus on.`,
        },
      ];
    case "chat-with-pdf":
      return [
        {
          question: `Does ${tool.name} remember my earlier questions?`,
          answer: `The recent ones. Each new question is sent with up to the last ${MAX_CONTEXT_EXCHANGES} questions and answers — fewer when they are long — and the panel says when older ones are left out or a long message is shortened.`,
        },
      ];
    case "ai-extract":
      return [
        {
          question: `What can ${tool.name} pull out of my PDF?`,
          answer: `What you ask for, in one of two ways: list the fields you want — up to ${MAX_EXTRACTION_FIELDS}, each a ${listed(EXTRACTION_FIELD_TYPES, "or")} — or describe it in a prompt. You download a ZIP with the extracted data as JSON, a readable Markdown version of it and a manifest recording how it was made.`,
        },
      ];
    default:
      return [];
  }
}

/**
 * Asked of every AI tool. The result is a model's reading of the text, and a
 * page that answered only where the file goes and what it costs never said so.
 */
function aiReliabilityFaq(tool: Tool): ToolFaqEntry[] {
  if (capabilityForMode(tool.processing) !== "ai") return [];
  return [
    {
      question: `Can ${tool.name} get things wrong?`,
      answer:
        "Yes. The result is written by an AI model from the PDF's selectable text, and a model can miss or misread details. Check anything you rely on against the document itself.",
    },
  ];
}

/**
 * Which files an Office → PDF tool takes, from its catalogue `accept` — which
 * `worker-tool-answers.test.ts` holds to the extension check the worker runs
 * (`supportsOfficeInput`) in both directions.
 */
function officeInputFaq(tool: Tool): ToolFaqEntry[] {
  if (!OFFICE_TO_PDF_SLUGS.has(tool.slug)) return [];
  const extensions = tool.accept.map((f) => `.${f.toLowerCase()}`);
  return [
    {
      question: `Which files can ${tool.name} convert?`,
      answer: `Files ending in ${listed(extensions, "or")}. The worker checks the extension before converting, and a file with any other extension is refused.`,
    },
  ];
}

/**
 * The tools that read only a PDF's EMBEDDED text — a scan gives them nothing.
 * Typed because this module must stay light (the worker engine that proves
 * membership for three of them imports JSZip), and CHECKED against the
 * derivation in `derived-tool-copy.test.ts` — the runners that call
 * `extractPdfText(`, plus the office engine run on a text-less PDF — in both
 * directions, so this list cannot drift from the tools it describes.
 *
 * Each of them is asked the scanned-PDF question. The runner and worker arms
 * above answer it in the words true of that tool; {@link scannedFallbackEntry}
 * answers it for a member that has no arm of its own, so joining this set is
 * enough to be asked.
 */
export const EMBEDDED_TEXT_ONLY: ReadonlySet<string> = new Set([
  "pdf-to-text",
  "pdf-to-markdown",
  "compare-pdf",
  "pdf-to-word",
  "pdf-to-excel",
  // pdf-to-powerpoint left on 2026-10-10: it keeps a scan's pages as
  // pictures, so a scan does not give it nothing. Its own scanned answer
  // (`workerFaq`) says what it does instead.
]);

/** The scanned-PDF answer for an embedded-text tool with no answer of its own. */
function scannedFallbackEntry(tool: Tool): ToolFaqEntry {
  return {
    question: `Does ${tool.name} work on scanned PDFs?`,
    answer: `Only once the scan has a text layer. ${tool.name} reads the text already embedded in a PDF, and a scanned page is a picture with none. Run the file through ${toolName("ocr-pdf")} first, then use it here.`,
  };
}

/**
 * What a forgotten password costs, said once for both places that say it —
 * the Protect PDF page and the password guide.
 */
export function forgottenPasswordAnswer(): string {
  return `The password cannot be recovered through pdf.xyz. ${toolName("unlock-pdf")} removes a password from a PDF you can already open — you enter the password that works and download an unprotected copy — but it cannot recover or bypass a password you do not know. Store the password somewhere dependable before you share the protected file.`;
}

/** The Office → PDF tools; `worker-tool-answers.test.ts` checks this is the engine's set. */
export const OFFICE_TO_PDF_SLUGS: ReadonlySet<string> = new Set([
  "word-to-pdf",
  "excel-to-pdf",
  "powerpoint-to-pdf",
]);

/**
 * The whole derived FAQ: the mode template, then the per-tool facts. A page
 * with authored content (`page-copy.ts`) keeps the facts and drops the
 * template, whose questions its own FAQ answers in that tool's words.
 */
export function toolFaq(tool: Tool): readonly ToolFaqEntry[] {
  return [...modeFaq(tool), ...factFaq(tool)];
}

/**
 * The capability TEMPLATE: the same questions, with the tool's name swapped
 * in, on every tool of a capability — "Is my file uploaded when I use X?".
 * True everywhere, and identical everywhere, which is why a page that has
 * authored content does not repeat it.
 */
export function modeFaq(tool: Tool): readonly ToolFaqEntry[] {
  const capability = capabilityForMode(tool.processing);
  const entries: ToolFaqEntry[] = [];

  const retention = `the download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`;

  /*
   * EXHAUSTIVE over the capability, so a new mode is a compile error here rather
   * than a silent fall into whichever arm is last. There used to be two arms —
   * in-browser, and `else` — and hybrid fell into the worker arm: Compress PDF's
   * only privacy answer, shipped as FAQPage JSON-LD, said "The file is processed
   * on an encrypted, isolated worker" of a tool whose default path never calls
   * the API. `hybrid-copy.test.ts` reads the served JSON-LD for it.
   */
  switch (capability) {
    case "in-browser": {
      entries.push({
        question: `Is my file uploaded when I use ${tool.name}?`,
        answer:
          "No. This tool runs entirely in your browser — the file stays on your device from start to finish.",
      });
      // The offline answer is a per-tool FACT, not template: see factFaq.
      break;
    }
    case "hybrid": {
      // The question a searcher asks, answered with both paths — the same
      // sentence the mode line and the capability descriptor carry.
      entries.push({
        question: `Is my file uploaded when I use ${tool.name}?`,
        answer: `Not by default. ${HYBRID_SUMMARY}`,
      });
      // The optional step's retention is a FACT from DEFAULT_RETENTION: see
      // factFaq.
      break;
    }
    case "secure-worker":
    case "ai": {
      // An AI tool's answer names where the TEXT goes. This answer ships as
      // FAQPage JSON-LD, and for the four AI tools it used to say only
      // "processed on an encrypted, isolated worker" — true of the extraction,
      // silent about the third-party provider that does the actual work
      // (privacy policy §3).
      if (getToolInputKind(tool.slug) === "url") {
        // No file: the question a URL tool's reader has is what we do with the
        // address. It used to be asked "What happens to my file", and answered
        // "The file is processed … Inputs are wiped", of a tool with no file.
        entries.push({
          question: `What happens when ${tool.name} runs?`,
          answer: `Nothing is uploaded from your device. A browser on our processing server loads the page from the internet — the site sees the request come from our server, not from you — and prints it to PDF; ${retention}`,
        });
      } else {
        const where =
          capability === "ai"
            ? "Our processing server extracts the PDF's selectable text and sends that text — not the file — to a third-party AI provider to produce the result."
            : "The file is processed on a secure worker.";
        entries.push({
          question: `What happens to my file after ${tool.name} runs?`,
          answer: `${where} Inputs are wiped when the job finishes, ${retention}`,
        });
      }
      break;
    }
    default: {
      const unhandled: never = capability;
      throw new Error(`toolFaq: no answer for capability ${String(unhandled)}`);
    }
  }

  return entries;
}

/**
 * The per-tool FACTS, each derived from the constant its engine enforces: the
 * file ceiling, the AI allowance and reading (or translating) ceiling, and
 * OCR's language count. These stay on every page, authored content or not —
 * the ceiling guards (`file-ceilings`, `ai-ceiling-surfaces`) hold them.
 */
export function factFaq(tool: Tool): readonly ToolFaqEntry[] {
  const capability = capabilityForMode(tool.processing);
  const entries: ToolFaqEntry[] = [];

  /*
   * Two answers that were in the mode template until the seo/content merge
   * and are FACTS of this tool, so they stay on a page with authored content:
   *
   *  - an in-browser tool's offline answer is composed from the fetches ITS
   *    runner reaches (`offlineAnswer`), and `offline-answer.test.ts` holds
   *    every in-browser page to serving it. Two earlier answers were each
   *    false: "a dropped connection does not interrupt work in progress"
   *    (fonts, decoders and character maps are fetched mid-run), and then
   *    the same with "One exception" (the font), which denied the pdfjs
   *    fetches.
   *  - a hybrid tool's retention is true of the optional worker step only, so
   *    it is asked of that step, from DEFAULT_RETENTION (`hybrid-copy.test.ts`
   *    reads it off the served FAQ).
   */
  if (capability === "in-browser") {
    entries.push({
      question: `Does ${tool.name} work offline?`,
      answer: `Not fully. ${offlineAnswer(tool.slug)}`,
    });
  }
  if (capability === "hybrid") {
    entries.push({
      question: `What happens to my file if I run the optional secure-worker step?`,
      answer: `Only then does the file leave your device. Inputs are wiped when the job finishes, the download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
    });
  }

  /*
   * The size question, asked of every tool that takes a file — and answered
   * from THAT tool's ceiling.
   *
   * It used to live inside the `else` above, answered from one global
   * `JOB_LIMITS.maxFileBytes`, which made it wrong in two directions at once.
   * It was never asked of an in-browser tool at all, and measured on the
   * rendered markup on 2026-08-22, twenty-five of the fifty tool pages stated
   * no ceiling anywhere a reader meets before picking a file; meanwhile the
   * number it did state was the worker's, so the moment a tool with a smaller
   * engine cap reached this branch the page would have advertised 100 MB
   * against a gate that refuses at 2 MB. Deriving it per tool
   * closes both: `toolFileCeilingMb` reads the constant the tool's own runner
   * (or the worker upload gate, or the lower engine cap behind it) compares
   * against, and returns `null` only for a
   * tool with no file input at all, whose page must not state a per-file cap.
   */
  const ceilingMb = toolFileCeilingMb(tool);
  if (ceilingMb !== null) {
    entries.push({
      question: `How large can my file be?`,
      answer: `Up to ${ceilingMb} MB per file.`,
    });
  }

  if (capability === "ai") {
    entries.push({
      question: `Is ${tool.name} free?`,
      // Per tool: the character figure is translate's alone. Summarize, Chat
      // and Extract declare no characters and are charged per run, and this
      // answer said "30,774 free characters" on all four pages.
      answer: `Yes. ${aiAllowanceFactFor(tool.slug)}`,
    });
    // The second limit these tools have, stated in the same place as the first.
    // "How large can my file be?" answered in megabytes only, and a 300-page
    // report is well under the size cap while being well over this one — so a
    // reader met the limit that would not stop them and never met the one that
    // would. The page range is derived from measured densities rather than
    // typed, because a page count is the form of this limit a reader can act
    // on and also the form that is easy to get wrong.
    //
    // PER TOOL, because exactly one of the four is not bound by the shared
    // reading cap. Until 2026-08-21 this entry quoted
    // `AI_INPUT_LIMITS.maxInputCharacters` unconditionally, so translate's FAQ
    // said 500,000 characters — 49x what its engine accepts — and shipped that
    // figure to crawlers as FAQPage JSON-LD. The panel had been fixed on
    // 2026-08-11; its guard (`translate-ceiling.test.ts`) named where the bug
    // was FOUND, not where it can APPEAR, and never reached this file. The
    // branch below cannot rot silently: `ai-ceiling-surfaces.test.ts`
    // classifies every AI engine's enforcement and fails any page whose stated
    // ceiling is not the one its engine honours, so a fifth AI tool landing in
    // the wrong arm here turns that guard red by name.
    if (tool.slug === "translate-pdf") {
      // Output-bound: the engine REFUSES over-ceiling documents
      // (`too_much_text`, before the provider is called) rather than reading
      // a prefix — so this answer must not promise the truncation behaviour
      // the read-bound tools have. Stated as `TRANSLATE_MAX_INPUT_CHARS` raw,
      // not min(it, shared cap): if the output budget ever lifts translate's
      // ceiling past the reading cap, the refusal story below becomes false
      // and the ceiling guard goes red loudly — a min() would keep the number
      // true while this sentence rotted silently.
      entries.push({
        question: `How much of my PDF can ${tool.name} translate in one run?`,
        answer: `${TRANSLATE_MAX_INPUT_CHARS.toLocaleString("en-US")} characters of selectable text per pass — about ${translatePagesAtSparsest} sparsely-set ${pluralPages(translatePagesAtSparsest)}, or ${translatePagesAtDensest} ${pluralPages(translatePagesAtDensest)} of dense text. Translation writes roughly as much as it reads, so that ceiling is the model's output budget — far below the reading cap the other AI tools state. A longer document is not refused for length: it is split at page boundaries, translated a few pages at a time, then reassembled in order. A SINGLE page holding more than that many characters cannot be translated at all — it is skipped, and the result says so in place, at the point where that page was. The whole document is charged against the free daily allowance when the job is created, so a document needing more than is left today is refused before it runs, with nothing charged, rather than half translated; one over ${AI_CHARACTER_ALLOWANCE_DELIVERED.toLocaleString("en-US")} characters, the whole day's allowance, has to be split into smaller files. If the worker finds more text or more pages than the job reserved, translation stops there and a notice in place names the untranslated pages and why, so nothing stops silently.`,
      });
    } else if (tool.slug === CHAT_TOOL_SLUG) {
      // PER QUESTION: every question is its own job, and since L08 (9ebe3e6)
      // the engine reads at most what one question is charged —
      // CHAT_MAX_CHARACTERS_PER_QUESTION, with the question and the carried
      // conversation paid out of it first. Until 2026-09-27 this answer fell
      // to the branch below and told readers (and FAQPage JSON-LD) the shared
      // 500,000 — twelve times what a question reads. Stated through
      // `aiReadLimitFor`, the figure derived from the route's pricing, as the
      // panel's Limit row and the page's own content state it.
      const read = aiReadLimitFor(tool.slug);
      const dense = aiReadPagesAtDensest(tool.slug);
      const sparse = aiReadPagesAtSparsest(tool.slug);
      entries.push({
        question: `How much of my PDF does ${tool.name} read?`,
        answer: `Up to ${read.toLocaleString("en-US")} characters for each question, the question and the conversation sent with it included — roughly ${dense} ${pluralPages(dense)} of dense text, or about ${sparse} of sparsely-set pages. The document gets what the conversation leaves; a longer one is read up to that point only, and the answer tells you which page it reached rather than treating the rest as absent.`,
      });
    } else {
      // One run's read, derived from the route's pricing and the processor's
      // bound (`@/lib/jobs/ai-read-limit`), not the engine window on its own.
      // A tool that is not priced per call has no such figure, and lands here
      // only by mistake: `aiReadLimitFor` throws for it, loudly, at build.
      const read = aiReadLimitFor(tool.slug);
      const dense = aiReadPagesAtDensest(tool.slug);
      const sparse = aiReadPagesAtSparsest(tool.slug);
      entries.push({
        question: `How much of my PDF does ${tool.name} read?`,
        answer: `Up to ${read.toLocaleString("en-US")} characters of selectable text — roughly ${dense} ${pluralPages(dense)} of dense text, or about ${sparse} of sparsely-set pages. Longer documents are read up to that point only, and the tool tells you which page it reached rather than treating the rest as absent.`,
      });
    }
  }

  entries.push(...runnerFaq(tool));
  entries.push(...workerFaq(tool));
  entries.push(...officeInputFaq(tool));
  entries.push(...aiReliabilityFaq(tool));

  // Every embedded-text tool is asked about scans exactly once: in its own
  // words above when it has them, in the shared words otherwise.
  if (
    EMBEDDED_TEXT_ONLY.has(tool.slug) &&
    !entries.some((entry) => /\bscanned\b/i.test(entry.question))
  ) {
    entries.push(scannedFallbackEntry(tool));
  }

  if (tool.slug === "ocr-pdf") {
    entries.push({
      question: "Which languages can OCR recognize?",
      answer: `${OCR_LANGUAGES.length} languages are advertised, with up to ${MAX_OCR_LANGUAGES} selectable per job. The worker reports the packs it actually has installed, and the page's live status reflects that report.`,
    });
  }

  return entries;
}

/* ------------------------------------------------------------------ *
 *  HowTo steps, mode-true.
 * ------------------------------------------------------------------ */

/**
 * Steps that interpolate a runner constant, so they cannot live in the plain
 * catalogue (which may not import the engines). Consulted only when the tool
 * has no authored `how`.
 */
const DERIVED_STEPS: Record<string, readonly string[]> = {
  "grayscale-pdf": [
    "Pick your PDF — it stays on your device.",
    `Choose the output quality: ${grayscalePresetNames}.`,
    "Select Convert to grayscale — every page is rendered as a grayscale image in your browser.",
    "Download the grayscale PDF.",
  ],
  "page-numbers": [
    "Pick your PDF — it stays on your device.",
    "Choose a number format preset, or write your own with {n} and {total}.",
    `Pick one of ${STAMP_POSITIONS.length} positions. Set Start on page to skip a cover, and First number to choose where counting starts.`,
    "Select Add page numbers, then download the numbered PDF.",
  ],
  "watermark-pdf": [
    "Pick your PDF — it stays on your device.",
    "Type the watermark text, or switch to Image and add a PNG or JPEG, such as a logo.",
    `Set the opacity, angle and size, then a place: one of ${STAMP_POSITIONS.length} positions, or tiled across the page. Pages and layer limits it to the pages you list or draws it behind the content.`,
    "Select Add watermark, then download the watermarked PDF.",
  ],
  "overlay-pdf": [
    "Pick the base PDF you want to stamp — it stays on your device.",
    "Add the overlay PDF: a letterhead, stamp or template.",
    `Choose the scale — ${overlayFitLabels} — and the opacity. For a multi-page overlay, use its first page on every page or cycle through its pages.`,
    "Download the overlaid PDF.",
  ],
  "protect-pdf": [
    "Upload your PDF over an encrypted connection.",
    "Type the password that will be needed to open it.",
    `Choose the encryption strength: ${encryptionLabels}. ${describePdfKeyLength(DEFAULT_PDF_KEY_LENGTH)} is the default.`,
    "Optionally, under Permissions, untick what readers may not do and set an owner password that differs from the open password.",
    "The secure worker encrypts the file and deletes the input when the job finishes.",
    `Download the protected PDF — the link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes.`,
  ],
  "ai-extract": [
    `Upload a PDF with selectable text over an encrypted connection — run ${toolName("ocr-pdf")} first for a scan.`,
    `Name each field you want with a type (${listed(EXTRACTION_FIELD_TYPES, "or")}), or describe what to extract in a prompt.`,
    "Download a ZIP with the extracted JSON, a readable Markdown version and a manifest.",
  ],
};

/**
 * Default steps per capability. The client default deliberately states that
 * the file never leaves the device — a HowTo for an in-browser tool that
 * said "upload" would ship a false claim as structured data.
 *
 * NO OPTIONS STEP. Both templates said "Choose your options." until
 * 2026-09-27, and a template is written blind: it reached Google as HowToStep 2
 * for html-to-pdf, pdf-to-text and every other tool with nothing to choose.
 * A tool with settings worth a step authors its own `how`
 * (`structured-steps.test.ts` pins that the defaults claim none).
 */
function defaultSteps(tool: Tool): readonly string[] {
  const capability = capabilityForMode(tool.processing);
  // "PPTX or PPT", not "PPTX, PPT": a step names the file a reader has.
  const formats = listed(tool.accept, "or");
  if (capability === "in-browser") {
    // Deliberately upload-free wording, including the denial: the structured-
    // steps guard bans the claiming form and cannot tell "never uploaded"
    // from "upload your file" — so the steps take the words-free move (the
    // TASK-09 resolution) and the never-leaves fact lives in the page's mode
    // line, where the account guard's idiom already protects it.
    // No "Choose your options." step, in any arm: it shipped as HowTo JSON-LD
    // on 39 pages, most of them runners with no options at all (Text to PDF,
    // PNG to PDF, Delete Pages). A tool with options says which in its own
    // authored `how`; a default cannot know, so it does not claim.
    return [
      `Open the tool and pick your ${formats} file — it stays on your device.`,
      "Run the tool in your browser.",
      "Save the result to your device.",
    ];
  }
  if (capability === "hybrid") {
    // Never the upload flow below: a hybrid tool's default path stays on the
    // device, and its worker step is one the user starts.
    return [
      `Open the tool and pick your ${formats} file — the main work runs in your browser.`,
      "Save the result to your device.",
      `Optionally, start the clearly labeled secure-worker step — only then is the file uploaded, and its download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes.`,
    ];
  }
  if (getToolInputKind(tool.slug) === "url") {
    // A URL tool uploads nothing. This branch used to fall through to the
    // upload flow and tell webpage-to-pdf users to "Upload your URL file over
    // an encrypted connection" — beside a pipeline that said the same.
    return [
      "Paste the address of a public web page.",
      "A browser on our processing server loads the page and prints it to PDF.",
      `Download the result — the link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes.`,
    ];
  }
  return [
    `Upload your ${formats} file over an encrypted connection.`,
    "The secure worker processes the file and deletes the input when the job finishes.",
    `Download the result — the link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes.`,
  ];
}

export function howToSteps(tool: Tool): readonly string[] {
  if (tool.how && tool.how.length > 0) return tool.how;
  return DERIVED_STEPS[tool.slug] ?? defaultSteps(tool);
}

/** Referenced by facts/FAQ builders below; exported for the page template. */
// Re-exported so existing importers keep working; the sentence itself lives
// in `@/lib/jobs/ai-allowance`, where the panels and the 429 can also reach
// it. It was defined here and used by ONE of its six call sites.
export { AI_ALLOWANCE_FACT };

export const OCR_ADVERTISED_LANGUAGES = OCR_LANGUAGES;
export const OCR_MAX_PICK = MAX_OCR_LANGUAGES;
