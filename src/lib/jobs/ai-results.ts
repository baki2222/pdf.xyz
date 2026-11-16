/**
 * Client-facing result metadata for the AI tools: **what the model actually saw**.
 *
 * Every AI tool caps the text it sends at `maxInputChars` and sends a prefix, or,
 * for chat, the pages chosen for the question (`selection: "relevance"`). The
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

import {
  TRANSLATE_PDF_REASONS,
  type TranslatePdfReason,
} from "./translate-pdf-render";

/** Bounded, content-free description of the window of text a model was given. */
export interface AiWindowMeta {
  /**
   * True when the source exceeded the cap and only part of it was sent: a
   * prefix, or for chat the pages chosen for the question.
   */
  truncated: boolean;
  /**
   * Characters of the source the window covers, in the extractor's calibrated
   * unit (the `-layout` text on the worker). Not a literal count of what the
   * model received: Translate never sends withheld or oversize pages, and
   * since reading order (2026-11-16) may send a page's flow text in place of
   * its `-layout` text. Translate's literal count is
   * {@link AiReadingOrderMeta.sentCharacters}. While the window is not
   * truncated, that count LESS the page markers it carries
   * ({@link AiPageMapMeta.markerCharacters}) is never larger than this
   * (`reading-order.results.test.ts`, `page-map.results.test.ts`). The
   * markers are literal characters in the `-layout` unit's place, so the
   * count itself may exceed this whenever flow and `-layout` are about the
   * same length. (True before translatePageMap (2026-11): the count itself
   * was never larger than this.)
   */
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
  /**
   * True when the cut landed inside a page rather than on a page boundary.
   * Under a selection, the page cut is the HIGHEST page in `pagesSent`.
   */
  cutMidPage: boolean;
  /**
   * Present ONLY on a chat run that sent pages chosen for the question rather
   * than a prefix (`page-retrieval.ts`). Absent on every whole or prefix
   * window, so those stay the six fields above and deep-equal to what a
   * worker without retrieval wrote. With it, `lastCompletePage` is `null`:
   * there is no prefix to name the end of.
   */
  selection?: "relevance";
  /**
   * The pages sent, as inclusive ascending disjoint `[first, last]` spans of
   * REAL page numbers. Two producers, told apart by `selection`:
   *
   *  - WITH `selection` (chat): the pages chosen for the question. Dropped by
   *    the writer when invalid or more than 64, in which case the notice says
   *    only that some pages were read, never a range.
   *  - WITHOUT it (Summarize's page range): the pages the PERSON chose whose
   *    text reached the model — the whole selection, or when truncated the
   *    selection clipped at the last page whose text started before the cut.
   *    Present on untruncated windows too. Canonical (non-adjacent) and inside
   *    the document, or DROPPED whole, never repaired: the panel compares it
   *    with what it sent (`./selection-echo`), and a missing echo reads as
   *    "not confirmed", which is true, where a repaired one would read as a
   *    confident page list nobody chose.
   *
   * Absent on every whole-document or prefix window, so those records stay
   * byte-identical to a worker's that predates both.
   */
  pagesSent?: readonly (readonly [number, number])[];
  /** How many pages were sent. Present only with `selection`. */
  pagesRead?: number;
}

/** The writer's bound on `pagesSent` (the selector's own is `CHAT_RETRIEVAL_MAX_SPANS`). */
export const AI_WINDOW_MAX_SPANS = 64;

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
  /**
   * Input tokens billed at the cache-WRITE rate. Priced at neither the fresh nor
   * the read rate (~1.25× vs ~0.1×), so it is its own field rather than folded
   * into either.
   *
   * Unread until 2026-08-11, and that was the whole document going missing:
   * Anthropic's `inputTokens` is the UNCACHED REMAINDER, and turn one of a
   * `cacheSystem` request writes the document into the cache. Measured through
   * the real adapter, a 50-page document persisted as 20 input tokens.
   */
  cacheWriteInputTokens?: number;
  /**
   * Provider calls this block sums. Always 1 today — every engine makes exactly
   * one call — and recorded anyway.
   *
   * Chunked translation makes it N, and that is the release where these numbers
   * start pricing the free tier. Without the count, a summed block is
   * indistinguishable from a single call, so a per-page figure measured before
   * chunking and one measured after would silently be different quantities. The
   * unit changes; this is what says so.
   */
  calls: number;
  /** Public model id the counts belong to. Never a secret. */
  model: string;
}

