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
import { capabilityForMode } from "@/lib/jobs/capabilities";
import { OCR_LANGUAGES, MAX_OCR_LANGUAGES } from "@/lib/jobs/ocr";
import { GRAYSCALE_DPI_PRESETS } from "@/lib/pdf/grayscale";
import { STAMP_POSITIONS } from "@/lib/pdf/stamp";
import { OVERLAY_FITS } from "@/lib/pdf/overlay";
import {
  DEFAULT_PDF_KEY_LENGTH,
  PDF_ENCRYPTION_LEVELS,
  describePdfKeyLength,
} from "@/lib/jobs/pdf-security";
import { EXTRACTION_FIELD_TYPES } from "@/lib/jobs/ai-extract";
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

/**
 * Grayscale's quality presets as the runner labels them — "Screen (96 DPI)" —
 * built from the constant the runner's SegmentedControl renders from, so a
 * changed preset changes the page's steps and facts with it
 * (`derived-tool-copy.test.ts`).
 */
const grayscalePresetNames = GRAYSCALE_DPI_PRESETS.map(
  (preset) => `${preset.label} (${preset.dpi} DPI)`,
).join(" or ");

/** "a, b or c" — the list shape every derived option sentence below uses. */
const orList = (items: readonly string[]): string =>
  items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;

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
const encryptionLabels = orList(PDF_ENCRYPTION_LEVELS.map((l) => l.label));

