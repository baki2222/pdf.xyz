import type { ToolContent } from "./types";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import {
  AI_ALLOWANCE_FACT,
  AI_CHARACTER_ALLOWANCE_DELIVERED,
} from "@/lib/jobs/ai-allowance";
import { TRANSLATE_MAX_INPUT_CHARS } from "@/lib/jobs/translate-limits";
import {
  LANGUAGE_NAMES,
  MAX_TRANSLATE_INSTRUCTIONS_CHARS,
  TRANSLATE_LANGUAGES,
  translationOutputName,
  type TranslateLanguage,
} from "@/lib/jobs/translate-pdf";
import { OCR_OUTPUT_MODES } from "@/lib/jobs/ocr";
import { tools } from "@/lib/tools/catalog";
import { toolFileCeilingMb } from "@/lib/tools/file-ceilings";
import {
  UNSUPPORTED_SCRIPTS,
  unsupportedScriptFor,
} from "@/lib/pdf/font-packs";
import {
  missingPageMarker,
  withheldPagesMarker,
} from "@/lib/workers/translate/chunking";

/*
 * Behaviour claims below were read from the implementation on 2026-09-27:
 *  - src/components/tools/translate-worker-panel.tsx — the "Add your PDF, or
 *    browse" drop zone (one file, with a Remove button), shown at once, with
 *    Translate PDF off until canRunTranslate (secure worker + AI provider)
 *    passes (WP-10); the "Translate
 *    into" and "Source language" selects ("Auto-detect" first), "Instructions
 *    (optional)", the "Translate PDF" button (its busy label is
 *    `jobBusyLabel(job.phase, "Translating…")`: Uploading your file…,
 *    Waiting for the worker…, Translating… while counting and while the job
 *    runs, Downloading the result…; until 2026-10-07 the step said it read
 *    Translating… throughout), the
 *    in-browser text count that refuses a document before anything uploads
 *    when no page fits in one pass (a scan has no page with text, so it is
 *    refused there too), and the "Download <name>" button, which saves bytes
 *    the page has ALREADY fetched (pdf-security-client: upload → create job →
 *    poll → download);
 *  - src/lib/workers/translate/engine.ts — selectable text only (`no_text`
 *    points at OCR PDF), the system prompt (keep structure, headings, lists,
 *    names, numbers, code and URLs; add, remove or summarise nothing; the
 *    source language is named to the model when chosen; the instruction is
 *    appended to the prompt and recorded in README + manifest), the ZIP of
 *    translation.md + translation.txt + manifest.json + README.txt, and the
 *    in-place markers for skipped, withheld or interrupted pages
 *    (translate/chunking.ts). An oversize page cannot be translated on its
 *    own either: the page itself is over the per-pass ceiling;
 *  - src/lib/workers/pdf-text/native.ts — the worker reads with
 *    `pdftotext -layout` (padding collapsed), which keeps side-by-side columns
 *    on one line, so a two-column page reaches the model line-interleaved;
 *  - src/app/api/jobs/route.ts + ratelimit/guard.ts — the allowance is debited
 *    when the job is created (after the upload), and a job whose declared text
 *    does not fit what is left today is refused whole (nothing spent), never
 *    partly run; so a document over AI_CHARACTER_ALLOWANCE_DELIVERED can never
 *    run. A withheld-page marker is about THIS JOB'S reservation (declared text
 *    x headroom) or its declared text-page count, not the daily allowance;
 *  - src/lib/pdf/font-packs.ts — Markdown to PDF refuses scripts it cannot
 *    draw; the target languages it refuses, and the page-notice sign it
 *    refuses (U+FE0F in "⚠️", classed as emoji), are derived below, not typed.
 *    Verified 2026-09-27 by running markdownToPdf: Arabic and Thai refused, a
 *    notice line refused, "⚠" without U+FE0F accepted;
 *  - src/app/privacy/page.tsx §3 — only the extracted text goes to a
 *    third-party AI provider, never the PDF file, under agreements that
 *    prohibit training on data sent through the API.
 * Every number is interpolated from the constant that owns it.
 */

