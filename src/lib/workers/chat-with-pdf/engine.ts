import JSZip from "jszip";
import {
  rethrowIfAttemptAbort,
  signalOption,
  type RunControl,
} from "../attempt-abort";
import { pdfTextOpenFailure } from "@/lib/workers/pdf-text/errors";
import { NO_SELECTABLE_TEXT_MESSAGE } from "@/lib/jobs/ai-no-text";
import type { ExtractedPdfText } from "@/lib/pdf/text";
import {
  describeWindow,
  modelTruncationNotice,
  pageStartsFor,
  userTruncationNotice,
  type PageStart,
  type TruncationWindow,
} from "../ai/truncation";
import {
  CHAT_MAX_CHARACTERS_PER_QUESTION,
  chatConversationCharacters,
  chatDocumentBudget,
  type ChatOptions,
  type ChatTurn,
} from "@/lib/jobs/chat-with-pdf";
import {
  validateCompletionRequest,
  type AiCompletionResult,
  type AiMessage,
  type AiProvider,
} from "../ai/provider";
import type { AiUsageMeta } from "@/lib/jobs/ai-results";

/**
 * Chat with PDF engine for the `chat-with-pdf` AI tool.
 *
 * This is a real, honest document question-answering engine — never a fabricated
 * "here is your answer". Given a PDF, a bounded question, and optional prior
 * conversation it:
 *   1. extracts the PDF's SELECTABLE text only (no OCR — a scanned/image-only PDF is
 *      honestly rejected as `no_text` and pointed at the OCR tool), then
 *   2. asks a configured {@link AiProvider} to answer from ONLY that text, grounding
 *      the prompt in per-page markers (`[Page N]`) when the extractor reports page
 *      metadata so the model can cite pages as `[p.N]`, then
 *   3. packages the model's real answer as a ZIP (answer.md + answer.txt +
 *      manifest.json + README.txt) recording the provider, model, question, cited
 *      pages, and honest scope.
 *
 * HONESTY (load-bearing):
 *   - No provider ⇒ `ai_unconfigured` with operator requirements. The engine NEVER
 *     invents an answer when no model is configured — checked before any file work.
 *   - No selectable text ⇒ `no_text` (run OCR first). It never answers from an
 *     empty/scanned document by guessing.
 *   - The system prompt constrains the model to the document text and instructs it to
 *     say so plainly when the document does not contain the answer — the shipped answer
 *     is exactly the model's text, unedited and unfabricated.
 *   - If the model returns an empty completion, the run fails honestly (`failed`)
 *     rather than shipping a blank answer dressed up as a result.
 *   - When the extractor reports no page metadata, the package is EXPLICIT that the
 *     answer is grounded in selectable text without page-level citations.
 *   - The text extractor and AI provider are injected, so this module stays node-free
 *     and unit-testable: production wires the real pdfjs extractor + Anthropic provider
 *     (`./native`), tests wire deterministic fakes.
 *
 * SAFETY: the question and conversation context are user-authored, already validated
 * (bounded, control-character-free, complete pairs) by the job contract. No secret ever
 * reaches this layer — the AI key lives only in the provider's closure (`../ai/native`).
 */

export const CHAT_TOOL = "chat-with-pdf" as const;
export const CHAT_ENGINE = "pdf-chat" as const;

/** Extract selectable text from a PDF; throws on an unreadable PDF. */
export type PdfTextExtractor = (
  bytes: Uint8Array,
  run?: RunControl,
) => Promise<ExtractedPdfText>;

export interface ChatWithPdfLimits {
  maxInputBytes?: number;
  maxOutputBytes?: number;
  /**
   * Max DOCUMENT characters sent to the model; longer input is truncated (never
   * silently). Defaults to {@link CHAT_MAX_CHARACTERS_PER_QUESTION}. The
   * per-question ceiling — that same number, conversation included — applies
   * on top of it ({@link chatDocumentBudget}).
   */
  maxInputChars?: number;
  /**
   * The DOCUMENT read bound THIS job was charged for, as the route priced it
   * (`aiReservationFor`). Per job, so it arrives here from the processor
   * rather than from the worker's start-up wiring. It bounds the document
   * alone — the conversation was charged separately — so it is never the
   * number the conversation is taken out of ({@link chatDocumentBudget}).
   * Absent means unbounded BY THE CAP — an undeclared or unproven run — and
   * the per-question ceiling still applies.
   */
  delivery?: { readonly characters: number };
  /** Ceiling on the model's generated tokens; the default budget is clamped to it. */
  maxOutputTokens?: number;
}

