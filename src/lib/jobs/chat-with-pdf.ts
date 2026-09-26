/**
 * Chat with PDF job contract — the typed, framework-agnostic options and validator
 * for the `chat-with-pdf` AI tool, plus its deterministic output naming.
 *
 * This is the AI-tool sibling of `@/lib/jobs/summarize-pdf.ts`, `translate-pdf.ts`,
 * and `ai-extract.ts`: pure data plus a pure parser — no Next.js, no storage, no AI
 * SDK. It defines exactly what one chat request may ask for (a bounded QUESTION and
 * optional prior CONVERSATION CONTEXT) so the UI, the worker engine, and the docs
 * share one honest source of truth. It depends only on `./responses`,
 * `./filenames` and the pure constants in `./translate-limits`, so a client
 * component can import the validator without pulling a Node built-in or the AI
 * provider into the bundle.
 *
 * HONEST SCOPE (load-bearing): this contract only *describes* a request. Producing an
 * answer requires a configured AI provider and selectable text in the PDF; the worker
 * engine fails honestly (never a fabricated answer) when either is missing, and the
 * answer is grounded in ONLY the document's selectable text. A request MUST carry a
 * question — an empty request is rejected, never turned into a guess.
 *
 * SAFETY: the question and each context turn are user-authored text that travels in
 * the job's `options` body and is woven into the model prompt server-side. It carries
 * no secret; the AI API key lives only in the worker's environment and is never part
 * of a request. Inputs are bounded and control-character-free (newlines/tabs aside) so
 * they can never smuggle a log-injection or terminal-escape payload. The conversation
 * context must be complete, strictly-alternating user/assistant pairs ending on an
 * assistant turn, so appending the new question yields a valid single-user-final
 * completion the provider can never reject as malformed.
 */

import { apiError, type ParseResult } from "./responses";
import {
  MAX_DISPLAY_FILENAME_LENGTH,
  sanitizeDisplayFilename,
} from "./filenames";
import {
  TRANSLATE_EXTRACTOR_HEADROOM,
  TRANSLATE_MAX_INPUT_CHARS,
} from "./translate-limits";

/**
 * The tool this contract describes. The worker engine's `CHAT_TOOL` is the same
 * literal (kept literal there because `ai-ceiling-surfaces.test.ts` discovers
 * engines by it); `chat-with-pdf.delivery.test.ts` pins the two together.
 */
export const CHAT_TOOL_SLUG = "chat-with-pdf" as const;

/** The neutral stem used when nothing safe survives filename sanitization. */
const FALLBACK_STEM = "document";

/** The two conversational roles a context turn may carry. */
export const CHAT_ROLES = ["user", "assistant"] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];

/** Max length of the user's question. */
export const MAX_QUESTION_CHARS = 2000;
/** Max number of prior conversation turns the request may carry as context. */
export const MAX_CONTEXT_TURNS = 12;
/** Max length of a single prior conversation turn. */
export const MAX_TURN_CHARS = 4000;

const ROLE_SET: ReadonlySet<string> = new Set(CHAT_ROLES);

// C0 control characters (U+0000–U+001F) and DEL. The question and turns tolerate
// newline/tab (a multi-line message is legitimate) but nothing else.
const CONTROL_CHAR_ALLOW_WS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

/** One prior conversation turn supplied as context for a follow-up question. */
export interface ChatTurn {
  role: ChatRole;
  content: string;
}

/** Validated options for a `chat-with-pdf` job. */
export interface ChatOptions {
  /** The user's question. Bounded, control-character-free, always present. */
  question: string;
  /**
   * Optional prior conversation, as complete user/assistant pairs (strictly
   * alternating, first `user`, last `assistant`). Absent for a fresh question.
   */
  context?: ChatTurn[];
}