const toolNamed = (slug: string) => {
  const tool = tools.find((entry) => entry.slug === slug);
  if (!tool) {
    throw new Error(`translate-pdf content: no catalogue entry for ${slug}`);
  }
  return tool;
};
const translateTool = toolNamed("translate-pdf");
const OCR_TOOL = toolNamed("ocr-pdf").name;
const MARKDOWN_TOOL = toolNamed("markdown-to-pdf").name;

const ceilingMbOrNull = toolFileCeilingMb(translateTool);
if (ceilingMbOrNull === null) {
  throw new Error("translate-pdf content expects a per-file ceiling");
}
const CEILING_MB = ceilingMbOrNull;

/** OCR PDF's PDF-only output, by the label its panel shows. */
const OCR_PDF_OUTPUT = OCR_OUTPUT_MODES.find(
  (mode) => mode.id === "searchable-pdf",
);
if (
  !OCR_PDF_OUTPUT ||
  OCR_PDF_OUTPUT.outputs.length !== 1 ||
  OCR_PDF_OUTPUT.outputs[0] !== "PDF"
) {
  throw new Error(
    "translate-pdf content: OCR PDF no longer has a PDF-only output to hand to Translate PDF",
  );
}
const OCR_MODE_LABEL = OCR_PDF_OUTPUT.label;

const OUTPUT_TTL = DEFAULT_RETENTION.outputTtlMinutes;
const LANGUAGE_COUNT = TRANSLATE_LANGUAGES.length;
const PASS_CHARS = TRANSLATE_MAX_INPUT_CHARS.toLocaleString("en-US");
const DAY_CHARS = AI_CHARACTER_ALLOWANCE_DELIVERED.toLocaleString("en-US");
const INSTRUCTION_CHARS = MAX_TRANSLATE_INSTRUCTIONS_CHARS;
const EXAMPLE_ZIP = translationOutputName("lease.pdf");

/** Code points Markdown to PDF refuses, named by the refusal table it uses. */
const refusedNames = (text: string): string[] =>
  [...text].flatMap((ch) => {
    const hit = unsupportedScriptFor(ch.codePointAt(0)!);
    return hit ? [hit.name] : [];
  });
// Positive control: the scan must see a code point straight out of the table.
const firstRefused = UNSUPPORTED_SCRIPTS[0]?.ranges[0]?.[0];
if (
  firstRefused === undefined ||
  refusedNames(String.fromCodePoint(firstRefused)).length === 0
) {
  throw new Error(
    "translate-pdf: the refused-character scan is blind to the refusal table",
  );
}

/**
 * Target languages whose script Markdown to PDF refuses to draw (today Arabic,
 * right to left, and Thai, no face shipped). Derived by matching the language
 * name to the refused script's name, so shipping a face empties it and the
 * FAQ clause below disappears with it.
 */
const UNTYPESET = TRANSLATE_LANGUAGES.filter((code) =>
  UNSUPPORTED_SCRIPTS.some((script) => script.name === LANGUAGE_NAMES[code]),
);
// Positive control for the name match: while Arabic is still refused, the
// derivation must find it, or a renamed label has silently emptied the set.
if (
  UNSUPPORTED_SCRIPTS.some((script) => script.name === "Arabic") &&
  !UNTYPESET.includes("ar")
) {
  throw new Error(
    "translate-pdf: Markdown to PDF refuses Arabic but the language match missed it",
  );
}

/**
 * The page notices the worker writes into translation.md, run through the same
 * refusal table Markdown to PDF uses. Today each opens with "⚠️", whose U+FE0F
 * is classed as emoji, so a package carrying a notice is refused there. Fix the
 * marker and this clause disappears.
 */