export interface ChatWithPdfDeps {
  extract?: PdfTextExtractor;
  /** A configured AI provider. Absent ⇒ the engine fails honestly as `ai_unconfigured`. */
  provider?: AiProvider;
  /** ISO timestamp source; defaults to the wall clock. Injected for deterministic tests. */
  now?: () => string;
  limits?: ChatWithPdfLimits;
}

/** Content-free metrics a successful run reports. Never carries document text or the answer body. */
export interface ChatWithPdfMeta {
  engine: typeof CHAT_ENGINE;
  tool: typeof CHAT_TOOL;
  /** AI provider family id (e.g. "anthropic"). Never a key. */
  provider: string;
  /** Public model id (e.g. "claude-sonnet-5"). Never a secret. */
  model: string;
  pageCount: number;
  /** Character count of the question (a COUNT, never the text). */
  questionCharacters: number;
  /** Number of prior conversation turns supplied as context. */
  contextTurns: number;
  /** Character count of the model's answer (a COUNT, never the text). */
  answerCharacters: number;
  /** Number of distinct pages the answer cited (0 when ungrounded or none cited). */
  citedPages: number;
  /** True when the source carried per-page metadata, so `[p.N]` citations are possible. */
  grounded: boolean;
  inputBytes: number;
  outputBytes: number;
  /** Character count of the extracted source text (a COUNT, never the text). */
  sourceCharacters: number;
  /** True when the source exceeded `maxInputChars` and only a prefix was sent. */
  truncated: boolean;
  /**
   * The user-facing sentence naming how far the window reached ("Only pages
   * 1–131 of 400 could be read…"), or `null` when nothing was cut.
   *
   * Carried on `meta` so a UI can render it from the RESULT, without depending
   * on the model having followed the prompt instruction. If the disclosure
   * relied only on what the model chose to say, it would be a promise we
   * cannot keep.
   */
  truncationNotice: string | null;
  /**
   * What the model actually saw, structurally — the block the job record carries
   * to the browser so the panel can state the bound without re-deriving it.
   */
  window: TruncationWindow;
  /**
   * Provider-reported token usage, absent when the provider did not report it.
   * Carried to the job record so an AI run's cost is measurable after the fact.
   */
  usage?: AiUsageMeta;
}

export type ChatWithPdfFailureKind =
  | "unsupported"
  | "conversation_too_long"
  | "ai_unconfigured"
  | "no_text"
  /** The PDF needs a password, or is not a readable PDF: a fact about the file. */
  | "cannot_open"
  | "too_large"
  | "rate_limited"
  | "content_filtered"
  | "failed";

export type ChatWithPdfRun =
  | {
      ok: true;
      output: Uint8Array;
      filenameExt: "zip";
      contentType: "application/zip";
      meta: ChatWithPdfMeta;
    }
  | {
      ok: false;
      kind: ChatWithPdfFailureKind;
      limitBytes?: number;
      retryable?: boolean;
      message: string;
      /**
       * Token usage when the failure came AFTER a provider call. Absent when no
       * call happened.
       *
       * `incomplete_output` is why this exists: non-retryable precisely because
       * the model hit its output ceiling, so it burned the maximum budget and is
       * the most expensive outcome in the system. A ceiling fed only by
       * successes would be blind to exactly its largest expenses.
       */
      usage?: AiUsageMeta;
      /**
       * What the model was given, when there was a call to give it to.
       *
       * SEPARATELY OPTIONAL from `usage` even though the two co-occur in
       * practice: the window is computed before the call, so a failure that
       * spent tokens always has both and a pre-extraction failure has neither.
       * Encoding "both or neither" as one object would make that invariant
       * UNFALSIFIABLE — the test could not construct the broken state to prove
       * it is rejected.
       */
      window?: TruncationWindow;
    };

