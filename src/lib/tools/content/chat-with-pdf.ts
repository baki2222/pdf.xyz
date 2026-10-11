import type { ToolContent } from "./types";
import { DEFAULT_RETENTION } from "@/lib/jobs/types";
import {
  MAX_QUESTION_CHARS,
  chatAnswerOutputName,
} from "@/lib/jobs/chat-with-pdf";
import { aiReadLimitFor } from "@/lib/jobs/ai-read-limit";
import {
  AI_ALLOWANCE_CLAUSE,
  AI_ALLOWANCE_WHO_SHARES,
  AI_PER_CALL_RUNS_PER_DAY_AT_LEAST,
  AI_PER_CALL_RUN_CEILING,
} from "@/lib/jobs/ai-allowance";
import { capabilityForMode } from "@/lib/jobs/capabilities";
import { getToolBySlug } from "@/lib/tools";
import { WORKER_FILE_CEILING } from "@/lib/tools/file-ceilings";

/*
 * Behaviour claims below were read from the implementation on 2026-09-27:
 *  - src/components/tools/chat-with-pdf-worker-panel.tsx — the "Add your PDF, or"
 *    drop zone (+ Dropzone's "browse"), the "Your question" / "Ask a follow-up"
 *    box, the "Ask the PDF" / "Send follow-up" button, whose busy label is
 *    `jobBusyLabel(job.phase, "Answering…")` (worker-job.tsx): Uploading your
 *    file…, Waiting for the worker…, Answering…, Downloading the result… (this
 *    said 'Answering… while busy', and step 2 that the button read Answering…
 *    until the answer was back, until 2026-10-07),
 *    "Remove" beside the file name, the conversation list rendered ABOVE the
 *    question box, the per-answer download button labelled with the ZIP name,
 *    the ContextNote rendered between the box and the button, and that the whole
 *    builder (drop zone included) only mounts when the badge reads
 *    "Secure worker";
 *  - src/lib/workers/chat-with-pdf/engine.ts — selectable text only (no OCR,
 *    `no_text` points at OCR PDF; that refusal is reached only by a file the
 *    browser could not parse, since the panel's measureChatDocument and
 *    runSecurityJob's step 0 stop a PDF with no text before upload — intro[1]
 *    said "the worker refuses it" until 2026-10-07), `[Page N]` markers on
 *    pages that carry text,
 *    `[p.N]` citations, cited pages filtered to the file's page range, the
 *    answer ZIP (answer.md, answer.txt, manifest.json, README.txt), and the
 *    truncation instruction that forbids "the document does not state this"
 *    for text past the reading limit;
 *  - src/lib/workers/chat-with-pdf-conversation.ts — follow-up context is the
 *    most recent exchanges, capped by MAX_CONTEXT_TURNS and a byte budget;
 *  - src/app/api/jobs/route.ts + src/lib/jobs/delivery-cap.ts — the chat panel
 *    measures its document in the browser (measureChatDocument) and declares
 *    it; the route prices each question with aiReservationFor, never above
 *    one whole run, and a PDF the browser finds no text in is stopped before
 *    anything is uploaded or charged (re-read 2026-10-06: this said the panel
 *    declared nothing and that a refused scan still cost a question);
 *    since wave1/L08 the chat engine reads at most one whole run,
 *    CHAT_MAX_CHARACTERS_PER_QUESTION, with the question and the carried
 *    conversation paid out of it first (this file was written before L08 and
 *    said it read up to AI_INPUT_LIMITS.maxInputCharacters; corrected at the
 *    seo/content merge);
 *  - src/app/privacy/page.tsx §2–§3 — input deleted at the job's end, link
 *    expiry, daily storage rule; text, not the PDF, goes to the provider;
 *    training prohibited by agreement; the provider cache lasts minutes;
 *    "There are no accounts." (the meta description's "No account needed").
 *
 * Adversarial re-check, same day — corrected here:
 *  - "every question reserves the most one run can take" was FALSE when
 *    written: a question was charged the translate-sized fallback while the
 *    chat engine read up to AI_INPUT_LIMITS.maxInputCharacters. L08 made the
 *    engine read at most the charge, so the FAQ states the per-question
 *    reading ceiling and a flat charge, and no longer contrasts them;
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
 *  - "one of your N questions" assumed an untouched pool. The same pass wrote
 *    that "a refused scan costs a question's worth of characters", which was
 *    false by 2026-10-06 (the browser refuses a scan before upload and nothing
 *    is charged) and was corrected then; only a file the browser cannot open
 *    is charged before the worker's refusal;
 *  - [p.N] = physical page order, VERIFIED on 2026-09-27 by running a 4-page
 *    PDF (page 2 blank) through the real `pdftotext -layout` extractor and
 *    runChatWithPdf with a fake provider: the prompt held [Page 1], [Page 3],
 *    [Page 4] — the blank page kept its slot — and an out-of-range [p.9] was
 *    dropped from citedPages. (Local Git-for-Windows poppler, not the worker
 *    image's.)
 *
 * NOT GUARDED: the panel labels quoted below are copies of JSX text; a relabel
 * in chat-with-pdf-worker-panel.tsx will not fail anything here. The busy
 * labels are the exception: tools/busy-label-claims.test.ts derives them from
 * every `jobBusyLabel(` call and holds a step that names one to the stages
 * around it.
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
/**
 * What ONE question reads, question and conversation included (L08): the
 * figure the FAQ and the panel's Limit row state too.
 */