/**
 * The `ai` block of a completed job's results. Present on every completed
 * summarize / ai-extract / chat-with-pdf job — including untruncated ones, so a
 * missing block means "this worker did not report", not "nothing was cut".
 */
/**
 * What a job DELIVERED, when it delivered less than the document held.
 *
 * ── ABSENT MEANS DELIVERED IN FULL, AND THAT IS THE DISCRIMINANT ────────────
 *
 * There is deliberately no `partial: false` state. A block saying
 * `withheldPages: 0` would be a partial-delivery report about a complete
 * delivery — a confident sentence about nothing, which is the shape
 * `buildAiResultMeta` already refuses for the truncation window. Absent is the
 * whole-document case; present means pages were withheld and names how many.
 *
 * ── WHY THE JOB RECORD HAS TO CARRY IT ──────────────────────────────────────
 *
 * The gap is already inside `translation.md`, positioned where the pages were,
 * so a reader who opens the artifact meets it. But the SCREEN said "completed"
 * — true in the narrow sense that the job finished, while the thing the user
 * asked for was not delivered and their allowance was spent on it. That is
 * this product's signature defect wearing its usual clothes, and a surface may
 * not assert something the system contradicts.
 */
export interface AiDeliveryMeta {
  /** Pages actually translated. */
  deliveredPages: number;
  /** Pages the job's own reservation would not cover. Always ≥ 1 when present. */
  withheldPages: number;
  /**
   * Which bound stopped it. The two lead to different actions — an exhausted
   * reservation is "translate the rest separately", a page bound is "the
   * document is not what was declared" — so collapsing them would leave a
   * reader with a number and nothing to do about it.
   */
  boundBy: "characters" | "pages";
}

/**
 * What became of Translate PDF's reflowed PDF (2026-11-15). Present on every
 * translation a worker new enough to print one completes; absent on every
 * other job, and on a translation from an older image (which read as "no
 * PDF", because there is none). `rendered: false` names its reason, so the
 * panel can say the PDF could not be drawn rather than say nothing.
 */
export interface AiPdfMeta {
  rendered: boolean;
  reason?: TranslatePdfReason;
  pages?: number;
  bytes?: number;
}

const PDF_REASONS: ReadonlySet<string> = new Set(TRANSLATE_PDF_REASONS);

/**
 * Which text Translate SENT for each page (2026-11-16, reading order): the
 * page's flow text (`-bbox-layout`, column by column) or its `-layout` text,
 * and how many characters went to the model. Bounded integers and one closed
 * reason — never document text.
 *
 * ABSENT on every job a worker older than reading order ran, and on every
 * other tool's job. Never defaulted: a `{source: "not_run"}` invented for a
 * job the old worker ran would be a claim about work nobody did.
 */
export interface AiReadingOrderMeta {
  /**
   * `flow`: flow text was read and paired page by page (each page still
   * gated); `bbox_failed`: the flow run failed and every page went as
   * `-layout`; `page_count`: the two runs disagreed on the page count, so no
   * page carried flow; `not_run`: no flow run was made.
   */
  source: "flow" | "bbox_failed" | "page_count" | "not_run";
  /**
   * Text pages SENT as flow: pages whose segment was put on the wire (the
   * failing call of an interruption included, as `sentCharacters` counts
   * it). Withheld, oversize and post-interruption pages are not counted.
   */
  flowPages: number;
  /** Text pages SENT as `-layout`, by the same rule. */
  layoutPages: number;
  /** Of the sent `-layout` pages, those that had flow text and fell back, by first failing gate. */
  fellBack: { ink: number; longer: number; rtl: number };
  /** Characters literally sent between the prompt's delimiters, over the calls made. */
  sentCharacters: number;
}

const READING_ORDER_SOURCES: ReadonlySet<string> = new Set([
  "flow",
  "bbox_failed",
  "page_count",
  "not_run",
] satisfies AiReadingOrderMeta["source"][]);

/**
 * Re-bound an untrusted `readingOrder` block, STRICTLY: anything without a
 * known `source` and a `fellBack` object is dropped whole, never repaired
 * into a default. Counts are clamped to bounded non-negative integers.
 */