/**
 * A generous default generation budget. A grounded answer is bounded by the question,
 * so a fixed default the operator's `maxOutputTokens` limit can only lower (never
 * raise) is sufficient.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 2000;
/**
 * Chat's reading ceiling is its per-question charge ceiling — see
 * {@link CHAT_MAX_CHARACTERS_PER_QUESTION} for why the read and the charge must
 * be one number. It was the shared 500,000-character reading cap until
 * 2026-09-27, read on a 41,032-character charge.
 */
const DEFAULT_MAX_INPUT_CHARS = CHAT_MAX_CHARACTERS_PER_QUESTION;

/** Assemble the grounding text. When pages carry text, prefix each with a `[Page N]`
 * marker so the model can cite pages; otherwise fall back to the joined text (ungrounded). */
function buildGrounding(extracted: ExtractedPdfText): {
  text: string;
  grounded: boolean;
  /** Where each page's chunk starts in `text`, for the truncation disclosure. */
  pageStarts: PageStart[];
  /**
   * The DOCUMENT's page count — not the number of pages that carried text.
   * "pages 1-2 of 380" for a 400-page PDF is a number the user can go and check
   * and find wrong; the twenty blank pages are still pages of the file.
   */
  pageCount: number;
} {
  const pagesWithText = extracted.pages.filter(
    (page) => page.text.trim().length > 0,
  );
  if (pagesWithText.length > 0) {
    const chunks = pagesWithText.map((page) => ({
      pageNumber: page.pageNumber,
      text: `[Page ${page.pageNumber}]\n${page.text.trim()}`,
    }));
    return {
      text: chunks.map((chunk) => chunk.text).join("\n\n"),
      grounded: true,
      // Derived from the chunks actually joined, carrying each page's REAL
      // number — a page computed from a different assembly, or from an index,
      // would be confidently wrong in a sentence the user can go and check.
      pageStarts: pageStartsFor(chunks, "\n\n"),
      pageCount: extracted.pageCount,
    };
  }
  return {
    text: extracted.text.trim(),
    grounded: false,
    pageStarts: [],
    pageCount: extracted.pageCount,
  };
}

/** The honesty-critical system prompt: answer ONLY from the document; cite pages when grounded. */
function buildSystemPrompt(
  grounding: string,
  grounded: boolean,
  window: TruncationWindow,
): string {
  const parts = [
    "You are a careful document question-answering assistant for pdf.xyz.",
    "Answer the user's question using ONLY the information in the document text provided below.",
    "Do not use outside knowledge and do not invent facts.",
    'If the document does not contain the answer, say so plainly (e.g. "The document does not state this.").',
  ];
  if (grounded) {
    parts.push(
      'The document is divided into pages marked "[Page N]". When you use information from a page, cite it inline as [p.N].',
    );
  } else {
    parts.push(
      "The document text has no page markers, so answer without page-level citations; you may quote the relevant text.",
    );
  }
  parts.push("Be concise and reference the document where possible.");
  parts.push("", "--- DOCUMENT START ---", grounding, "--- DOCUMENT END ---");
  // Appended AFTER the document so it is the last thing the model reads, and so
  // it can override the "say the document does not state this" instruction
  // above — the instruction that turned a length limit into a confident denial
  // about the user's own file.
  // Chat is instructed to say "The document does not state this." when it
  // cannot find something — so its wrong claim is a confident DENIAL.
  const notice = modelTruncationNotice(
    window,
    (upTo) =>
      "If the answer is not in the text you were given, do NOT say the document does not contain it —\n" +
      `say that you can only see ${upTo} and the answer may appear later in the document.`,
  );
  if (notice) parts.push(notice);
  return parts.join("\n");
}

