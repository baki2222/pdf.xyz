import type { ToolContent } from "./types";
import { modeUploadsFiles } from "@/lib/tools/processing-split";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import { aiReadLimitFor } from "@/lib/jobs/ai-read-limit";
import {
  DEFAULT_SUMMARY_FORMAT,
  DEFAULT_SUMMARY_LENGTH,
  MAX_SUMMARY_FOCUS_CHARS,
  summaryOutputName,
  type SummaryFormat,
  type SummaryLength,
} from "@/lib/jobs/summarize-pdf";
import {
  AI_CHARACTER_ALLOWANCE,
  AI_CHARACTER_ALLOWANCE_DELIVERED,
  AI_ALLOWANCE_CLAUSE,
} from "@/lib/jobs/ai-allowance";
import { deliveryCapFor } from "@/lib/jobs/delivery-cap";
import {
  TRANSLATE_EXTRACTOR_HEADROOM,
  TRANSLATE_MAX_INPUT_CHARS,
} from "@/lib/jobs/translate-limits";
import { capabilityForMode } from "@/lib/jobs/capabilities";
import { getToolBySlug, tools } from "@/lib/tools";
import { WORKER_FILE_CEILING } from "@/lib/tools/file-ceilings";
import { DEFAULT_OCR_OUTPUT_MODE, OCR_OUTPUT_MODES } from "@/lib/jobs/ocr";

/*
 * Behaviour claims below were read from the implementation on 2026-09-27:
 *  - src/components/tools/summarize-worker-panel.tsx — the "Add your PDF, or"
 *    drop zone (one file), the "Summary length" / "Format" selects and their
 *    option labels, the "Focus (optional)" field capped at
 *    MAX_SUMMARY_FOCUS_CHARS, the "Summarize PDF" button (busy label
 *    "Summarizing…"), the TruncationNotice, the "Download <file>" button, and
 *    the builder being replaced by the unavailability detail plus NotifyMe
 *    when no worker or AI model is available. NotifyMe ("Notify me when this
 *    ships") only COUNTS the ask — notify-me.tsx says there is no waitlist
 *    backend and no way to notify anyone — so the copy never promises a
 *    notification;
 *  - src/lib/workers/summarize/engine.ts — selectable text only (a scan is
 *    refused as `no_text` and pointed at OCR PDF), the prompt's "same language
 *    as the document", "do not add facts" and "Pay special attention to"
 *    rules (instructions to the model, so the copy words them as
 *    instructions), the prefix read up to AI_INPUT_LIMITS.maxInputCharacters
 *    with a page-named disclosure in the panel and summary.md, and the ZIP of
 *    summary.md + summary.txt + manifest.json + README.txt;
 *  - src/app/privacy/page.tsx §2–§3 — text, not the file, goes to a
 *    third-party provider under agreements that prohibit training on API data;
 *    input deleted at the job's end, link expiry, daily storage rule;
 *  - src/app/api/jobs/route.ts — every tool whose capabilityForMode is "ai" is
 *    charged the same allowance at job creation, with no refund path; a
 *    summarize job declares no character count, so it is reserved at
 *    deliveryCapFor's fallback, computed below with the same two arguments the
 *    route passes. The route also peeks a service-wide AI spend ceiling first.
 *    Only processor/translate.ts reads the delivery cap back, so the summarize
 *    engine still reads up to AI_INPUT_LIMITS.maxInputCharacters whatever was
 *    reserved — the FAQ says the reservation is fixed, not that it bounds the
 *    reading;
 *  - src/lib/workers/pdf-security-client.ts — runSecurityJob fetches the
 *    artifact as soon as the job completes, so the panel's Download button
 *    saves bytes already in the page; the 60-minute figure is the worker's
 *    link, not the button.
 *
 * NOT GUARDED, and said here so a reviewer knows: the panel labels quoted in
 * LENGTH_LABEL / FORMAT_LABEL, "Add your PDF, or" + Dropzone's "browse",
 * "Focus (optional)", "Summarize PDF" and "Summarizing…" are copies of JSX
 * text. A relabel in summarize-worker-panel.tsx will not fail anything.
 *
 * DELIBERATELY NOT QUOTED: a page range for the 500,000-character window.
 * aiPagesAtDensest/aiPagesAtSparsest come from densities measured on
 * 2026-08-10 through the browser's pdfjs extractor, AI_INPUT_LIMITS says to
 * re-measure before quoting them again, and the worker now reads with
 * `pdftotext -layout` (translate-limits.ts measures that at up to ~2x the
 * browser's count on columned pages). A page count in the wrong unit is the
 * number a reader can check and find false.
 */