function boundReadingOrder(raw: unknown): AiReadingOrderMeta | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.source !== "string" || !READING_ORDER_SOURCES.has(r.source))
    return undefined;
  const fell = r.fellBack;
  if (typeof fell !== "object" || fell === null) return undefined;
  const f = fell as Record<string, unknown>;
  return {
    source: r.source as AiReadingOrderMeta["source"],
    flowPages: count(r.flowPages),
    layoutPages: count(r.layoutPages),
    fellBack: { ink: count(f.ink), longer: count(f.longer), rtl: count(f.rtl) },
    sentCharacters: count(r.sentCharacters),
  };
}

/**
 * How Translate's multi-page calls were labelled page by page (2026-11, page
 * markers, `@/lib/workers/translate/page-map`). Bounded integers over the
 * calls ACTUALLY MADE (the same rule as {@link AiReadingOrderMeta}'s page
 * counts) — never document text. Two invariants hold on every record:
 *
 *  - `marked + fellBack.collision + fellBack.budget === multiPageChunks`;
 *  - `verified + fellBack.missing + fellBack.order + fellBack.empty +
 *    unanswered === marked`.
 *
 * ABSENT on every job a worker older than page markers ran, and on every
 * other tool's job. Never defaulted (the reading-order deploy-skew rule).
 */
export interface AiPageMapMeta {
  /** Calls sent with at least two pages. */
  multiPageChunks: number;
  /** Of those, the ones sent with page markers between their pages. */
  marked: number;
  /** Marked calls whose reply carried every marker back, in order, with no empty page. */
  verified: number;
  /**
   * Marked calls that failed, or whose reply was empty once the markers were
   * removed (a reply of nothing but markers is unanswered, not `empty`).
   */
  unanswered: number;
  /**
   * Why a multi-page call carried no page labels. `collision`, `budget`: it
   * was sent unmarked (the document or the instructions held the marker's
   * brand; the reservation's slack could not pay for the markers). `missing`,
   * `order`, `empty`: it was marked and the reply did not verify (markers
   * dropped or glued into a sentence; out of order, duplicated or extra;
   * pages merged across a marker). Each such call is headed by its range.
   */
  fellBack: {
    collision: number;
    budget: number;
    missing: number;
    order: number;
    empty: number;
  };
  /** Σ `separatorOverhead` over the marked boundaries literally sent. */
  markerCharacters: number;
}

const PAGE_MAP_COUNTS = [
  "multiPageChunks",
  "marked",
  "verified",
  "unanswered",
  "markerCharacters",
] as const;
const PAGE_MAP_FELL_BACK = [
  "collision",
  "budget",
  "missing",
  "order",
  "empty",
] as const;

/**
 * Re-bound an untrusted `pageMap` block, STRICTLY: every count must be a
 * finite number (a missing or non-numeric field drops the block whole, never
 * repaired into a 0), negatives and fractions are clamped, and a block whose
 * counts then break either invariant is dropped whole — a page map that does
 * not add up is not a claim about anything.
 */
function boundPageMap(raw: unknown): AiPageMapMeta | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const fell = r.fellBack;
  if (typeof fell !== "object" || fell === null) return undefined;
  const f = fell as Record<string, unknown>;
  const finite = (v: unknown): boolean =>
    typeof v === "number" && Number.isFinite(v);
  if (!PAGE_MAP_COUNTS.every((k) => finite(r[k]))) return undefined;
  if (!PAGE_MAP_FELL_BACK.every((k) => finite(f[k]))) return undefined;
  const map: AiPageMapMeta = {
    multiPageChunks: count(r.multiPageChunks),
    marked: count(r.marked),
    verified: count(r.verified),
    unanswered: count(r.unanswered),
    fellBack: {
      collision: count(f.collision),
      budget: count(f.budget),
      missing: count(f.missing),
      order: count(f.order),
      empty: count(f.empty),
    },
    markerCharacters: count(r.markerCharacters),
  };
  const b = map.fellBack;
  if (map.marked + b.collision + b.budget !== map.multiPageChunks)
    return undefined;
  if (
    map.verified + b.missing + b.order + b.empty + map.unanswered !==
    map.marked
  )
    return undefined;
  return map;
}

/** Re-bound an untrusted `pdf` block; anything that is not one is dropped. */
function boundPdf(raw: unknown): AiPdfMeta | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.rendered !== "boolean") return undefined;
  if (r.rendered) {
    return {
      rendered: true,
      ...(r.pages !== undefined ? { pages: count(r.pages) } : {}),
      ...(r.bytes !== undefined ? { bytes: count(r.bytes) } : {}),
    };
  }
  return {
    rendered: false,
    ...(typeof r.reason === "string" && PDF_REASONS.has(r.reason)
      ? { reason: r.reason as TranslatePdfReason }
      : {}),
  };
}