/** Distinct pages the answer cited (`[p.N]`), within the document's real page range. */
function citedPagesIn(answer: string, pageCount: number): number[] {
  const cited = new Set<number>();
  const re = /\[p\.?\s*(\d+)\]/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(answer)) !== null) {
    const page = Number(match[1]);
    if (Number.isInteger(page) && page >= 1 && page <= pageCount)
      cited.add(page);
  }
  return [...cited].sort((a, b) => a - b);
}

/** Map a provider completion failure to an honest, typed run failure. */
function mapProviderFailure(
  result: Extract<AiCompletionResult, { ok: false }>,
  window: TruncationWindow,
  model: string,
): Extract<ChatWithPdfRun, { ok: false }> {
  // A provider CALL happened, so both travel with every branch below: the spend
  // is real even though the run failed. Built ONCE and spread — five copies
  // could drift into four, one definition cannot.
  const spent =
    result.usage !== undefined
      ? ({ ...result.usage, calls: 1, model } satisfies AiUsageMeta)
      : undefined;
  const carry = {
    ...(spent ? { usage: spent } : {}),
    window,
  };
  switch (result.kind) {
    case "not_configured":
      return {
        ok: false,
        kind: "ai_unconfigured",
        retryable: false,
        message: result.message,
        ...carry,
      };
    case "rate_limited":
      return {
        ok: false,
        kind: "rate_limited",
        retryable: true,
        message: result.message,
        ...carry,
      };
    case "content_filtered":
      return {
        ok: false,
        kind: "content_filtered",
        retryable: false,
        message: result.message,
        ...carry,
      };
    case "too_long":
      return {
        ok: false,
        kind: "too_large",
        retryable: false,
        message:
          "This document is too large for the AI model's context window. Try a shorter PDF or split it first.",
        ...carry,
      };
    case "timeout":
    case "invalid_response":
    case "provider_error":
    default:
      return {
        ok: false,
        kind: "failed",
        retryable: result.retryable,
        message: result.message,
        ...carry,
      };
  }
}

/**
 * Run the chat flow honestly: reject oversized input, fail `unsupported` when no text
 * extractor is wired, `ai_unconfigured` when no provider is configured, `no_text` when
 * the PDF has no selectable text (run OCR first), and map every provider failure to a
 * typed run failure — never a fabricated answer. On success, return a real ZIP package
 * (answer.md + answer.txt + manifest.json + README.txt) holding the model's real answer.
 */
