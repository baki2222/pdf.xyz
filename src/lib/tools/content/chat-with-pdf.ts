import type { ToolContent } from "./types";
import { AI_INPUT_LIMITS, DEFAULT_RETENTION } from "@/lib/jobs/types";
import {
  MAX_CONTEXT_TURNS,
  MAX_QUESTION_CHARS,
  chatAnswerOutputName,
} from "@/lib/jobs/chat-with-pdf";
import {
  AI_ALLOWANCE_CLAUSE,
  AI_CHARACTER_ALLOWANCE,
  AI_CHARACTER_ALLOWANCE_DELIVERED,
} from "@/lib/jobs/ai-allowance";
import { deliveryCapFor } from "@/lib/jobs/delivery-cap";
import {
  TRANSLATE_EXTRACTOR_HEADROOM,
  TRANSLATE_MAX_INPUT_CHARS,
} from "@/lib/jobs/translate-limits";
import { capabilityForMode } from "@/lib/jobs/capabilities";
import { getToolBySlug } from "@/lib/tools";
import { WORKER_FILE_CEILING } from "@/lib/tools/file-ceilings";

/*
 * Behaviour claims below were read from the implementation on 2026-09-27:
 *  - src/components/tools/chat-with-pdf-worker-panel.tsx — the "Add your PDF, or"
 *    drop zone (+ Dropzone's "browse"), the "Your question" / "Ask a follow-up"
 *    box, the "Ask the PDF" / "Send follow-up" button ("Answering…" while busy),
 *    "Remove" beside the file name, the conversation list rendered ABOVE the
 *    question box, the per-answer download button labelled with the ZIP name,
 *    the ContextNote rendered between the box and the button, and that the whole
 *    builder (drop zone included) only mounts when the badge reads
 *    "Secure worker";
 *  - src/lib/workers/chat-with-pdf/engine.ts — selectable text only (no OCR,
 *    `no_text` points at OCR PDF), `[Page N]` markers on pages that carry text,
 *    `[p.N]` citations, cited pages filtered to the file's page range, the
 *    answer ZIP (answer.md, answer.txt, manifest.json, README.txt), and the
 *    truncation instruction that forbids "the document does not state this"
 *    for text past the reading limit;
 *  - src/lib/workers/chat-with-pdf-conversation.ts — follow-up context is the
 *    most recent exchanges, capped by MAX_CONTEXT_TURNS and a byte budget;
 *  - src/app/api/jobs/route.ts + src/lib/jobs/delivery-cap.ts — the chat panel
 *    declares no character count, so each question reserves deliveryCapFor's
 *    fallback at submit time (computed below with the route's own arguments);
 *    only processor/translate.ts reads the delivery cap back, so the chat
 *    engine still reads up to AI_INPUT_LIMITS.maxInputCharacters;
 *  - src/app/privacy/page.tsx §2–§3 — input deleted at the job's end, link
 *    expiry, daily storage rule; text, not the PDF, goes to the provider;
 *    training prohibited by agreement; the provider cache lasts minutes;
 *    "There are no accounts." (the meta description's "No account needed").
 *
 * Adversarial re-check, same day — corrected here:
 *  - "every question reserves the most one run can take" was FALSE: a question
 *    is charged the translate-sized fallback while the chat engine reads up to
 *    AI_INPUT_LIMITS.maxInputCharacters, many times more. The FAQ now says the
 *    charge is fixed, not that it bounds the reading;
 *  - the "about N pages of dense text" gloss was removed, as summarize-pdf's
 *    page did: aiPagesAtDensest divides by densities measured through the
 *    browser's pdfjs extractor, and the worker reads with `pdftotext -layout`;
 *  - the 500,000 window counts the page-labelled text the model receives
 *    ("[Page N]" markers included), so the copy says so;
 *  - answers render in the conversation ABOVE the question box, not under it;
 *  - OCR PDF's languages are toggle buttons, so nothing is "ticked";
 *  - "the worker keeps nothing" / "no conversation is held on the server" were
 *    too wide: each answer ZIP (question and answer inside) is stored until
 *    OUTPUT_TTL plus the daily sweep. What is true is narrower — nothing links
 *    one question to the next on the worker — and that is what the copy says;
 *  - "one of your N questions" assumed an untouched pool; a refused scan costs
 *    a question's worth of characters, which is what the FAQ now states;
 *  - [p.N] = physical page order, VERIFIED on 2026-09-27 by running a 4-page
 *    PDF (page 2 blank) through the real `pdftotext -layout` extractor and
 *    runChatWithPdf with a fake provider: the prompt held [Page 1], [Page 3],
 *    [Page 4] — the blank page kept its slot — and an out-of-range [p.9] was
 *    dropped from citedPages. (Local Git-for-Windows poppler, not the worker
 *    image's.)
 *
 * NOT GUARDED: the panel labels quoted below are copies of JSX text; a relabel
 * in chat-with-pdf-worker-panel.tsx will not fail anything here.
 */

