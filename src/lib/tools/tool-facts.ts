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
import { JOB_LIMITS, DEFAULT_RETENTION, RATE_LIMITS } from "@/lib/jobs/types";
import { capabilityForMode } from "@/lib/jobs/capabilities";
import { OCR_LANGUAGES, MAX_OCR_LANGUAGES } from "@/lib/jobs/ocr";
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

const MAX_FILE_MB = JOB_LIMITS.maxFileBytes / (1024 * 1024);

/* ------------------------------------------------------------------ *
 *  Facts — each line's source is the runner constant or UI it names.
 * ------------------------------------------------------------------ */

export interface ToolFact {
  readonly label: string;
  readonly value: string;
}

const FACTS: Record<string, readonly ToolFact[]> = {
  "rotate-pdf": [
    { label: "Angles", value: "Rotate in 90° steps, left or right — 90°, 180° or 270° in either direction." },
    { label: "Scope", value: "Rotate every page, or only the pages you select." },
  ],
  "merge-pdf": [
    { label: "Ordering", value: "Drag files to reorder before merging, or use each row's move buttons — the output follows top to bottom." },
  ],
  "split-pdf": [
    { label: "Split modes", value: "Three ways to split: custom page ranges, every N pages, or one file per page." },
  ],
  "organize-pages": [
    { label: "Operations", value: "Reorder, rotate, duplicate, or delete pages in one pass — drag pages or use keyboard moves." },
  ],
  "watermark-pdf": [
    { label: "Colors", value: "Gray, red, or blue watermark text, placed diagonally across each page." },
  ],
  "page-numbers": [
    { label: "Formats", value: "Three numbering formats: “Page 1 of N”, “1 / N”, or “– 1 –”." },
  ],
  "sign-pdf": [
    { label: "Signature modes", value: "Five ways to make a signature: draw it, type it, pick an image, use a script font, or print-and-scan style." },
  ],
  "crop-pdf": [
    { label: "Crop modes", value: "Uniform margins or per-side control, applied to all pages or only the ones you select." },
  ],
  "edit-pdf": [
    { label: "Elements", value: "Eight element types, including text, boxes, lines, images, and filled shapes." },
  ],
  "create-forms": [
    { label: "Field types", value: "Five field types: text, checkbox, dropdown, radio, and list." },
  ],
  "annotate-pdf": [
    { label: "Annotation kinds", value: "Six annotation kinds, including highlights, boxes, notes, and lines." },
  ],
  "jpg-to-pdf": [
    { label: "Per-image limit", value: `Up to ${MAX_IMAGE_MB} MB per image, assembled into one PDF on your device.` },
  ],
  "png-to-pdf": [
    { label: "Per-image limit", value: `Up to ${MAX_IMAGE_MB} MB per image, assembled into one PDF on your device.` },
  ],
  "text-to-pdf": [
    { label: "Source limit", value: `Plain-text sources up to ${MAX_SOURCE_MB} MB, typeset in your browser.` },
  ],
  "markdown-to-pdf": [
    { label: "Source limit", value: `Markdown sources up to ${MAX_SOURCE_MB} MB, rendered and typeset in your browser.` },
  ],
  "compress-pdf": [
    { label: "Two paths", value: "Lossless structural repack always runs in your browser; deep image compression is an optional, clearly-labeled secure-worker step that needs a native engine." },
  ],
  "ocr-pdf": [
    { label: "Languages", value: `${OCR_LANGUAGES.length} recognition languages advertised, up to ${MAX_OCR_LANGUAGES} per job — the worker's own live report governs which packs are actually installed.` },
  ],
  "summarize-pdf": [{ label: "Free allowance", value: `${RATE_LIMITS.aiRunsPerDayPerClient} free AI runs a day per device — the allowance resets daily.` }],
  "translate-pdf": [{ label: "Free allowance", value: `${RATE_LIMITS.aiRunsPerDayPerClient} free AI runs a day per device — the allowance resets daily.` }],
  "ai-extract": [{ label: "Free allowance", value: `${RATE_LIMITS.aiRunsPerDayPerClient} free AI runs a day per device — the allowance resets daily.` }],
  "chat-with-pdf": [{ label: "Free allowance", value: `${RATE_LIMITS.aiRunsPerDayPerClient} free AI runs a day per device — the allowance resets daily.` }],
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

export function toolFaq(tool: Tool): readonly ToolFaqEntry[] {
  const capability = capabilityForMode(tool.processing);
  const entries: ToolFaqEntry[] = [];

  if (capability === "in-browser") {
    entries.push({
      question: `Is my file uploaded when I use ${tool.name}?`,
      answer:
        "No. This tool runs entirely in your browser with WebAssembly and browser APIs — the file stays on your device from start to finish.",
    });
    entries.push({
      question: `Does ${tool.name} work offline?`,
      // Wording bounded by what ships today: the engine chunk is fetched on
      // first use (file pick / first run), so "page loaded" alone does NOT
      // make the work connection-proof — the earlier claim said it did.
      answer:
        "Not fully — the page and its processing engine load over the network, with the engine fetched when you first use the tool. After that, the processing itself runs entirely on your device, and a dropped connection does not interrupt work in progress.",
    });
  } else {
    entries.push({
      question: `What happens to my file after ${tool.name} runs?`,
      answer: `The file is processed on an encrypted, isolated worker. Inputs are wiped when the job finishes, the download link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes, and stored copies are erased by a daily storage rule.`,
    });
    entries.push({
      question: `How large can my file be?`,
      answer: `Up to ${MAX_FILE_MB} MB per file.`,
    });
  }

  if (capability === "ai") {
    entries.push({
      question: `Is ${tool.name} free?`,
      answer: `Yes — ${AI_ALLOWANCE_FACT}`,
    });
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
 * Default steps per capability. The client default deliberately states that
 * the file never leaves the device — a HowTo for an in-browser tool that
 * said "upload" would ship a false claim as structured data.
 */
function defaultSteps(tool: Tool): readonly string[] {
  const capability = capabilityForMode(tool.processing);
  const formats = tool.accept.join(", ");
  if (capability === "in-browser") {
    // Deliberately upload-free wording, including the denial: the structured-
    // steps guard bans the claiming form and cannot tell "never uploaded"
    // from "upload your file" — so the steps take the words-free move (the
    // TASK-09 resolution) and the never-leaves fact lives in the page's mode
    // line, where the account guard's idiom already protects it.
    return [
      `Open the tool and pick your ${formats} file — it stays on your device.`,
      "Choose your options.",
      "Run the tool in your browser.",
      "Save the result to your device.",
    ];
  }
  return [
    `Upload your ${formats} file over an encrypted connection.`,
    "Choose your options.",
    "The secure worker processes the file and deletes the input when the job finishes.",
    `Download the result — the link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes.`,
  ];
}

export function howToSteps(tool: Tool): readonly string[] {
  return tool.how && tool.how.length > 0 ? tool.how : defaultSteps(tool);
}

/** Referenced by facts/FAQ builders below; exported for the page template. */
export const AI_ALLOWANCE_FACT = `${RATE_LIMITS.aiRunsPerDayPerClient} free AI runs a day per device — the allowance resets daily.`;

export const OCR_ADVERTISED_LANGUAGES = OCR_LANGUAGES;
export const OCR_MAX_PICK = MAX_OCR_LANGUAGES;
export { MAX_FILE_MB };
