/**
 * Client-facing result metadata for the AI tools: **what the model actually saw**.
 *
 * Every AI tool caps the text it sends at `maxInputChars` and sends a prefix. The
 * cap is not exotic — a dense 81-page contract already hits it (measured
 * 2026-08-10; see `@/lib/workers/ai/truncation`). Until this block existed the
 * fact reached nobody: the model was not told, so it answered "the document does
 * not state this" about a document that does; and the user was not told, so a
 * summary of the first 131 pages read as a summary of all 400.
 *
 * This is the seam that carries the fact to the browser. It is a set of bounded
 * COUNTS and one boolean — never a sentence, never document text. The wording the
 * user reads is composed on the client from these numbers by
 * `userTruncationNotice`, so the disclosure has exactly one author and cannot
 * drift between the panel, the packaged manifest, and the model's prompt.
 */

/** Bounded, content-free description of the window of text a model was given. */
export interface AiWindowMeta {
  /** True when the source exceeded the cap and only a prefix was sent. */
  truncated: boolean;
  /** Characters actually sent to the model. */
  charactersSent: number;
  /** Characters the extracted document text holds in total. */
  charactersTotal: number;
  /** Pages in the source document. */
  totalPages: number;
  /**
   * The last page the window covers IN FULL — the number a user can act on.
   * `null` when the cut fell inside the first page, or when there was no
   * per-page text to reason from. Never a guess: an off-by-one here is a new
   * confident false claim replacing the old one.
   */
  lastCompletePage: number | null;
  /** True when the cut landed inside a page rather than on a page boundary. */
  cutMidPage: boolean;
}

/**
 * What the call cost, as the provider reported it.
 *
 * Recorded because the free allowance is moving from RUNS to PAGES, and that
 * number cannot be set without knowing what a page actually costs. Until now the
 * counts existed for the length of one function call and were thrown away:
 * `AiCompletionSuccess.usage` is populated by both providers and read by exactly
 * one caller, `chat-with-pdf`, which writes it into its download manifest. So the
 * measurement was available at every call and survived nowhere queryable.
 *
 * Token counts are SIZE metadata, not content — they say how much text there
 * was, which the file size and page count already imply. No document text, no
 * prompt, no answer.
 *
 * `model` is not decoration: a token count without the model it belongs to is
 * unpriceable, and providers charge different rates per model and per token
 * class. A block that loses its model is dropped rather than persisted, so a
 * future per-page costing never averages in a row it cannot attribute.
 *
 * NAMING, because there are now two vocabularies for one quantity: the
 * `pdfxyz.chat/v1` manifest calls these `input` / `output` / `cachedInput`. That
 * schema has shipped, so it is not renamed here; these are the same numbers.
 */
export interface AiUsageMeta {
  inputTokens: number;
  outputTokens: number;
  /**
   * Provider-reported cached input tokens, when reported at all.
   *
   * Kept separate rather than folded into `inputTokens` because it is priced
   * differently — materially so with both providers — and a costing that treats
   * a cached token as a fresh one overstates. Absent means "not reported",
   * never "zero cached".
   */
  cachedInputTokens?: number;
  /** Public model id the counts belong to. Never a secret. */
  model: string;
}

/**
 * The `ai` block of a completed job's results. Present on every completed
 * summarize / ai-extract / chat-with-pdf job — including untruncated ones, so a
 * missing block means "this worker did not report", not "nothing was cut".
 */
export interface AiResultMeta {
  truncation: AiWindowMeta;
  /**
   * Omitted when the provider did not report usage — which both providers do by
   * omission rather than by zeroes. An absent block means "not reported"; a
   * present one with zeroes would mean "reported as free", and those must not
   * collapse into each other.
   */
  usage?: AiUsageMeta;
}

/** Clamp to a bounded non-negative integer; anything unusable becomes 0. */
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, Math.floor(value)), Number.MAX_SAFE_INTEGER);
}

/**
 * Re-bound an untrusted AI result block for persistence.
 *
 * Beyond clamping, it enforces the two invariants that make the block readable as
 * a single claim rather than a set of independent fields — a payload that says
 * "not truncated" beside "cut mid-page", or names a last-complete page beyond the
 * document's own length, would render as a confident sentence about nothing:
 *
 *  - `truncated:false` forces `cutMidPage:false` and `charactersSent ===
 *    charactersTotal`;
 *  - `lastCompletePage` is a positive integer no greater than `totalPages`, or
 *    `null`.
 */
export function buildAiResultMeta(raw: AiResultMeta): AiResultMeta {
  const w = raw.truncation;
  const truncated = w.truncated === true;
  const charactersTotal = count(w.charactersTotal);
  const totalPages = count(w.totalPages);

  const rawLast = w.lastCompletePage;
  const last =
    typeof rawLast === "number" && Number.isFinite(rawLast) && rawLast >= 1
      ? Math.min(Math.floor(rawLast), totalPages || Math.floor(rawLast))
      : null;

  const used = boundUsage(raw.usage);

  return {
    truncation: {
      truncated,
      charactersSent: truncated
        ? Math.min(count(w.charactersSent), charactersTotal)
        : charactersTotal,
      charactersTotal,
      totalPages,
      lastCompletePage: truncated ? last : totalPages || null,
      cutMidPage: truncated && w.cutMidPage === true,
    },
    ...(used ? { usage: used } : {}),
  };
}

/** Model ids are short; this bounds an untrusted string at the seam. */
const MAX_MODEL_ID = 100;

/**
 * Re-bound an untrusted usage block, or drop it.
 *
 * Dropped rather than repaired when the model is missing or unusable, because a
 * token count nobody can attribute to a model is not a cheap measurement — it is
 * a row that will be averaged into a per-page price and quietly move it. Absent
 * is recoverable; wrong is not.
 */
function boundUsage(raw: AiUsageMeta | undefined): AiUsageMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const model =
    typeof raw.model === "string"
      ? raw.model.trim().slice(0, MAX_MODEL_ID)
      : "";
  if (model.length === 0) return null;

  const cached = raw.cachedInputTokens;
  return {
    inputTokens: count(raw.inputTokens),
    outputTokens: count(raw.outputTokens),
    // Preserved only when the provider actually reported it: `undefined` means
    // "not reported" and 0 means "reported none", and collapsing them would
    // silently price a cache miss as a cache hit.
    ...(typeof cached === "number" && Number.isFinite(cached)
      ? { cachedInputTokens: count(cached) }
      : {}),
    model,
  };
}

/** True when a value plausibly came from the real AI window contract. */
export function isAiWindowMeta(value: unknown): value is AiWindowMeta {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as AiWindowMeta).truncated === "boolean"
  );
}