/** A tool this page sends readers to, by its catalogue name. */
function linkedTool(slug: string) {
  const tool = getToolBySlug(slug);
  if (!tool)
    throw new Error(`chat-with-pdf content: no tool with slug ${slug}`);
  return tool;
}
const OCR_TOOL = linkedTool("ocr-pdf").name;
const EXTRACT_TOOL = linkedTool("extract-pages").name;

// Health check for the allowance FAQ: it is only true while the route charges
// this tool as an AI tool — the same predicate the route uses.
if (capabilityForMode(linkedTool("chat-with-pdf").processing) !== "ai") {
  throw new Error(
    "chat-with-pdf content: chat is no longer charged as an AI tool; the allowance FAQ is wrong",
  );
}

const OUTPUT_TTL = DEFAULT_RETENTION.outputTtlMinutes;
const CEILING_MB = Math.round(WORKER_FILE_CEILING / (1024 * 1024));
const READ_CHARS = AI_INPUT_LIMITS.maxInputCharacters.toLocaleString("en-US");
const QUESTION_CHARS = MAX_QUESTION_CHARS.toLocaleString("en-US");
/** Exchanges = two turns each; the conversation module caps at this too. */
const MAX_EXCHANGES = Math.floor(MAX_CONTEXT_TURNS / 2);
/** The download name the panel shows, from the function the worker names it with. */
const EXAMPLE_ZIP = chatAnswerOutputName("lease.pdf");

/**
 * What ONE chat question reserves from the daily allowance. The panel sends no
 * `declaredCharacters`, so the route reserves its fallback — computed here by
 * the very function the route calls, with the same two arguments.
 */
const PER_QUESTION = deliveryCapFor(
  {},
  {
    fallbackCharacters: TRANSLATE_MAX_INPUT_CHARS,
    headroom: TRANSLATE_EXTRACTOR_HEADROOM,
  },
).characters;
const QUESTIONS_PER_DAY = Math.floor(AI_CHARACTER_ALLOWANCE / PER_QUESTION);
if (!Number.isInteger(QUESTIONS_PER_DAY) || QUESTIONS_PER_DAY < 1) {
  throw new Error(
    `chat-with-pdf content: implausible questions-per-day figure ${QUESTIONS_PER_DAY}`,
  );
}
/**
 * The same charge in the PUBLISHED unit (the one AI_ALLOWANCE_CLAUSE states),
 * so the FAQ never mixes the bucket's unit with the visitor's. Second,
 * independent bound: the published figures must divide the way the bucket does.
 */
const PER_QUESTION_PUBLISHED = Math.round(
  (PER_QUESTION * AI_CHARACTER_ALLOWANCE_DELIVERED) / AI_CHARACTER_ALLOWANCE,
);
if (
  Math.floor(AI_CHARACTER_ALLOWANCE_DELIVERED / PER_QUESTION_PUBLISHED) !==
  QUESTIONS_PER_DAY
) {
  throw new Error(
    "chat-with-pdf content: published and bucket units disagree on questions per day",
  );
}
// The FAQ contrasts the fixed charge with a far larger reading window; if the
// charge ever reaches the window, that contrast is false.
if (PER_QUESTION_PUBLISHED >= AI_INPUT_LIMITS.maxInputCharacters) {
  throw new Error(
    "chat-with-pdf content: a question's charge no longer sits below the reading window",
  );
}
const PER_QUESTION_CHARS = PER_QUESTION_PUBLISHED.toLocaleString("en-US");
const QUESTIONS_PHRASE = `${QUESTIONS_PER_DAY} ${QUESTIONS_PER_DAY === 1 ? "question" : "questions"}`;