export async function runChatWithPdf(
  input: Uint8Array,
  options: ChatOptions,
  deps: ChatWithPdfDeps,
  /** The attempt's abort signal, passed to the text extractor's child. */
  signal?: AbortSignal,
): Promise<ChatWithPdfRun> {
  const { extract, provider } = deps;
  if (!extract) {
    return {
      ok: false,
      kind: "unsupported",
      message:
        "Chat with PDF requires the PDF text extractor, which is not available in this environment.",
    };
  }

  // No provider is the biggest blocker and needs no file work to detect — fail first,
  // honestly, with operator requirements. Never fabricate an answer without a model.
  if (!provider) {
    return {
      ok: false,
      kind: "ai_unconfigured",
      retryable: false,
      message:
        "Answering questions about a PDF requires a configured AI provider (operator setup: PDFXYZ_AI_PROVIDER + PDFXYZ_AI_API_KEY). No provider is configured on this worker, so no answer can be produced. See docs/WORKER_ARCHITECTURE.md.",
    };
  }

  const maxInput = deps.limits?.maxInputBytes;
  if (maxInput !== undefined && input.byteLength > maxInput) {
    return {
      ok: false,
      kind: "too_large",
      limitBytes: maxInput,
      message: "The PDF input exceeds the worker's size limit.",
    };
  }

  const now = deps.now ?? (() => new Date().toISOString());

  let extracted: ExtractedPdfText;
  try {
    extracted = await extract(input, signalOption(signal));
  } catch (err) {
    rethrowIfAttemptAbort(err);
    // A file the extractor cannot OPEN (it needs a password, or is not a
    // readable PDF) gets its own reason, never the generic failure. No model
    // has been called yet, so this failure has spent nothing.
    const open = pdfTextOpenFailure(err);
    if (open) return { ok: false, ...open };
    return {
      ok: false,
      kind: "failed",
      retryable: false,
      message: "The PDF could not be read for text extraction.",
    };
  }

  const {
    text: groundingSource,
    grounded,
    pageStarts,
    pageCount: documentPageCount,
  } = buildGrounding(extracted);
  if (!extracted.hasText || groundingSource.length === 0) {
    return {
      ok: false,
      kind: "no_text",
      retryable: false,
      // One string for both sides of the upload — see `@/lib/jobs/ai-no-text`.
      message: NO_SELECTABLE_TEXT_MESSAGE["chat-with-pdf"],
    };
  }

  // What this question may read: the per-question ceiling with the
  // conversation paid out of it, the job's document cap, and the engine's own
  // document limit. The first two are one definition, shared with the test
  // that holds every accepted conversation to it.
  if (chatDocumentBudget(options) <= 0) {
    // Before any provider call. Unreachable through the API today: the 8 KB
    // options limit keeps every accepted conversation under the ceiling, and
    // `chat-with-pdf.conversation-bound.test.ts` fails if that stops holding.
    // The chat parser alone admits 50,000 characters, so a job that reached
    // the worker some other way can still arrive here.
    const conversation = chatConversationCharacters(options);
    return {
      ok: false,
      kind: "conversation_too_long",
      retryable: false,
      message: `This question and its conversation are ${conversation.toLocaleString("en-US")} characters, which uses up all ${CHAT_MAX_CHARACTERS_PER_QUESTION.toLocaleString("en-US")} characters Chat with PDF reads for one question, so no document text could be sent with them. Nothing was sent to the AI model. Start a new conversation to ask about this PDF.`,
    };
  }
  const maxChars = Math.min(
    deps.limits?.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS,
    chatDocumentBudget(options, deps.limits?.delivery),
  );
  // One description of the window, shared by the prompt, the meta and the ZIP,
  // so the model and the user cannot be told different things about it.
  const window = describeWindow(
    groundingSource,
    pageStarts,
    documentPageCount,
    maxChars,
  );
  const truncated = window.truncated;
  const grounding = truncated
    ? groundingSource.slice(0, maxChars)
    : groundingSource;

  const maxOutputTokens =
    deps.limits?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;

  const messages: AiMessage[] = [
    ...(options.context ?? []).map((turn: ChatTurn) => ({
      role: turn.role,
      content: turn.content,
    })),
    { role: "user" as const, content: options.question },
  ];

  const request = {
    system: buildSystemPrompt(grounding, grounded, window),
    messages,
    // The document is re-sent verbatim on every follow-up, so it is worth caching:
    // turn one pays a write premium and each later turn reads the span back at a
    // fraction of the price. This is the only AI tool that takes prior turns —
    // summarize, translate and ai-extract ask once per document and never return,
    // so caching there would pay the premium and never collect it.
    cacheSystem: true,
    maxOutputTokens,
    // Deterministic, factual question-answering: no creative sampling.
    temperature: 0,
  };

  // Defensive: the contract already guarantees a valid conversation; a shape check here
  // means a bug upstream fails honestly rather than dispatching a doomed request.
  const shape = validateCompletionRequest(request);
  if (!shape.ok) {
    return {
      ok: false,
      kind: "failed",
      retryable: false,
      message: `The chat request was malformed: ${shape.reason}`,
    };
  }

  const completion = await provider.complete(request);
  if (!completion.ok)
    return mapProviderFailure(completion, window, provider.model);

  const answer = completion.text.trim();
  if (answer.length === 0) {
    return {
      ok: false,
      kind: "failed",
      retryable: true,
      message:
        "The AI provider returned an empty answer, so no honest response could be produced. No answer was fabricated. Retrying may succeed.",
    };
  }

  const citedPages = grounded ? citedPagesIn(answer, extracted.pageCount) : [];

  const createdAt = now();
  const manifest: ChatManifest = {
    schema: "pdfxyz.chat/v1",
    tool: CHAT_TOOL,
    engine: CHAT_ENGINE,
    createdAt,
    provider: provider.id,
    model: completion.model,
    question: options.question,
    contextTurns: options.context?.length ?? 0,
    source: {
      pageCount: extracted.pageCount,
      characters: groundingSource.length,
      truncatedToCharacters: truncated ? maxChars : null,
      truncationNotice: userTruncationNotice(window) || null,
    },
    answer: { characters: answer.length, citedPages },
    ...(completion.usage
      ? {
          usage: {
            input: completion.usage.inputTokens,
            output: completion.usage.outputTokens,
            ...(completion.usage.cacheWriteInputTokens !== undefined
              ? { cacheWrite: completion.usage.cacheWriteInputTokens }
              : {}),
            ...(completion.usage.cachedInputTokens !== undefined
              ? { cachedInput: completion.usage.cachedInputTokens }
              : {}),
          },
        }
      : {}),
    grounded,
    notice: grounded
      ? "This answer was produced by an AI model instructed to use only the SELECTABLE TEXT of the source PDF, with inline page-level citations ([p.N]). The model may still err — verify against the original before relying on it. The model was instructed not to use outside knowledge."
      : "This answer was produced by an AI model instructed to use only the SELECTABLE TEXT of the source PDF. The extractor reported no page metadata, so the answer comes without page-level citations. The model may still err — verify against the original before relying on it. The model was instructed not to use outside knowledge.",
  };

  const output = await buildPackage(options.question, answer, manifest);
  const maxOutput = deps.limits?.maxOutputBytes;
  if (maxOutput !== undefined && output.byteLength > maxOutput) {
    return {
      ok: false,
      kind: "failed",
      retryable: false,
      message: "The answer package exceeds the worker size limit.",
    };
  }

  return {
    ok: true,
    output,
    filenameExt: "zip",
    contentType: "application/zip",
    meta: {
      engine: CHAT_ENGINE,
      tool: CHAT_TOOL,
      provider: provider.id,
      model: completion.model,
      // Token counts travel to the job record so the per-page cost of an AI run
      // is measurable after the fact. Absent when the provider did not report.
      ...(completion.usage
        ? {
            usage: {
              inputTokens: completion.usage.inputTokens,
              outputTokens: completion.usage.outputTokens,
              ...(completion.usage.cachedInputTokens !== undefined
                ? { cachedInputTokens: completion.usage.cachedInputTokens }
                : {}),
              ...(completion.usage.cacheWriteInputTokens !== undefined
                ? {
                    cacheWriteInputTokens:
                      completion.usage.cacheWriteInputTokens,
                  }
                : {}),
              // One provider call per job today. Chunked translation makes this N.
              calls: 1,
              model: completion.model,
            },
          }
        : {}),
      pageCount: extracted.pageCount,
      questionCharacters: options.question.length,
      contextTurns: options.context?.length ?? 0,
      answerCharacters: answer.length,
      citedPages: citedPages.length,
      grounded,
      inputBytes: input.byteLength,
      outputBytes: output.byteLength,
      sourceCharacters: groundingSource.length,
      truncated,
      truncationNotice: userTruncationNotice(window) || null,
      window,
    },
  };
}