/** Overlay scale modes as the overlay runner's control labels them. */
const overlayFitLabels = orList(OVERLAY_FITS.map((fit) => fit.label));

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
    {
      label: "Placement",
      // STAMP_POSITIONS is the list the runner's PositionPicker renders; the
      // upright claim is placeStamp's rotation cancel, checked on a decoded
      // output page by tool-page-content.test.ts.
      value: `Any of ${STAMP_POSITIONS.length} positions — each corner, the middle of each edge, or the center. On a rotated page the number still lands there and reads upright.`,
    },
    {
      label: "Numbering",
      // The runner's two NumberField labels, verbatim.
      value:
        "Start on page skips earlier pages, such as a cover; First number sets the number counting starts from.",
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
  "grayscale-pdf": [
    {
      label: "Quality",
      value: `Two presets: ${grayscalePresetNames} — the resolution each page is rendered at.`,
    },
    {
      label: "Raster output",
      // grayscale.ts renders every page to a grayscale JPEG and builds a NEW
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
      value:
        "The file name becomes the # title, and a PDF with more than one page gets a ## Page N heading before each page's text.",
    },
    {
      label: "Paragraphs and lists",
      value:
        "Lines that wrap are joined into paragraphs; a line that starts with a list marker (-, *, + or a number) stays a list item.",
    },
    {
      label: "Not rebuilt",
      value:
        "Tables, images and text styling are not recreated — table rows come through as plain text. For tables, use Extract Tables.",
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
      // rows() in workers/pdf-office-export/engine.ts filters out empty
      // cells, so a blank cell shifts the rest of its row left — measured on a
      // decoded XLSX by claims-vs-capability.test.ts.
      value:
        "Every line of text becomes a row. Blank cells are dropped, so a value can shift left into the wrong column — there is no table detection.",
    },
    {
      label: "Tables",
      value:
        "For tables detected by their layout, exported as CSV and Excel files, use Extract Tables.",
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

/**
 * The tools that read only a PDF's EMBEDDED text — a scan gives them nothing.
 * Typed because this module must stay light (the worker engine that proves
 * membership for three of them imports JSZip), and CHECKED against the
 * derivation in `derived-tool-copy.test.ts` — the runners that call
 * `extractPdfText(`, plus the office engine run on a text-less PDF — in both
 * directions, so this list cannot drift from the tools it describes.
 */
export const EMBEDDED_TEXT_ONLY: ReadonlySet<string> = new Set([
  "pdf-to-text",
  "pdf-to-markdown",
  "compare-pdf",
  "pdf-to-word",
  "pdf-to-excel",
  "pdf-to-powerpoint",
]);

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

  if (EMBEDDED_TEXT_ONLY.has(tool.slug)) {
    entries.push({
      question: `Does ${tool.name} work on scanned PDFs?`,
      answer: `Only once the scan has a text layer. ${tool.name} reads the text already embedded in a PDF, and a scanned page is a picture with none. Run the file through OCR PDF first, then use it here.`,
    });
  }

  if (tool.slug === "pdf-to-markdown") {
    entries.push({
      question: `Does ${tool.name} keep tables and images?`,
      answer:
        "No. Images are not exported, and table rows come through as plain text rather than as Markdown tables. For tables, Extract Tables detects them by their layout and exports CSV and Excel files.",
    });
  }

  if (tool.slug === "ocr-pdf") {
    entries.push({
      question: "Which languages can OCR recognize?",
      answer: `${OCR_LANGUAGES.length} languages are advertised, with up to ${MAX_OCR_LANGUAGES} selectable per job. The worker reports the packs it actually has installed, and the page's live status reflects that report.`,
    });
  }

  entries.push(...(TOOL_QUESTIONS[tool.slug]?.() ?? []));

  return entries;
}

/**
 * What a forgotten password costs, said once for both places that say it —
 * the Protect PDF page and the password guide.
 */
export function forgottenPasswordAnswer(): string {
  return `The password cannot be recovered through pdf.xyz. ${toolName("unlock-pdf")} removes a password from a PDF you can already open — you enter the password that works and download an unprotected copy — but it cannot recover or bypass a password you do not know. Store the password somewhere dependable before you share the protected file.`;
}

/**
 * Per-tool questions, each answered by the code — never by the page's hopes.
 * Every answer here has a probe in `tool-page-content.test.ts` that runs the
 * engine (or reads the argument list the worker hands qpdf) and fails when the
 * sentence stops being true. Built lazily so a renamed tool is read at call
 * time, and every tool an answer sends the reader to must be one of the
 * page's visible related links (same test).
 */
const TOOL_QUESTIONS: Record<string, () => readonly ToolFaqEntry[]> = {
  "edit-pdf": () => [
    {
      question: `Can ${toolName("edit-pdf")} change the text already in my PDF?`,
      answer: `No. It adds new text, images, boxes and lines on top of the page; the text and objects already there are kept exactly as they were. To rework the existing text, convert the file with ${toolName("pdf-to-word")}. To remove content for good rather than cover it, use ${toolName("redact-pdf")}.`,
    },
  ],
  "page-numbers": () => [
    {
      question: "Can I leave the cover page unnumbered?",
      answer:
        "Yes. Set Start on page to 2 and the cover gets no number; leave First number at 1, and the page after the cover is numbered 1.",
    },
  ],
  "flatten-pdf": () => [
    {
      question: `What does ${toolName("flatten-pdf")} flatten?`,
      answer:
        "Every fillable form field — text boxes, checkboxes, radio buttons, dropdowns and list boxes — is drawn into the page with its current value and removed as a field. Comments and layers are re-saved unchanged.",
    },
    {
      question: "What if my PDF has no form fields?",
      answer:
        "Nothing is flattened: the file is re-saved as it is, and the result says no fillable form fields were found.",
    },
    {
      question: "Can every filled form be flattened?",
      answer:
        "Not yet. A text field holding characters outside the basic PDF alphabet — Bengali, Chinese or Greek, for example — is refused with a message saying so, rather than flattened with those characters missing.",
    },
    {
      question: "Can I undo flattening?",
      answer:
        "Not in the flattened copy — its fields are gone. The file you picked is not changed, so keep it if you may need to edit the answers again.",
    },
  ],
  "compare-pdf": () => [
    {
      question: `What counts as a change in ${toolName("compare-pdf")}?`,
      answer:
        "A line of selectable text that is in one PDF and not the other. Lines only in the first PDF are listed as removed (-), and lines only in the second as added (+). Extra spaces inside a line and blank lines are ignored, and formatting, images and layout are not compared.",
    },
  ],
  "optimize-web": () => [
    {
      question: `What does ${toolName("optimize-web")} change?`,
      answer:
        "It linearizes the file: the parts needed to show the first page are moved to the front, with an index, so a viewer that loads a PDF in pieces can show page one while the rest downloads. It does not change what is on the pages.",
    },
    {
      question: "Will it make my PDF smaller?",
      answer: `Not reliably — linearizing is not compression, and reducing size is not what it is for. The whole file is rewritten, so its size can change in either direction. To make it smaller, use ${toolName("compress-pdf")}.`,
    },
  ],
  "protect-pdf": () => [
    {
      question: `Which encryption does ${toolName("protect-pdf")} use?`,
      answer: `AES only — the older RC4 cipher is never used. ${PDF_ENCRYPTION_LEVELS.map((level) => level.description).join(" ")} ${describePdfKeyLength(DEFAULT_PDF_KEY_LENGTH)} is the default.`,
    },
    {
      question: "What if I forget the password?",
      answer: forgottenPasswordAnswer(),
    },
  ],
  "unlock-pdf": () => [
    {
      question: `Can ${toolName("unlock-pdf")} remove a password I don't know?`,
      answer:
        "No. It needs the password that currently opens the file — an empty one is refused — and uses it to decrypt. Nothing is guessed, recovered or bypassed.",
    },
  ],
};

/** The slugs with their own questions — exported so tests can walk them. */
export const TOOL_QUESTION_SLUGS = Object.keys(TOOL_QUESTIONS);

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
    "The secure worker encrypts the file and deletes the input when the job finishes.",
    `Download the protected PDF — the link stops working after ${DEFAULT_RETENTION.outputTtlMinutes} minutes.`,
  ],
  "ai-extract": [
    `Upload a PDF with selectable text over an encrypted connection — run ${toolName("ocr-pdf")} first for a scan.`,
    `Name each field you want with a type (${orList(EXTRACTION_FIELD_TYPES)}), or describe what to extract in a prompt.`,
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
  const formats = tool.accept.join(", ");
  if (capability === "in-browser") {
    // Deliberately upload-free wording, including the denial: the structured-
    // steps guard bans the claiming form and cannot tell "never uploaded"
    // from "upload your file" — so the steps take the words-free move (the
    // TASK-09 resolution) and the never-leaves fact lives in the page's mode
    // line, where the account guard's idiom already protects it.
    return [
      `Open the tool and pick your ${formats} file — it stays on your device.`,
      "Run the tool in your browser.",
      "Save the result to your device.",
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
