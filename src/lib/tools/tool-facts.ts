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
import { AI_ALLOWANCE_FACT, aiAllowanceFactFor } from "@/lib/jobs/ai-allowance";
import { capabilityForMode, getToolInputKind } from "@/lib/jobs/capabilities";
import { HYBRID_SUMMARY } from "./processing";
import { OCR_LANGUAGES, MAX_OCR_LANGUAGES } from "@/lib/jobs/ocr";
import {
  ANNOTATION_FACT,
  ANNOTATION_TYPES,
  EDIT_OP_FACT,
  EDIT_OP_TYPES,
  FIELD_TYPE_FACT,
  NEW_FIELD_TYPES,
  SIGNATURE_SOURCE_FACT,
  SIGNATURE_SOURCES,
  SPLIT_MODE_FACT,
  SPLIT_MODES,
} from "@/lib/pdf/offered-kinds";
import {
  IMAGE_PAGE_MARGIN_PT,
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
import { getRunnerKind } from "@/lib/pdf/registry";
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
};

/**
 * The syntax Markdown to PDF typesets — every kind in MARKDOWN_BLOCK_KINDS,
 * which cannot disagree with the renderer's own union (a compile check in
 * markdown-to-pdf.ts). What it does NOT style is said too, because a reader
 * pasting a README will have tables and bold in it.
 */
export const MARKDOWN_SYNTAX_FACT = (() => {
  const names = MARKDOWN_BLOCK_KINDS.map((k) => MARKDOWN_BLOCK_PHRASE[k]);
  const list = `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${list[0]!.toUpperCase()}${list.slice(1)}. Tables, bold, italics and links print as plain text — a link keeps its address in parentheses.`;
})();

/** PDF to JPG / PNG: the presets, and what one page becomes. */
function rasterFact(slug: string): ToolFact {
  const ext = rasterFormatForSlug(slug).toUpperCase();
  return {
    label: "Resolutions",
    value: `${RASTER_RESOLUTION_CHOICES} — every page becomes one ${ext} image, rendered in your browser.`,
  };
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

/** The in-browser offline answer's one exception, said once. */
export const FONT_FETCH_EXCEPTION =
  "One exception: drawing text in a script outside the Western European alphabet fetches a matching font the first time it is needed, and that step needs a connection.";

/** The list a reader types to pick every other page (parsed by `parsePageList`). */
export const EVERY_OTHER_PAGE_EXAMPLE = "2, 4, 6, 8";

/**
 * What the page tools' exports keep. Organize, Rotate and Delete all rebuild
 * the PDF with `PDFDocument.create()` + `copyPages` (`src/lib/pdf/engine.ts`),
 * which copies each page as it is and nothing from the document around it —
 * so the outline and the interactive form do not survive.
 * `tool-page-substance.test.ts` runs those engines on a PDF that has both and
 * holds this sentence to what comes out.
 */
export const PAGE_REBUILD_KEEPS =
  "The pages themselves — text, images and drawings — are copied as they are, but the export is rebuilt from the pages alone, so the document's bookmarks and its fillable form are not carried over.";

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
        {
          question: `Does ${tool.name} keep bookmarks and form fields?`,
          answer: `No. ${PAGE_REBUILD_KEEPS}`,
        },
      ];
    case "delete-pages":
      return [
        {
          question: `Does ${tool.name} keep bookmarks and form fields?`,
          answer: `No. ${PAGE_REBUILD_KEEPS}`,
        },
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
            "No. The turn is saved as each page's orientation setting in the file; the page's text, images and drawings are copied as they are, not re-rendered.",
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
    default:
      return [];
  }
}

export function toolFaq(tool: Tool): readonly ToolFaqEntry[] {
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
      entries.push({
        question: `Does ${tool.name} work offline?`,
        // Wording bounded by what ships today: the engine chunk is fetched on
        // first use (file pick / first run), so "page loaded" alone does NOT
        // make the work connection-proof — the earlier claim said it did.
        //
        // The exception is named because the engines that draw text fetch a
        // font DURING the run for any script outside WinAnsi
        // (`unicode-font.ts` → `fetch(fontPackUrl(pack))`), so "a dropped
        // connection does not interrupt work in progress" was false for a
        // Bengali text file on Text to PDF. `tool-page-substance.test.ts` keeps
        // this sentence for as long as any engine calls `embedDrawingFont`.
        answer: `Not fully — the page and its processing engine load over the network, with the engine fetched when you first use the tool. After that, the processing itself runs entirely on your device, and a dropped connection does not interrupt work in progress. ${FONT_FETCH_EXCEPTION}`,
      });
      break;
    }
    case "hybrid": {
      // The question a searcher asks, answered with both paths — the same
      // sentence the mode line and the capability descriptor carry.
      entries.push({
        question: `Is my file uploaded when I use ${tool.name}?`,
        answer: `Not by default. ${HYBRID_SUMMARY}`,
      });
      // Retention is true of the worker step only, so it is asked of that step.
      entries.push({
        question: `What happens to my file if I run the optional secure-worker step?`,
        answer: `Only then does the file leave your device. Inputs are wiped when the job finishes, ${retention}`,
      });
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
            : "The file is processed on an encrypted, isolated worker.";
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
        answer: `${TRANSLATE_MAX_INPUT_CHARS.toLocaleString("en-US")} characters of selectable text per pass — about ${translatePagesAtSparsest} sparsely-set ${pluralPages(translatePagesAtSparsest)}, or ${translatePagesAtDensest} ${pluralPages(translatePagesAtDensest)} of dense text. Translation writes roughly as much as it reads, so that ceiling is the model's output budget — far below the reading cap the other AI tools state. A LONGER DOCUMENT IS NOT REFUSED: it is split at page boundaries and translated a few pages at a time, then reassembled in order. Two things bound how far it gets. A SINGLE page holding more than that many characters cannot be translated at all — it is skipped, and the result says so in place, at the point where that page was. And a document longer than the free daily allowance leaves for it is translated as far as the allowance reaches, with the rest marked in place and the reason named, so nothing stops silently.`,
      });
    } else {
      entries.push({
        question: `How much of my PDF does ${tool.name} read?`,
        answer: `Up to ${AI_INPUT_LIMITS.maxInputCharacters.toLocaleString("en-US")} characters of selectable text — roughly ${aiPagesAtDensest} pages of dense text, or about ${aiPagesAtSparsest} of sparsely-set pages. Longer documents are read up to that point only, and the tool tells you which page it reached rather than treating the rest as absent.`,
      });
    }
  }

  entries.push(...runnerFaq(tool));

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
  return tool.how && tool.how.length > 0 ? tool.how : defaultSteps(tool);
}

/** Referenced by facts/FAQ builders below; exported for the page template. */
// Re-exported so existing importers keep working; the sentence itself lives
// in `@/lib/jobs/ai-allowance`, where the panels and the 429 can also reach
// it. It was defined here and used by ONE of its six call sites.
export { AI_ALLOWANCE_FACT };

export const OCR_ADVERTISED_LANGUAGES = OCR_LANGUAGES;
export const OCR_MAX_PICK = MAX_OCR_LANGUAGES;