const CEILING_MB = Math.round(WORKER_FILE_CEILING / (1024 * 1024));
const OUTPUT_TTL = DEFAULT_RETENTION.outputTtlMinutes;
/** What one run reads: the figure the FAQ and the panel's Limit row state too. */
const MAX_CHARS = aiReadLimitFor("summarize-pdf").toLocaleString("en-US");
const FOCUS_CHARS = MAX_SUMMARY_FOCUS_CHARS.toLocaleString("en-US");
/** The download name the panel shows, from the same function the worker uses. */
const EXAMPLE_ZIP = summaryOutputName("report.pdf");

/** OCR PDF's default output, by the label its panel shows. */
const OCR_PDF_MODE = OCR_OUTPUT_MODES.find(
  (mode) => mode.id === DEFAULT_OCR_OUTPUT_MODE,
)?.label;
if (!OCR_PDF_MODE) {
  throw new Error("summarize-pdf content: OCR PDF has no default output label");
}

/**
 * Tools this page sends a reader to, by the name the catalogue gives them, so a
 * rename moves the copy with it. PDF to Text is offered as the no-upload route
 * to the same text, which is only true while it runs in the browser — checked
 * here, because that is the property the sentence depends on.
 */
function linkedTool(slug: string) {
  const tool = getToolBySlug(slug);
  if (!tool) {
    throw new Error(`summarize-pdf content: no tool with slug ${slug}`);
  }
  return tool;
}
const OCR_TOOL = linkedTool("ocr-pdf").name;
const TRANSLATE_TOOL = linkedTool("translate-pdf").name;
const LOCAL_TEXT = linkedTool("pdf-to-text");
if (modeUploadsFiles(LOCAL_TEXT.processing)) {
  throw new Error(
    "summarize-pdf content: PDF to Text no longer runs in the browser; the privacy FAQ's alternative is wrong",
  );
}

/**
 * The other tools that draw on the same allowance, DISCOVERED the way the
 * route discovers what to charge (capabilityForMode(processing) === "ai"),
 * never typed. Health-checked in both directions: this tool must itself be in
 * the set (or the derivation is looking at the wrong thing), and the set must
 * not be empty (or the sentence would claim sharing with nobody).
 */
const AI_TOOLS = tools.filter(
  (tool) => capabilityForMode(tool.processing) === "ai",
);
if (!AI_TOOLS.some((tool) => tool.slug === "summarize-pdf")) {
  throw new Error(
    "summarize-pdf content: summarize-pdf is not charged as an AI tool; the allowance FAQ is wrong",
  );
}
const OTHER_AI_TOOL_NAMES = AI_TOOLS.filter(
  (tool) => tool.slug !== "summarize-pdf",
).map((tool) => tool.name);
if (OTHER_AI_TOOL_NAMES.length < 1) {
  throw new Error(
    "summarize-pdf content: no other AI tool shares the allowance; reword the FAQ",
  );
}
const OTHER_AI_TOOLS =
  OTHER_AI_TOOL_NAMES.length === 1
    ? OTHER_AI_TOOL_NAMES[0]
    : `${OTHER_AI_TOOL_NAMES.slice(0, -1).join(", ")} and ${OTHER_AI_TOOL_NAMES.at(-1)}`;

/**
 * Option labels exactly as the panel renders them. A Record, so a new length
 * or format fails the build here. The label TEXT is a copy — the panel does not
 * export its option arrays — so a relabel in the panel is not caught by this.
 */
const LENGTH_LABEL: Record<SummaryLength, string> = {
  brief: "Brief — TL;DR + key points",
  standard: "Standard — the main points",
  detailed: "Detailed — every major section",
};
const FORMAT_LABEL: Record<SummaryFormat, string> = {
  paragraphs: "Paragraphs",
  bullets: "Bullet points",
  outline: "Section outline",
};
const shortLength = (length: SummaryLength) =>
  LENGTH_LABEL[length].split(" — ")[0];