const PAGE_NOTICES = [
  missingPageMarker({
    pageNumber: 1,
    characters: TRANSLATE_MAX_INPUT_CHARS + 1,
  }),
  withheldPagesMarker([1], "characters", { characters: 1 }),
];
if (!PAGE_NOTICES.every((notice) => notice.includes("Page 1"))) {
  throw new Error(
    "translate-pdf: the page-notice sample no longer names its page",
  );
}
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const NOTICE_SIGNS = [
  ...new Set(
    PAGE_NOTICES.flatMap((notice) =>
      [...segmenter.segment(notice)]
        .map((part) => part.segment)
        .filter((grapheme) => refusedNames(grapheme).length > 0),
    ),
  ),
];
const NOTICE_CLASSES = [
  ...new Set(NOTICE_SIGNS.flatMap((sign) => refusedNames(sign))),
];

/** Typed as TranslateLanguage, so dropping one from the list fails the build. */
const name = (code: TranslateLanguage): string => LANGUAGE_NAMES[code];
const list = (codes: readonly TranslateLanguage[]): string =>
  new Intl.ListFormat("en", { type: "conjunction" }).format(codes.map(name));
const either = (codes: readonly TranslateLanguage[]): string =>
  new Intl.ListFormat("en", { type: "disjunction" }).format(codes.map(name));

const markdownCaveats = [
  UNTYPESET.length > 0
    ? `That tool refuses scripts it cannot draw correctly, so ${either(UNTYPESET)} output has to go into your own document.`
    : "",
  NOTICE_SIGNS.length > 0
    ? `It also refuses a translation.md carrying any page notice, because the ${NOTICE_SIGNS.join(" ")} in each notice counts as ${NOTICE_CLASSES.join(", ")} there; delete that sign first.`
    : "",
].filter(Boolean);