export interface AiResultMeta {
  truncation: AiWindowMeta;
  /** Translate PDF only: the reflowed PDF's outcome. See {@link AiPdfMeta}. */
  pdf?: AiPdfMeta;
  /** Translate PDF only: which text was sent. See {@link AiReadingOrderMeta}. */
  readingOrder?: AiReadingOrderMeta;
  /** Translate PDF only: how multi-page calls were labelled. See {@link AiPageMapMeta}. */
  pageMap?: AiPageMapMeta;
  /**
   * Present ONLY when pages were withheld. See {@link AiDeliveryMeta}: absent
   * is "delivered in full", and there is no third state.
   */
  delivery?: AiDeliveryMeta;
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
 *    `null`;
 *  - a relevance window (see {@link boundSelection}) keeps `selection` only
 *    when truncated, forces `lastCompletePage` to `null`, and keeps a page
 *    list only when every span is a real range inside the document;
 *  - a window WITHOUT `selection` keeps `pagesSent` (the pages a person chose,
 *    see {@link boundChosenPages}) only when it is already canonical and
 *    inside the document, truncated or not, and otherwise drops it whole.
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

  const selection = truncated ? boundSelection(w, totalPages) : null;
  const chosen =
    w.selection === undefined
      ? boundChosenPages(w.pagesSent, totalPages, truncated, last)
      : undefined;
  const used = boundUsage(raw.usage);
  const pdf = boundPdf(raw.pdf);
  const readingOrder = boundReadingOrder(raw.readingOrder);
  const pageMap = boundPageMap(raw.pageMap);
  /**
   * Re-bound, and DROPPED unless it reports a real withholding.
   *
   * A block that survived with `withheldPages: 0` would render as "delivered in
   * part" over a complete delivery — the same confident-sentence-about-nothing
   * the truncation invariants above exist to prevent. `boundBy` is closed to
   * the two values the engine can produce, so a corrupted or newer record
   * cannot widen the vocabulary a UI switches on.
   */
  const rawDelivery = raw.delivery;
  const withheldPages = count(rawDelivery?.withheldPages);
  const delivery =
    rawDelivery &&
    withheldPages > 0 &&
    (rawDelivery.boundBy === "characters" || rawDelivery.boundBy === "pages")
      ? {
          deliveredPages: count(rawDelivery.deliveredPages),
          withheldPages,
          boundBy: rawDelivery.boundBy,
        }
      : undefined;

  return {
    truncation: {
      truncated,
      charactersSent: truncated
        ? Math.min(count(w.charactersSent), charactersTotal)
        : charactersTotal,
      charactersTotal,
      totalPages,
      lastCompletePage: selection
        ? null
        : truncated
          ? last
          : totalPages || null,
      cutMidPage: truncated && w.cutMidPage === true,
      // Conditional spreads, so a whole or prefix window stays exactly the six
      // fields above (deep-equal to a pre-retrieval worker's record).
      ...(selection ? { selection: "relevance" as const } : {}),
      ...(selection?.pagesSent ? { pagesSent: selection.pagesSent } : {}),
      ...(chosen ? { pagesSent: chosen } : {}),
      ...(selection && selection.pagesRead !== undefined
        ? { pagesRead: selection.pagesRead }
        : {}),
    },
    ...(used ? { usage: used } : {}),
    ...(delivery ? { delivery } : {}),
    ...(pdf ? { pdf } : {}),
    ...(readingOrder ? { readingOrder } : {}),
    ...(pageMap ? { pageMap } : {}),
  };
}

/**
 * Re-bound a relevance window's page fields, or `null` when it is not one.
 *
 * The SECOND bound on the page list (the selector never starts a 65th span;
 * this does not trust that). Every span must be a pair of integers with
 * `first ≤ last`; each is clamped to `1..totalPages`, and one that lies
 * wholly outside the document voids the list. Spans are then sorted and
 * merged (overlapping or adjacent), and more than {@link AI_WINDOW_MAX_SPANS}
 * voids the list. A voided list keeps `selection`, so the reader gets "only
 * some of its N pages were read" rather than a range nobody sent.
 * `pagesRead` is clamped to the document and to the pages the list covers.
 */