/**
 * What one summary reserves. The panel sends no character count, so the route
 * reserves deliveryCapFor's fallback for every summary regardless of length —
 * computed here by the function the route calls, with the route's arguments.
 */
const SUMMARY_RESERVATION = deliveryCapFor(
  {},
  {
    fallbackCharacters: TRANSLATE_MAX_INPUT_CHARS,
    headroom: TRANSLATE_EXTRACTOR_HEADROOM,
  },
).characters;
const SUMMARIES_PER_DAY = Math.floor(
  AI_CHARACTER_ALLOWANCE / SUMMARY_RESERVATION,
);
if (!Number.isInteger(SUMMARIES_PER_DAY) || SUMMARIES_PER_DAY < 1) {
  throw new Error(
    `summarize-pdf content: implausible summaries-per-day figure ${SUMMARIES_PER_DAY}`,
  );
}
/**
 * The same reservation in the PUBLISHED unit (the one AI_ALLOWANCE_CLAUSE
 * states), so the FAQ never mixes the bucket's unit with the visitor's.
 * Second, independent bound: the published figures must divide the same way
 * the bucket does, or one of the two derivations is wrong.
 */
const SUMMARY_SHARE_PUBLISHED = Math.round(
  (SUMMARY_RESERVATION * AI_CHARACTER_ALLOWANCE_DELIVERED) /
    AI_CHARACTER_ALLOWANCE,
);
if (
  Math.floor(AI_CHARACTER_ALLOWANCE_DELIVERED / SUMMARY_SHARE_PUBLISHED) !==
  SUMMARIES_PER_DAY
) {
  throw new Error(
    "summarize-pdf content: published and bucket units disagree on summaries per day",
  );
}
const SUMMARY_SHARE = SUMMARY_SHARE_PUBLISHED.toLocaleString("en-US");
const SUMMARIES_PHRASE = `${SUMMARIES_PER_DAY} ${SUMMARIES_PER_DAY === 1 ? "summary" : "summaries"}`;