const content: ToolContent = {
  slug: "translate-pdf",

  seoTitle: `Translate PDF Online into ${LANGUAGE_COUNT} Languages with AI`,

  metaDescription: `Translate a PDF's text into ${LANGUAGE_COUNT} languages, including ${list(["es", "bn", "ja"])}, source auto-detected or chosen. Get Markdown and plain text in a ZIP.`,

  intro: [
    `Translate PDF has an AI model rewrite your document's text between any two of ${LANGUAGE_COUNT} languages, from ${list(["es", "bn"])} to ${list(["ja", "ar"])}. The model is told to keep headings and lists, leave names, numbers, code and URLs alone unless they clearly need translating, and add, drop or summarise nothing. You get a ZIP such as ${EXAMPLE_ZIP} holding translation.md, translation.txt, a README and a manifest naming the model and languages: translated text, not a rebuilt PDF, so fonts, columns and images are not recreated.`,
    `The work happens online, on pdf.xyz's secure worker. Your PDF, one file up to ${CEILING_MB} MB, is uploaded over TLS; the worker extracts its text and sends that text, plus any instruction you typed, but not the PDF file, to a third-party AI provider used under agreements that prohibit training on data sent through the API. The uploaded PDF is deleted when the job finishes, the ZIP's download link expires after ${OUTPUT_TTL} minutes, and a daily storage rule then erases the stored copy.`,
    `One pass carries up to ${PASS_CHARS} characters; longer documents are split at page boundaries, translated in order and reassembled. Your browser counts the text before anything uploads, so a file with no page that fits a pass, or a scan with no text layer, is stopped without touching the allowance. ${AI_ALLOWANCE_FACT} The allowance is charged when the job is created, just after the upload: a document needing more than is left today is refused whole with nothing charged rather than half translated, and one over ${DAY_CHARS} characters, the whole day's allowance, has to be split into smaller files first.`,
  ],

  useCases: [
    {
      title: "Understand a contract or lease written abroad",
      body: `Read a rental agreement or supplier contract in ${name("en")} before you ask questions, and have a qualified translator check any wording you will sign.`,
    },
    {
      title: "Read a report or thesis in another language",
      body: `A single-column document in ${either(["ja", "zh", "ko"])} becomes Markdown you can skim, quote and search. The worker reads each line straight across the page, so on a two-column paper the two columns' lines reach the model interleaved.`,
    },
    {
      title: "Localise a manual without renaming the product",
      body: `Ask in Instructions (optional) to "keep product names and model numbers in ${name("en")}" while a datasheet is rendered in ${name("de")} or ${name("pt")}.`,
    },
    {
      title: "Translate a scanned letter",
      body: `A scan holds pictures of letters, not text. Run it through ${OCR_TOOL} with the ${OCR_MODE_LABEL} output first, then bring that PDF here.`,
    },
    {
      title: "Share a report with a team in their language",
      body: `Turn an ${name("en")} report into ${either(["bn", "hi", "id"])} and paste the Markdown into a wiki or email.`,
    },
  ],

  steps: [
    {
      title: "Add one PDF",
      body: `Drop a PDF on the box labelled "Add your PDF, or browse", or click it to pick one; Remove clears it. The box takes a file at once; Translate PDF works only once the page confirms a secure worker with an AI model is available, and nothing is uploaded before you press it.`,
    },
    {
      title: "Pick the languages",
      body: "Choose a target under Translate into. Leave Source language on Auto-detect to let the model work it out, or pick the source yourself and the model is told which language it is reading.",
    },
    {
      title: "Add instructions if you need them",
      body: `Instructions (optional) takes up to ${INSTRUCTION_CHARS} characters, such as "use a formal register". It is passed to the model and recorded in the package's README and manifest; leave it blank for a plain, faithful translation.`,
    },
    {
      title: "Press Translate PDF",
      body: "Your browser counts the text first, while the button reads Translating…; if it fits, the PDF uploads over TLS (Uploading your file…), waits in the queue (Waiting for the worker…), is translated (Translating…), and the ZIP is fetched (Downloading the result…) before the download button appears.",
    },
    {
      title: "Download the ZIP",
      body: `Press the button that names the package, such as Download ${EXAMPLE_ZIP}; it saves the copy the page already fetched. Pages that could not be translated are marked where they sat. The stored copy on pdf.xyz is only reachable for ${OUTPUT_TTL} minutes.`,
    },
  ],

  faqs: [
    {
      q: "Will the translated PDF keep the original layout?",
      a: `No PDF comes back: you get Markdown and plain text, without the original's fonts, columns, images or page positions. To typeset it, paste it into your own document or run translation.md through ${MARKDOWN_TOOL}.${markdownCaveats.length > 0 ? ` ${markdownCaveats.join(" ")}` : ""}`,
    },
    {
      q: "Can I translate a scanned PDF?",
      a: `Not directly. Only text the PDF already contains as text is read, and your browser stops a file with none before it uploads or draws on the free allowance. Run the scan through ${OCR_TOOL} with the right recognition language and the ${OCR_MODE_LABEL} output, then translate the PDF it returns.`,
    },
    {
      q: "Does the AI provider train on the document I translate?",
      a: "The provider receives the extracted text and any instruction you typed, not the PDF file, under agreements that prohibit training on data sent through the API. pdf.xyz cannot control what a provider does beyond those terms, so if they are not enough for a document, keep it out of every AI tool.",
    },
    {
      q: "What happens if one page holds too much text?",
      a: `A page over ${PASS_CHARS} characters cannot fit one pass, so it is skipped rather than cut off, and a notice where it sat names the page and its character count. Extracting that page on its own does not help, because the page itself is over the limit. Separately, if the worker finds more text than the job reserved from the free allowance, or more pages with text than your browser counted, translation stops at that page and one notice there names the untranslated pages and which limit ran out.`,
    },
    {
      q: "How accurate is an AI translation of a PDF?",
      a: "It is machine output and may contain errors, as the package's README says. The model is told to leave an unintelligible passage as it is rather than guess, and the manifest names the model. Check important passages against the original.",
    },
  ],

  relatedGuides: [
    "how-to-translate-a-pdf",
    "how-to-make-a-scanned-pdf-searchable",
  ],
};

export default content;