const READ_CHARS = aiReadLimitFor("chat-with-pdf").toLocaleString("en-US");
const QUESTION_CHARS = MAX_QUESTION_CHARS.toLocaleString("en-US");
/** The download name the panel shows, from the function the worker names it with. */
const EXAMPLE_ZIP = chatAnswerOutputName("lease.pdf");

/**
 * What one question can cost, stated only as far as it is true on EVERY worker
 * image (the ruling `aiAllowanceFactFor` records): never more than one whole
 * run, `AI_PER_CALL_RUN_CEILING` in the published unit, so at least
 * `AI_PER_CALL_RUNS_PER_DAY_AT_LEAST` fit in a day. A shorter document costs
 * less only on a worker that has proved its read cap (`aiReservationFor`), so
 * the page does not promise that.
 *
 * WAS a flat charge computed here with `deliveryCapFor({}, …)` ("each question, follow-ups included, costs a flat 10,258 characters … 3 questions a day"),
 * written before per-call pricing: the panel declares its document's
 * characters, and the route prices through `aiReservationFor`. True of an
 * unproven worker only. `tools/ai-allowance-per-tool.test.ts` now reads every
 * sentence the page SERVES for that claim, not only the fact line.
 */
const RUN_CEILING = AI_PER_CALL_RUN_CEILING.toLocaleString("en-US");
const QUESTIONS_PHRASE = `${AI_PER_CALL_RUNS_PER_DAY_AT_LEAST} ${AI_PER_CALL_RUNS_PER_DAY_AT_LEAST === 1 ? "question" : "questions"}`;

const content: ToolContent = {
  slug: "chat-with-pdf",

  seoTitle: "Chat with PDF: Ask Questions, Get Page Citations",

  metaDescription:
    "Ask a PDF questions and get answers based on its text, with [p.N] page citations and follow-ups. Scanned files need OCR first. No account needed.",

  intro: [
    `Chat with PDF answers questions about one document at a time. Ask "What is the notice period?" and the model receives your PDF's text with every page that has text marked by its number, plus an instruction to answer from that text alone and to cite what it used as [p.4]. If the answer is not there, the instruction is to say so plainly instead of reaching for outside knowledge.`,
    `Only the PDF's selectable text is read; no character recognition runs here. A scan or photographed document has no such text, so the page stops it before upload (the worker refuses any the browser cannot check) and points you to ${OCR_TOOL}; run that first and ask the searchable copy. Uploads of up to ${CEILING_MB} MB are accepted, and the model is sent at most ${READ_CHARS} characters of the page-labelled text. For a longer file, a notice above the answer says how far into the document the reading got, by page when the text allows.`,
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
      body: `Write it in the Your question box in plain language, up to ${QUESTION_CHARS} characters, and press Ask the PDF. While it runs, the button says where the job is (Uploading your file…, Waiting for the worker…, Answering…, Downloading the result…) until the answer package is back in the page.`,
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
      a: `The file is most likely a scan or image-only PDF, so there is no selectable text to answer from. The page checks the file for text before sending it, and when it finds none the question stops there and takes nothing from the day's allowance. A file the page cannot open is sent on to the worker, and if the worker finds no text in it either, that refusal comes after the question has been charged. Run it through ${OCR_TOOL}, pressing the document's language under Languages, then ask the OCR'd copy; answers are only as good as the recognised text.`,
    },
    {
      q: "What if the answer is in a part of the document it did not read?",
      a: `Each question reads at most ${READ_CHARS} characters, the question and the conversation sent with it included; the document gets what is left. Past that point, the model is told not to claim the document lacks something but to say how far it can see, and the notice above the answer says where the reading ended. For a very long file, pull the section you need into its own PDF with ${EXTRACT_TOOL} and ask that; its citations then count the pages of the extracted copy, not the original.`,
    },
    {
      q: "What happens to the conversation if I reload the page?",
      a: "It starts over. Nothing carries over on the worker from one question to the next: the conversation lives in this page, which re-sends the recent exchanges with each follow-up and uploads the PDF again. Removing the file or reloading the page starts a new conversation.",
    },
    {
      q: "How many questions can I ask in a day?",
      a: `Each question is paid for out of ${AI_ALLOWANCE_CLAUSE}, which every AI tool draws on, not this tool alone. ${AI_ALLOWANCE_WHO_SHARES} Every question, follow-ups included, is a run of its own, and one question never costs more than ${RUN_CEILING} characters of that pool, whether the PDF is one page or a thousand. That makes at least ${QUESTIONS_PHRASE} a day if nothing else has used the pool. Apart from that, a service-wide daily limit on AI processing can pause every AI tool until the next day.`,
    },
    {
      q: "Does the AI provider train on my PDF or keep a copy?",
      a: "The provider is sent the extracted text, your question and the recent exchanges; the PDF file is not sent to it. Training on what arrives through the API is ruled out by the agreements pdf.xyz uses its providers under, and beyond those terms a provider's handling is not something pdf.xyz can control. Because the same text returns with each follow-up, the provider keeps it in a short-lived cache, measured in minutes rather than days, which lowers the cost of reprocessing it. If that is too much exposure for a document, keep it out of the AI tools.",
    },
  ],

  relatedGuides: ["how-to-make-a-scanned-pdf-searchable"],
};

export default content;