const content: ToolContent = {
  slug: "summarize-pdf",

  seoTitle: "Summarize PDF with AI: TL;DR, Bullets or Outline",

  metaDescription: `Get an AI summary of a PDF as paragraphs, bullet points or a section outline, brief to detailed, with an optional focus. Reads up to ${MAX_CHARS} characters.`,

  intro: [
    `Summarize PDF condenses a long document into something you can read before deciding whether the full text deserves your time. You choose a length (${shortLength("brief")}, ${shortLength("standard")} or ${shortLength("detailed")}) and a shape: prose paragraphs, bullet points or an outline with headings. An optional focus line asks the model to pay special attention to whatever you name, such as deadlines, costs or risks.`,
    `The summary is written by an AI model, not in your browser. The PDF is uploaded over TLS to pdf.xyz's secure worker, which extracts its selectable text and passes that text, never the file, to a third-party AI provider. Once the job ends, success or failure, the worker deletes your uploaded PDF; its link to the summary ZIP lasts ${OUTPUT_TTL} minutes, and a storage rule that runs daily later erases the stored ZIP.`,
    `The model is given at most ${MAX_CHARS} characters of the extracted text. A longer document is summarized from its first page up to that point, and both the results panel and summary.md say how far the reading got, by page. Pages that hold only a scanned image add nothing to the summary, because no character recognition runs in this tool.`,
  ],

  useCases: [
    {
      title: "Prepare for a meeting the night before",
      body: `A board pack or quarterly report arrives late. The ${shortLength("brief")} length with the ${FORMAT_LABEL.bullets} format asks the model for a short TL;DR followed by only the key points, which fits in the time you have before a morning meeting.`,
    },
    {
      title: "Surface the obligations in a contract",
      body: 'Type a focus such as "payment terms, notice periods and termination" and the prompt asks the model to pay special attention to those subjects. It is a reading aid, not a review: check each clause in the contract itself before you rely on it.',
    },
    {
      title: "Triage papers for a literature review",
      body: `Run each paper through the ${FORMAT_LABEL.outline} format, which asks for a hierarchical outline under section headings, and you get a set of skimmable outlines to compare before choosing which papers to read in full.`,
    },
    {
      title: "Get the gist of a foreign-language report",
      body: `The model is instructed to write in the document's own language, so a Spanish report should come back summarized in Spanish; there is no setting to pick a different summary language. When you need the full text in another language, use ${TRANSLATE_TOOL}.`,
    },
  ],

  steps: [
    {
      title: "Add your PDF",
      body: `Click the box marked "Add your PDF, or browse" to pick a file, or drop one onto it. It takes one PDF per summary, and files over ${CEILING_MB} MB are refused. When the status check fails, or the worker or its AI model is not ready, a short reason takes the place of that box, alongside a button labelled "Notify me when this ships". Pressing it sends only the tool's name, to be counted as a request; nobody is notified later.`,
    },
    {
      title: "Choose a length and a format",
      body: `In Summary length, pick "${LENGTH_LABEL.brief}", "${LENGTH_LABEL.standard}" or "${LENGTH_LABEL.detailed}". In Format, pick ${FORMAT_LABEL.paragraphs}, ${FORMAT_LABEL.bullets} or ${FORMAT_LABEL.outline}. The panel starts on ${shortLength(DEFAULT_SUMMARY_LENGTH)} and ${FORMAT_LABEL[DEFAULT_SUMMARY_FORMAT]}.`,
    },
    {
      title: "Optionally set a focus",
      body: `Type up to ${FOCUS_CHARS} characters in Focus (optional) to say what the summary should emphasise; the field stops accepting text at that length. Leave it empty for a general summary.`,
    },
    {
      title: "Summarize and download",
      body: `Press Summarize PDF; the button reads Summarizing… while the file uploads and the job runs. When it finishes, the panel fetches the result at once and shows a button naming the ZIP (report.pdf becomes ${EXAMPLE_ZIP}). The ZIP holds summary.md, summary.txt, manifest.json with the provider, model and options, and README.txt.`,
    },
  ],

  faqs: [
    {
      q: "Can it summarize a scanned PDF?",
      a: `Not directly. This tool reads only text stored in the PDF as text, so a PDF whose pages are all images with no text layer is refused with a message pointing you to ${OCR_TOOL}. In ${OCR_TOOL}, select the document's language under Languages and leave Output on ${OCR_PDF_MODE}, then bring the resulting file back here. The refusal comes from the worker after the job has been submitted, so it still uses one summary's share of the daily allowance.`,
    },
    {
      q: "How long a PDF can it summarize?",
      a: `Files of up to ${CEILING_MB} MB can be uploaded, and the model is sent at most ${MAX_CHARS} characters of their text. How many pages that covers depends on how densely the document is set. Past the limit the summary covers only the opening pages, and the panel and summary.md both state how far into the document the reading reached.`,
    },
    {
      q: "Who receives the text of the PDF I summarize?",
      a: `A third-party AI provider receives the extracted text, together with your length and format choices and any focus you typed; the PDF itself never reaches it. Those providers are used under agreements that prohibit training on data sent through the API, and pdf.xyz has no control over what one does outside them. ${LOCAL_TEXT.name} pulls a PDF's text out in your browser without uploading the file, though it produces no summary.`,
    },
    {
      q: "How many PDFs can I summarize per day?",
      a: `Summaries draw on ${AI_ALLOWANCE_CLAUSE} per connection, the same pool used by ${OTHER_AI_TOOLS}. This tool does not count your document's text before uploading it, so every summary is charged a fixed ${SUMMARY_SHARE} characters of that pool, whether the PDF holds a paragraph or the full ${MAX_CHARS} the model can be sent; that comes to ${SUMMARIES_PHRASE} a day when nothing else has drawn on it. The charge is taken when the job is submitted, so a job the worker refuses or that fails still uses it, and on a shared office or campus network other people's AI jobs count too. Separately, pdf.xyz's own daily AI processing limit can pause summaries for everyone until the next day.`,
    },
    {
      q: "Can I rely on the summary being accurate?",
      a: "Use it to decide what to read, not in place of reading. The model is instructed to work only from the document's text and to add no facts, figures or names, yet a summary can still omit a point or state it wrongly. summary.md, manifest.json and README.txt all record which provider and model wrote it; check anything you intend to act on against the original pages.",
    },
  ],

  relatedGuides: [
    "how-to-translate-a-pdf",
    "how-to-make-a-scanned-pdf-searchable",
  ],
};

export default content;