const content: ToolContent = {
  slug: "chat-with-pdf",

  seoTitle: "Chat with PDF: Ask Questions, Get Page Citations",

  metaDescription:
    "Ask a PDF questions and get answers based on its text, with [p.N] page citations and follow-ups. Scanned files need OCR first. No account needed.",

  intro: [
    `Chat with PDF answers questions about one document at a time. Ask "What is the notice period?" and the model receives your PDF's text with every page that has text marked by its number, plus an instruction to answer from that text alone and to cite what it used as [p.4]. If the answer is not there, the instruction is to say so plainly instead of reaching for outside knowledge.`,
    `Only the PDF's selectable text is read; no character recognition runs here. A scan or photographed document has no such text, so the worker refuses it and points you to ${OCR_TOOL}; run that first and ask the searchable copy. Uploads of up to ${CEILING_MB} MB are accepted, and the model is sent at most ${READ_CHARS} characters of the page-labelled text. For a longer file, a notice above the answer says how far into the document the reading got, by page when the text allows.`,
    `There is no in-browser mode. Every question is its own job: the PDF goes over TLS to pdf.xyz's secure worker, which pulls out the text and forwards it, with your question and the recent exchanges, to a third-party AI provider, while the PDF file itself is not passed on. That job's upload is removed as soon as it ends, the worker's link to its answer ZIP lapses ${OUTPUT_TTL} minutes after the answer is ready, and a storage rule that runs once a day clears the leftover copy. The worker does not link one question to the next; this page holds the conversation and re-sends it each time.`,
  ],

  useCases: [
    {
      title: "Find one clause in a long contract",
      body: "Ask for the termination terms, the renewal date or who pays for repairs, then follow the page citation to read the exact wording before you rely on it.",
    },
    {
      title: "Pull the figures out of an invoice or statement",
      body: "Ask for the total due, the due date or the payment method and get a short answer that should name the page each figure sits on.",
    },
    {
      title: "Check a research paper's method",
      body: "Ask how large the sample was or what limitations the authors state, then compare the cited page against the answer.",
    },
    {
      title: "Look something up in a handbook",
      body: "Leave rules and warranty conditions hide in long policy documents; ask directly, then narrow it down with a follow-up.",
    },
  ],

  steps: [
    {
      title: "Add your PDF",
      body: "When the status badge reads Secure worker, the Add your PDF, or browse area appears, together with the question box. Drop one PDF on it or click browse.",
    },
    {
      title: "Type your question",
      body: `Write it in the Your question box in plain language, up to ${QUESTION_CHARS} characters, and press Ask the PDF. The button reads Answering… until the answer package is back in the page.`,
    },
    {
      title: "Read the answer and its citations",
      body: `Each exchange is added to the conversation above the question box: your question, then the model's answer with any [p.N] markers it wrote. Beneath it, a button named after the ZIP (lease.pdf gives ${EXAMPLE_ZIP}) saves the package the page already holds: answer.md, answer.txt, manifest.json and README.txt.`,
    },
    {
      title: "Ask a follow-up",
      body: "The box becomes Ask a follow-up and the button Send follow-up. A note above the button says how many earlier exchanges travel with the next question and whether any were shortened or dropped. Remove, beside the file name, clears the file and the conversation.",
    },
  ],

  faqs: [
    {
      q: "Where do the page citations come from, and can I trust them?",
      a: "Before the model sees the text, each page that has any is marked with its position in the file, and the model is told to cite the pages it uses as [p.N]. That position counts from the first page of the file, blank pages included, so it can differ from the printed number when a document opens with a cover or roman-numbered front matter. answer.md lists the cited pages that exist in your file, but a citation is still the model's claim: open the page and check it.",
    },
    {
      q: "Why does it say my PDF has no text to answer from?",
      a: `The file is most likely a scan or image-only PDF, so there is no selectable text to answer from. The allowance is reserved on submit, before the worker opens the file, so a refused scan still costs a question's ${PER_QUESTION_CHARS} characters of the day's allowance. Run it through ${OCR_TOOL}, pressing the document's language under Languages, then ask the OCR'd copy; answers are only as good as the recognised text.`,
    },
    {
      q: "What if the answer is in a part of the document it did not read?",
      a: `Past the first ${READ_CHARS} characters, the model is told not to claim the document lacks something but to say how far it can see, and the notice above the answer says where the reading ended. For a very long file, pull the section you need into its own PDF with ${EXTRACT_TOOL} and ask that; its citations then count the pages of the extracted copy, not the original.`,
    },
    {
      q: "Does it remember my earlier questions?",
      a: `Only while the page stays open. Nothing carries over on the worker from one question to the next, so this page re-sends up to ${MAX_EXCHANGES} of the latest question-and-answer pairs with each follow-up, fewer when they are long, and uploads the PDF again. Removing the file or reloading the page starts over.`,
    },
    {
      q: "How many questions can I ask in a day?",
      a: `Each question is paid for out of ${AI_ALLOWANCE_CLAUSE}, allotted to your connection rather than to this tool alone. The page does not measure your document before sending it, so each question, follow-ups included, costs a flat ${PER_QUESTION_CHARS} characters of that pool, whether the PDF is one page or runs past the ${READ_CHARS}-character reading window. That is ${QUESTIONS_PHRASE} a day if nothing else has used the pool; on a shared network, other people's AI jobs count against it too. Apart from that, a service-wide daily limit on AI processing can pause every AI tool until the next day.`,
    },
    {
      q: "Does the AI provider train on my PDF or keep a copy?",
      a: "The provider is sent the extracted text, your question and the recent exchanges; the PDF file is not sent to it. Training on what arrives through the API is ruled out by the agreements pdf.xyz uses its providers under, and beyond those terms a provider's handling is not something pdf.xyz can control. Because the same text returns with each follow-up, the provider keeps it in a short-lived cache, measured in minutes rather than days, which lowers the cost of reprocessing it. If that is too much exposure for a document, keep it out of the AI tools.",
    },
  ],

  relatedGuides: ["how-to-make-a-scanned-pdf-searchable"],
};

export default content;