function boundSelection(
  w: AiWindowMeta,
  totalPages: number,
): {
  pagesSent?: [number, number][];
  pagesRead?: number;
} | null {
  if (w.selection !== "relevance") return null;
  const spans = boundSpans(w.pagesSent, totalPages);
  const covered = spans?.reduce((sum, [a, b]) => sum + b - a + 1, 0);
  const pagesRead =
    w.pagesRead !== undefined
      ? Math.min(count(w.pagesRead), totalPages, covered ?? totalPages)
      : undefined;
  return {
    ...(spans ? { pagesSent: spans } : {}),
    ...(pagesRead !== undefined ? { pagesRead } : {}),
  };
}

/**
 * Re-bound the pages a person chose (Summarize's page range), or `undefined`
 * to drop them. Unlike {@link boundSpans} this REPAIRS NOTHING: the list must
 * already be canonical — 1 to {@link CHOSEN_MAX_SPANS} pairs of integers,
 * `1 ≤ first ≤ last ≤ totalPages`, ascending, disjoint and non-adjacent —
 * because the panel deep-compares it with what it sent, and a clamped or
 * merged echo would be a page list the worker never wrote.
 *
 * A local loop rather than `parsePageSpansOption`: this module ships to the
 * browser (`delivery-notice.tsx`), and that parser would bring `./responses`
 * with it. `page-spans-option.test.ts` holds the two to one verdict, the
 * span limit included.
 *
 * Truncated, the clip must reach at least `lastCompletePage` (when known):
 * a clip ending before the last page read in full contradicts the record.
 */
/**
 * A chosen selection's span limit: `MAX_PAGE_SPANS` (`./page-spans-option`),
 * restated rather than imported for the reason above. The echo is the
 * selection or a clip of it, so it never has more spans than the request.
 */
const CHOSEN_MAX_SPANS = 20;

function boundChosenPages(
  raw: unknown,
  totalPages: number,
  truncated: boolean,
  lastCompletePage: number | null,
): [number, number][] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  if (raw.length > CHOSEN_MAX_SPANS || totalPages < 1) return undefined;
  const spans: [number, number][] = [];
  for (const span of raw as unknown[]) {
    if (!Array.isArray(span) || span.length !== 2) return undefined;
    const [first, last] = span as unknown[];
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last))
      return undefined;
    const a = first as number;
    const b = last as number;
    if (a < 1 || a > b || b > totalPages) return undefined;
    const prev = spans[spans.length - 1];
    if (prev && a <= prev[1] + 1) return undefined;
    spans.push([a, b]);
  }
  if (
    truncated &&
    lastCompletePage !== null &&
    spans[spans.length - 1]![1] < lastCompletePage
  )
    return undefined;
  return spans;
}

function boundSpans(
  raw: unknown,
  totalPages: number,
): [number, number][] | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || totalPages < 1)
    return undefined;
  const clamped: [number, number][] = [];
  for (const span of raw as unknown[]) {
    if (!Array.isArray(span) || span.length !== 2) return undefined;
    const [first, last] = span as unknown[];
    if (!Number.isInteger(first) || !Number.isInteger(last)) return undefined;
    if ((first as number) > (last as number)) return undefined;
    const a = Math.max(1, first as number);
    const b = Math.min(totalPages, last as number);
    if (a > b) return undefined;
    clamped.push([a, b]);
  }
  clamped.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const merged: [number, number][] = [];
  for (const [a, b] of clamped) {
    const prev = merged[merged.length - 1];
    if (prev && a <= prev[1] + 1) prev[1] = Math.max(prev[1], b);
    else merged.push([a, b]);
  }
  return merged.length <= AI_WINDOW_MAX_SPANS ? merged : undefined;
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

  const reported = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value);

  return {
    inputTokens: count(raw.inputTokens),
    outputTokens: count(raw.outputTokens),
    // Preserved only when the provider actually reported them: `undefined` means
    // "not reported" and 0 means "reported none", and collapsing them would
    // silently price a cache miss as a cache hit — or, for the write side, price
    // a whole cached document as nothing.
    ...(reported(raw.cachedInputTokens)
      ? { cachedInputTokens: count(raw.cachedInputTokens) }
      : {}),
    ...(reported(raw.cacheWriteInputTokens)
      ? { cacheWriteInputTokens: count(raw.cacheWriteInputTokens) }
      : {}),
    // At least one: a usage block that survived to here describes a call that
    // happened, and "0 calls" beside real token counts is not a fact any caller
    // can act on.
    calls: Math.max(1, count(raw.calls)),
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
