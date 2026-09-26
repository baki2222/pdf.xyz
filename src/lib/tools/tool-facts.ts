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
import {
  AI_INPUT_LIMITS,
  DEFAULT_RETENTION,
  aiPagesAtDensest,
  aiPagesAtSparsest,
} from "@/lib/jobs/types";
import { TRANSLATE_MAX_INPUT_CHARS } from "@/lib/jobs/translate-limits";
import { AI_ALLOWANCE_FACT } from "@/lib/jobs/ai-allowance";
import { CROP_KEEPS_CONTENT } from "@/lib/pdf/crop-disclosure";
import { capabilityForMode } from "@/lib/jobs/capabilities";
import { OCR_LANGUAGES, MAX_OCR_LANGUAGES } from "@/lib/jobs/ocr";
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
 * densities the shared floors use. `aiPagesAtDensest`/`aiPagesAtSparsest`
 * divide the READING cap; translate is bounded by the model's OUTPUT budget
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

/* ------------------------------------------------------------------ *
 *  Facts — each line's source is the runner constant or UI it names.
 * ------------------------------------------------------------------ */

export interface ToolFact {
  readonly label: string;
  readonly value: string;
}

const FACTS: Record<string, readonly ToolFact[]> = {
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
        "Drag files to reorder before merging, or use each row's move buttons — the output follows top to bottom.",
    },
  ],
  "split-pdf": [
    {
      label: "Split modes",
      value:
        "Three ways to split: custom page ranges, every N pages, or one file per page.",
    },
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
        "Gray, red, or blue watermark text, placed diagonally across each page.",
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
  ],
  "sign-pdf": [
    {
      label: "Signature modes",
      value:
        "Five ways to make a signature: draw it, type it, pick an image, use a script font, or print-and-scan style.",
    },
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
  "edit-pdf": [
    {
      label: "Elements",
      value:
        "Eight element types, including text, boxes, lines, images, and filled shapes.",
    },
  ],
  "create-forms": [
    {
      label: "Field types",
      value: "Five field types: text, checkbox, dropdown, radio, and list.",
    },
  ],
  "annotate-pdf": [
    {
      label: "Annotation kinds",
      value:
        "Six annotation kinds, including highlights, boxes, notes, and lines.",
    },
  ],
  "jpg-to-pdf": [
    {
      label: "Per-image limit",
      value: `Up to ${MAX_IMAGE_MB} MB per image, assembled into one PDF on your device.`,
    },
  ],
  "png-to-pdf": [
    {
      label: "Per-image limit",
      value: `Up to ${MAX_IMAGE_MB} MB per image, assembled into one PDF on your device.`,
    },
  ],
  "text-to-pdf": [
    {
      label: "Source limit",
      value: `Plain-text sources up to ${MAX_SOURCE_MB} MB, typeset in your browser.`,
    },
  ],
  "markdown-to-pdf": [
    {
      label: "Source limit",
      value: `Markdown sources up to ${MAX_SOURCE_MB} MB, rendered and typeset in your browser.`,
    },
  ],
  "compress-pdf": [
    {
      label: "Two paths",
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
      value: AI_ALLOWANCE_FACT,
    },
  ],
  "translate-pdf": [
    {
      label: "Free allowance",
      value: AI_ALLOWANCE_FACT,
    },
  ],
  "ai-extract": [
    {
      label: "Free allowance",
      value: AI_ALLOWANCE_FACT,
    },
  ],
  "chat-with-pdf": [
    {
      label: "Free allowance",
      value: AI_ALLOWANCE_FACT,
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

export function toolFaq(tool: Tool): readonly ToolFaqEntry[] {
  const capability = capabilityForMode(tool.processing);
  const entries: ToolFaqEntry[] = [];

  if (capability === "in-browser") {
    entries.push({
      question: `Is my file uploaded when I use ${tool.name}?`,
      answer:
        "No. This tool runs entirely in your browser — the file stays on your device from start to finish.",
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
   * (or the worker upload gate) compares against, and returns `null` only for a
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
      answer: `Yes — ${AI_ALLOWANCE_FACT}`,
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
        answer: `${TRANSLATE_MAX_INPUT_CHARS.toLocaleString("en-US")} characters of selectable text per pass — about ${translatePagesAtSparsest} sparsely-set ${pluralPages(translatePagesAtSparsest)}, or ${translatePagesAtDensest} ${pluralPages(translatePagesAtDensest)} of dense text. Translation writes roughly as much as it reads, so that ceiling is the model's output budget — far below the reading cap the other AI tools state. A LONGER DOCUMENT IS NOT REFUSED: it is split at page boundaries and translated a few pages at a time, then reassembled in order. Two things bound how far it gets. A SINGLE page holding more than that many characters cannot be translated at all — it is skipped, and the result says so in place, at the point where that page was. And a document longer than the free daily allowance leaves for it is translated as far as the allowance reaches, with the rest marked in place and the reason named, so nothing stops silently.`,
      });
    } else {
      entries.push({
        question: `How much of my PDF does ${tool.name} read?`,
        answer: `Up to ${AI_INPUT_LIMITS.maxInputCharacters.toLocaleString("en-US")} characters of selectable text — roughly ${aiPagesAtDensest} pages of dense text, or about ${aiPagesAtSparsest} of sparsely-set pages. Longer documents are read up to that point only, and the tool tells you which page it reached rather than treating the rest as absent.`,
      });
    }
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
// Re-exported so existing importers keep working; the sentence itself lives
// in `@/lib/jobs/ai-allowance`, where the panels and the 429 can also reach
// it. It was defined here and used by ONE of its six call sites.
export { AI_ALLOWANCE_FACT };

export const OCR_ADVERTISED_LANGUAGES = OCR_LANGUAGES;
export const OCR_MAX_PICK = MAX_OCR_LANGUAGES;