// ---------------------------------------------------------------------------
// Manifest / package types + serialization
// ---------------------------------------------------------------------------

interface ChatManifest {
  schema: string;
  tool: string;
  engine: string;
  createdAt: string;
  provider: string;
  model: string;
  question: string;
  contextTurns: number;
  source: {
    pageCount: number;
    characters: number;
    truncatedToCharacters: number | null;
    /** The page-named disclosure, or null when the whole document was read. */
    truncationNotice: string | null;
  };
  answer: { characters: number; citedPages: number[] };
  /**
   * Token accounting, when the provider reported it. Counts only — never text.
   *
   * `cachedInput` and `cacheWrite` are what make the caching decision auditable
   * rather than assumed. Caching the document is a bet that a second question
   * follows: turn one pays a write premium and only a later turn collects.
   * Recorded next to `contextTurns`, they answer the question directly — do
   * requests carrying prior turns actually show cache reads, and what did the
   * writes cost? If reads stay zero across real traffic the bet is not paying and
   * `cacheSystem` should come back off.
   *
   * ⚠️ `cacheWrite` WAS MISSING UNTIL 2026-08-11, AND WITHOUT IT THE BET COULD NOT
   * BE EVALUATED AT ALL. Anthropic's `input` is the UNCACHED REMAINDER; turn one
   * of a `cacheSystem` request writes the whole document into the cache and bills
   * it to a field nothing read. A 50-page document recorded as 20 input tokens.
   * Worse for the decision this block exists to support: a zero `cachedInput`
   * could not distinguish "cached and never re-read" from "never cached at all" —
   * Anthropic silently declines to cache below ~1024 tokens — so the read side was
   * ambiguous and the cost side was invisible.
   *
   * ADDITIVE, and the schema stays `pdfxyz.chat/v1`: an optional field no reader
   * is required to know about does not break one, and bumping a version for an
   * addition trains us to bump it for nothing. **Absent means NOT MEASURED, never
   * zero** — which is also true of every manifest produced before this commit.
   * There is no back-fill: the numbers were never stored.
   */
  usage?: {
    input: number;
    output: number;
    cachedInput?: number;
    cacheWrite?: number;
  };
  grounded: boolean;
  notice: string;
}