function invalid(message: string, field: string): ParseResult<never> {
  return {
    ok: false,
    error: apiError("invalid_request", message, [{ field, message }]),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate one context turn at `index`, given the role its position requires. */
function parseTurn(
  raw: unknown,
  index: number,
  expectedRole: ChatRole,
): ParseResult<ChatTurn> {
  const at = `context[${index}]`;
  if (!isObject(raw)) {
    return invalid(
      `\`${at}\` must be an object with a \`role\` and \`content\`.`,
      at,
    );
  }
  if (typeof raw.role !== "string" || !ROLE_SET.has(raw.role)) {
    return invalid(
      `\`${at}.role\` must be one of ${CHAT_ROLES.join(", ")}.`,
      `${at}.role`,
    );
  }
  if (raw.role !== expectedRole) {
    return invalid(
      `\`${at}.role\` must be "${expectedRole}" — conversation context must be complete user/assistant pairs, alternating and ending with an assistant turn.`,
      `${at}.role`,
    );
  }
  if (typeof raw.content !== "string" || raw.content.trim().length === 0) {
    return invalid(`\`${at}.content\` is required.`, `${at}.content`);
  }
  const content = raw.content.trim();
  if (CONTROL_CHAR_ALLOW_WS.test(content)) {
    return invalid(
      `\`${at}.content\` cannot contain control characters.`,
      `${at}.content`,
    );
  }
  if (content.length > MAX_TURN_CHARS) {
    return invalid(
      `\`${at}.content\` is too long (max ${MAX_TURN_CHARS} characters).`,
      `${at}.content`,
    );
  }
  return { ok: true, value: { role: raw.role as ChatRole, content } };
}

/**
 * Parse the free-form `options` bag of a `chat-with-pdf` job into typed, validated
 * options. Strict and honest: a `question` is REQUIRED, bounded, and control-character
 * free; optional `context` must be a bounded list of complete user/assistant pairs
 * (strictly alternating, first `user`, last `assistant`) so appending the new question
 * yields a valid conversation the provider can run. A request without a question is
 * rejected — the engine never invents one.
 */
export function parseChatOptions(
  options: Record<string, unknown>,
): ParseResult<ChatOptions> {
  if (!isObject(options)) {
    return invalid("`options` must be an object.", "options");
  }

  if (
    typeof options.question !== "string" ||
    options.question.trim().length === 0
  ) {
    return invalid(
      "`question` is required — ask what you want to know about the PDF.",
      "question",
    );
  }
  const question = options.question.trim();
  if (CONTROL_CHAR_ALLOW_WS.test(question)) {
    return invalid("`question` cannot contain control characters.", "question");
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return invalid(
      `\`question\` is too long (max ${MAX_QUESTION_CHARS} characters).`,
      "question",
    );
  }

  if (options.context === undefined) {
    return { ok: true, value: { question } };
  }

  if (!Array.isArray(options.context)) {
    return invalid(
      "`context` must be an array of prior conversation turns.",
      "context",
    );
  }
  if (options.context.length > MAX_CONTEXT_TURNS) {
    return invalid(
      `\`context\` has too many turns (max ${MAX_CONTEXT_TURNS}).`,
      "context",
    );
  }
  if (options.context.length % 2 !== 0) {
    return invalid(
      "`context` must be complete user/assistant pairs ending with an assistant turn.",
      "context",
    );
  }

  const context: ChatTurn[] = [];
  for (let i = 0; i < options.context.length; i++) {
    // Even index → user, odd → assistant; the even-length check above guarantees the
    // final turn is an assistant one, so `[...context, question]` ends on a user turn.
    const expectedRole: ChatRole = i % 2 === 0 ? "user" : "assistant";
    const parsed = parseTurn(options.context[i], i, expectedRole);
    if (!parsed.ok) return parsed;
    context.push(parsed.value);
  }

  return { ok: true, value: { question, context } };
}

/** A short, human description of a validated chat request, for the UI copy. */
export function describeChatRequest(options: ChatOptions): string {
  const turns = options.context?.length ?? 0;
  return turns > 0
    ? `Follow-up question with ${turns} prior turn${turns === 1 ? "" : "s"} of context`
    : "Ask a question about the PDF";
}

/** A sensible download name for the answer package, derived from the source PDF. */
export function chatAnswerOutputName(originalName: unknown): string {
  const tail = "-answer.zip";
  const budget = Math.max(1, MAX_DISPLAY_FILENAME_LENGTH - tail.length);
  const stem =
    sanitizeDisplayFilename(originalName)
      .replace(/\.[^.]+$/, "")
      .trim() || FALLBACK_STEM;
  return `${stem.length > budget ? stem.slice(0, budget).trim() : stem}${tail}`;
}

/**
 * The most one question may cost against the daily AI allowance — and the most
 * document text the worker will read for it. In WORKER-EXTRACTED characters,
 * the unit the allowance bucket is kept in.
 *
 * ── IT IS THE UNDECLARED RESERVATION, AND THAT IS THE WHOLE ARGUMENT ────────
 *
 * A job that declares nothing reserves `TRANSLATE_MAX_INPUT_CHARS × headroom`
 * (`api/jobs/route.ts`). Chat's own ceiling is that same product, so:
 *
 *  - **declaring never costs more than not declaring.** A 400,000-character PDF
 *    declared honestly reserves this, not `400,000 × 4` — which would be more
 *    than the whole daily bucket and would refuse the document on its first
 *    question, with a message saying the allowance was used up.
 *  - **no question costs more than a third of the day**, so three questions are
 *    the floor for every document, and a small one gets many more.
 *  - **the charge and the read are the same number.** Until 2026-09-27 a chat
 *    question was charged this while the engine read up to
 *    `AI_INPUT_LIMITS.maxInputCharacters` (500,000) — twelve times what was
 *    paid for. A reservation nothing enforces looks enforced, which is worse
 *    than none (`delivery-cap.ts`).
 *
 * DERIVED, never typed: if the per-call ceiling or the headroom moves, the
 * fallback moves, and this moves with it.
 */
export const CHAT_MAX_CHARACTERS_PER_QUESTION = Math.ceil(
  TRANSLATE_MAX_INPUT_CHARS * TRANSLATE_EXTRACTOR_HEADROOM,
);

/**
 * The characters of conversation one question sends the model: the question
 * itself plus every carried turn.
 *
 * ONE definition, used by the route that CHARGES for them and the worker that
 * SENDS them, so the two cannot count the same request differently. It counts
 * the VALIDATED options (trimmed by {@link parseChatOptions}), which is what
 * both ends hold.
 */
export function chatConversationCharacters(options: ChatOptions): number {
  let total = options.question.length;
  for (const turn of options.context ?? []) total += turn.content.length;
  return total;
}

/**
 * How a chat job's reservation differs from the shared formula
 * (`deliveryCapFor`): what the route adds, and where it stops.
 *
 * ── THE CONVERSATION IS CHARGED, AND CHARGED EXACTLY ────────────────────────
 *
 * The question and the carried turns are AI text the model reads on every
 * call, so they count. They are NOT multiplied by the extractor headroom: the
 * headroom exists because the browser and the worker extract a PDF
 * differently, and a string in the request body is counted identically at both
 * ends. Charging it ×4 would make a long conversation cost more than the
 * fallback — the defect this closes, one notch over.
 *
 * ── AND THE WHOLE RESERVATION IS CAPPED ─────────────────────────────────────
 *
 * At {@link CHAT_MAX_CHARACTERS_PER_QUESTION}. The worker reads the document up
 * to what remains after the conversation, so a capped reservation is also a
 * capped read.
 *
 * Options that do not parse add nothing: the worker refuses them before any
 * provider call, so there is no conversation to pay for.
 */
export function chatReservationTerms(options: unknown): {
  readonly exactCharacters: number;
  readonly maxCharacters: number;
} {
  const parsed = isObject(options) ? parseChatOptions(options) : null;
  return {
    exactCharacters:
      parsed && parsed.ok ? chatConversationCharacters(parsed.value) : 0,
    maxCharacters: CHAT_MAX_CHARACTERS_PER_QUESTION,
  };
}
