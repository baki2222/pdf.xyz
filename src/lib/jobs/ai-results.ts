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
 * The `ai` block of a completed job's results. Present on every completed
 * summarize / ai-extract / chat-with-pdf job — including untruncated ones, so a
 * missing block means "this worker did not report", not "nothing was cut".
 */
export interface AiResultMeta {
  truncation: AiWindowMeta;
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