/** Render answer.md: a provenance header, the question, and the model's answer. */
function renderMarkdown(
  question: string,
  answer: string,
  manifest: ChatManifest,
): string {
  const lines: string[] = [];
  lines.push("# Answer");
  lines.push("");
  lines.push(
    `> Answered by ${manifest.provider} (${manifest.model}) from the selectable text of the source PDF.`,
  );
  lines.push(
    `> Pages: ${manifest.source.pageCount} · Source characters: ${manifest.source.characters}${manifest.source.truncatedToCharacters !== null ? ` (truncated to ${manifest.source.truncatedToCharacters} for answering)` : ""}`,
  );
  if (manifest.grounded && manifest.answer.citedPages.length > 0) {
    lines.push(
      `> Cited pages: ${manifest.answer.citedPages.map((p) => `p.${p}`).join(", ")}`,
    );
  }
  lines.push("");
  lines.push("## Question");
  lines.push("");
  lines.push(question);
  lines.push("");
  lines.push("## Answer");
  lines.push("");
  lines.push(answer);
  lines.push("");
  lines.push("---");
  lines.push(`_${manifest.notice}_`);
  return lines.join("\n");
}

/** Render answer.txt: a plain Q/A rendering with no Markdown. */
function renderText(question: string, answer: string): string {
  return `Q: ${question}\n\nA: ${answer}\n`;
}

/** Render a plain-text README describing the package and its honest scope. */
function renderReadme(manifest: ChatManifest): string {
  const lines: string[] = [];
  lines.push("pdf.xyz — Chat with PDF Answer Package");
  lines.push("======================================");
  lines.push("");
  lines.push(`Generated: ${manifest.createdAt}`);
  lines.push(`Provider: ${manifest.provider}`);
  lines.push(`Model: ${manifest.model}`);
  lines.push(`Question: ${manifest.question}`);
  if (manifest.contextTurns > 0) {
    lines.push(`Conversation context: ${manifest.contextTurns} prior turn(s)`);
  }
  lines.push(
    `Grounding: ${manifest.grounded ? "page-level (with [p.N] citations)" : "selectable text (no page-level citations)"}`,
  );
  lines.push("");
  lines.push("Contents:");
  lines.push(
    "  answer.md      The model's answer with a provenance header and the question.",
  );
  lines.push("  answer.txt     A plain-text Q/A rendering of the same answer.");
  lines.push(
    "  manifest.json  A structured record of the request (provider, model, question, scope).",
  );
  lines.push("");
  lines.push("HONEST SCOPE:");
  lines.push("  " + manifest.notice);
  return lines.join("\n");
}

/** Package the answer + manifest + README into a real ZIP. */
async function buildPackage(
  question: string,
  answer: string,
  manifest: ChatManifest,
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("answer.md", renderMarkdown(question, answer, manifest));
  zip.file("answer.txt", renderText(question, answer));
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("README.txt", renderReadme(manifest));
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}
