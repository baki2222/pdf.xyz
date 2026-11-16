/**
 * Lexical page retrieval for Chat with PDF (audit #30, chat-with-pdf#2,
 * slice 3). When a grounded document's page-labelled text does not fit one
 * question's document budget, the worker sends pages chosen for THIS
 * question instead of only the opening ones: an opening anchor, the pages the
 * previous answer cited, and the pages BM25 ranks highest for the question.
 *
 * Pure: no node, worker or React imports, no I/O, deterministic. It must not
 * reach the browser either (the bundle check greps `.next/static` for
 * {@link SEGMENTER_HEALTH_SAMPLE}), so nothing a `"use client"` module
 * imports may import this file. The page list it prints comes from
 * `./page-spans`, the leaf the browser-side notice shares.
 *
 * NEVER WORSE THAN THE PREFIX, by construction (brief D3): the result is
 * `"prefix"` (the caller sends exactly main's `slice(0, maxChars)`) whenever
 * the Segmenter is missing, no page scores and no cited page lies outside the
 * prefix window, no page carries more than {@link CHAT_RETRIEVAL_MIN_COVERAGE}
 * of the question's informative terms (and no cited page lies outside), or
 * every page the selection would send is a page the prefix window already
 * touches. Retrieval runs only when it adds a page main would
 * not have sent. `page-retrieval.eval.test.ts` holds that per case.
 */
import { CHAT_RETRIEVAL_ANCHOR_SHARE } from "./chat-retrieval-anchor";
import { formatPageSpans } from "./page-spans";

/**
 * The anchor share and the shares its sweep measures live in the leaf
 * `./chat-retrieval-anchor`, because the chat panel's gated line needs the
 * same number and this file must not reach the browser. Re-exported here so
 * the selector and its tests read it from one place.
 */
export {
  CHAT_RETRIEVAL_ANCHOR_SHARE,
  CHAT_RETRIEVAL_ANCHOR_SHARES,
} from "./chat-retrieval-anchor";

/**
 * The selector never starts a 65th span (brief D6): a page that would start
 * one is skipped. `buildAiResultMeta` re-bounds independently. The bound is
 * for the job record's size and the notice's readability; the read bound is
 * safe regardless, because the page list's length is paid out of the budget.
 */
export const CHAT_RETRIEVAL_MAX_SPANS = 64;

/** BM25 term-frequency saturation (brief D4). */
export const BM25_K1 = 1.2;
/** BM25 length normalisation (brief D4). */
export const BM25_B = 0.75;

/**
 * The share of the question's informative terms a page must carry, MORE than
 * which, before it may be chosen by relevance (a page the previous answer
 * cited needs none). Below it a page is a lexical false positive: one word of
 * a paraphrased question that happens to recur somewhere else. Such a page
 * would displace an opening page main's prefix sends, so it is never chosen,
 * and a question whose every match is that weak stays on main's prefix
 * (`reason: "low-coverage"`).
 *
 * Strictly more than half: with two informative terms a page needs both,
 * with three it needs two, with four it needs three. Not a taste either:
 * `page-retrieval.eval.test.ts` holds class C (early fact, asked in other
 * words) never below main, and sweeps this value beside the anchor share.
 */
export const CHAT_RETRIEVAL_MIN_COVERAGE = 1 / 2;

/**
 * A Latin and a Bengali word. Two jobs: the full-ICU health check in
 * {@link wordSegmenterAvailable} (a small-ICU build does not segment the
 * Bengali run as a word), and the marker the bundle check greps for, because
 * a string literal survives minification.
 */
const SEGMENTER_HEALTH_SAMPLE = "zqretrieval চুক্তির";

/** One page's chunk as the chat engine joins it: `[Page N]\n<trimmed text>`. */
export type PageChunk = { pageNumber: number; text: string };

/** Why the selector left the run on main's prefix. */
export type PrefixReason =
  | "ungrounded"
  | "no-segmenter"
  | "no-budget"
  | "no-signal"
  | "low-coverage"
  | "contained"
  | "over-budget";

export type PageSelection =
  | { strategy: "prefix"; reason: PrefixReason }
  | {
      strategy: "relevance";
      /** Ascending, unique, real page numbers (never index + 1). */
      pages: number[];
      /** The page whose chunk was cut; when set, the HIGHEST of `pages`. */
      cutPage: number | null;
      /** The cut chunk's length in characters, marker included. */
      cutLength: number | null;
      /** The last page of the unbroken run of opening chunks sent whole. */
      anchorThrough: number | null;
    };

export type SelectPagesInput = {
  chunks: readonly PageChunk[];
  question: string;
  lastUserTurn?: string;
  /** Pages the previous answer cited (`citedPagesIn`). */
  seedPages: readonly number[];
  /** Pages whose chunk starts inside main's prefix window. */
  prefixPages: ReadonlySet<number>;
  /** Characters available for the joined chunks, separators included. */
  budget: number;
  separator: string;
  /** Defaults to {@link CHAT_RETRIEVAL_ANCHOR_SHARE}; the sweep varies it. */
  anchorShare?: number;
  /** Defaults to {@link CHAT_RETRIEVAL_MIN_COVERAGE}; the sweep varies it. */
  minCoverage?: number;
  /** Precomputed {@link bm25Scores} for the same chunks and query. */
  scores?: ReadonlyMap<number, number>;
  /** Precomputed {@link queryCoverage} for the same chunks and query. */
  coverage?: ReadonlyMap<number, number>;
};

/**
 * The word segmenter, or null. Read on every call (only the instance is
 * reused), so a test that deletes `Intl.Segmenter` sees the deletion.
 */
let segmenterInstance: Intl.Segmenter | null = null;
function wordSegmenter(): Intl.Segmenter | null {
  if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function")
    return null;
  if (!(segmenterInstance instanceof Intl.Segmenter))
    segmenterInstance = new Intl.Segmenter(undefined, { granularity: "word" });
  return segmenterInstance;
}

/**
 * True when `Intl.Segmenter` exists AND segments a Latin + Bengali sample
 * into at least two word-like pieces (the full-ICU check).
 */
export function wordSegmenterAvailable(): boolean {
  try {
    const segmenter = wordSegmenter();
    if (!segmenter) return false;
    let words = 0;
    for (const piece of segmenter.segment(SEGMENTER_HEALTH_SAMPLE))
      if (piece.isWordLike) words += 1;
    return words >= 2;
  } catch {
    return false;
  }
}

/** NFKC, lower-cased, word-like segments only. Empty when no Segmenter. */
export function tokenize(text: string): string[] {
  const segmenter = wordSegmenter();
  if (!segmenter) return [];
  const terms: string[] = [];
  for (const piece of segmenter.segment(text.normalize("NFKC").toLowerCase()))
    if (piece.isWordLike) terms.push(piece.segment);
  return terms;
}

const PAGE_MARKER = /^\[Page \d+\]\n/;

/**
 * The page's text without its `[Page N]` marker line. Scoring the marker
 * would make the page NUMBER a term on exactly one page, so "the 12-month
 * penalty" would pull page 12 for a reason that has nothing to do with its
 * text (brief D4).
 */
function pageBody(text: string): string {
  return text.replace(PAGE_MARKER, "");
}

/**
 * BM25 and coverage from one pass over the page bodies: the score of every
 * page, and the share of the query's INFORMATIVE terms (distinct terms with
 * an IDF above 0) that occur on it. A term absent from the document, or on
 * more than half its pages, is not informative and counts on neither side.
 */
function scoreIndex(
  chunks: readonly PageChunk[],
  queryTerms: readonly string[],
): { scores: Map<number, number>; coverage: Map<number, number> } {
  const scores = new Map<number, number>();
  const matched = new Map<number, number>();
  for (const chunk of chunks) {
    scores.set(chunk.pageNumber, 0);
    matched.set(chunk.pageNumber, 0);
  }
  const coverageOf = (informative: number) =>
    new Map(
      [...matched].map(([page, hits]) => [
        page,
        informative === 0 ? 0 : hits / informative,
      ]),
    );
  const docs = chunks.map((chunk) => tokenize(pageBody(chunk.text)));
  const total = docs.reduce((sum, doc) => sum + doc.length, 0);
  if (chunks.length === 0 || total === 0)
    return { scores, coverage: coverageOf(0) };
  const average = total / docs.length;
  const frequencies = docs.map((doc) => {
    const counts = new Map<string, number>();
    for (const term of doc) counts.set(term, (counts.get(term) ?? 0) + 1);
    return counts;
  });
  const n = chunks.length;
  let informative = 0;
  for (const term of new Set(queryTerms)) {
    let df = 0;
    for (const counts of frequencies) if (counts.has(term)) df += 1;
    if (df === 0) continue;
    const idf = Math.max(0, Math.log((n - df + 0.5) / (df + 0.5)));
    if (idf === 0) continue;
    informative += 1;
    chunks.forEach((chunk, i) => {
      const tf = frequencies[i]!.get(term) ?? 0;
      if (tf === 0) return;
      const norm =
        BM25_K1 * (1 - BM25_B + (BM25_B * docs[i]!.length) / average);
      scores.set(
        chunk.pageNumber,
        scores.get(chunk.pageNumber)! +
          (idf * tf * (BM25_K1 + 1)) / (tf + norm),
      );
      matched.set(chunk.pageNumber, matched.get(chunk.pageNumber)! + 1);
    });
  }
  return { scores, coverage: coverageOf(informative) };
}

/**
 * BM25 over the page bodies, every page present in the result (0 when no
 * query term occurs on it). IDF is Robertson's, clamped at 0:
 * `max(0, ln((N − n + 0.5) / (n + 0.5)))`, so a term on more than half the
 * pages weighs nothing and "what / is / the" cannot lift every page above
 * zero, in any script, without a stopword list. Each distinct query term
 * counts once.
 */
export function bm25Scores(
  chunks: readonly PageChunk[],
  queryTerms: readonly string[],
): Map<number, number> {
  return scoreIndex(chunks, queryTerms).scores;
}

/**
 * The share (0..1) of the query's informative terms that occur on each page.
 * See {@link CHAT_RETRIEVAL_MIN_COVERAGE} for what it decides.
 */
export function queryCoverage(
  chunks: readonly PageChunk[],
  queryTerms: readonly string[],
): Map<number, number> {
  return scoreIndex(chunks, queryTerms).coverage;
}

/** The query: the question plus the last user turn. */
export function queryTermsFor(
  question: string,
  lastUserTurn?: string,
): string[] {
  return tokenize(
    lastUserTurn === undefined ? question : `${question}\n${lastUserTurn}`,
  );
}

/**
 * The pages to send for this question, or `"prefix"` when retrieval would
 * not add a page main's prefix lacks. Greedy and whole-page: the anchor
 * (opening chunks within `anchorShare × budget`), then the cited pages
 * ascending, then pages by score (ties to the lower page) among those that
 * carry more than `minCoverage` of the informative terms, then the opening
 * run continued with whatever budget is left. One page may be cut: the first
 * candidate, when no candidate fits whole and it would be the highest page
 * sent.
 */
export function selectPages(input: SelectPagesInput): PageSelection {
  const { chunks, prefixPages, budget, separator } = input;
  if (chunks.length === 0) return { strategy: "prefix", reason: "ungrounded" };
  if (!wordSegmenterAvailable())
    return { strategy: "prefix", reason: "no-segmenter" };
  if (!(budget > 0)) return { strategy: "prefix", reason: "no-budget" };

  const index =
    input.scores && input.coverage
      ? { scores: input.scores, coverage: input.coverage }
      : scoreIndex(chunks, queryTermsFor(input.question, input.lastUserTurn));
  const { scores, coverage } = index;
  const minCoverage = input.minCoverage ?? CHAT_RETRIEVAL_MIN_COVERAGE;
  const byPage = new Map(chunks.map((chunk) => [chunk.pageNumber, chunk]));
  const seeds = [...new Set(input.seedPages)]
    .filter((page) => byPage.has(page))
    .sort((a, b) => a - b);
  const scored = chunks
    .filter((chunk) => (scores.get(chunk.pageNumber) ?? 0) > 0)
    .sort(
      (a, b) =>
        scores.get(b.pageNumber)! - scores.get(a.pageNumber)! ||
        a.pageNumber - b.pageNumber,
    )
    .map((chunk) => chunk.pageNumber);
  if (scored.length === 0 && seeds.every((page) => prefixPages.has(page)))
    return { strategy: "prefix", reason: "no-signal" };
  // Only a page carrying more than `minCoverage` of the question's
  // informative terms may displace an opening page.
  const confident = scored.filter(
    (page) => (coverage.get(page) ?? 0) > minCoverage,
  );
  if (confident.length === 0 && seeds.every((page) => prefixPages.has(page)))
    return { strategy: "prefix", reason: "low-coverage" };

  const selected = new Map<number, string>();
  let used = 0;
  let spans = 0;
  const cost = (text: string) =>
    text.length + (selected.size > 0 ? separator.length : 0);
  const spansWith = (page: number) =>
    spans +
    1 -
    (selected.has(page - 1) ? 1 : 0) -
    (selected.has(page + 1) ? 1 : 0);
  const tryAdd = (page: number, limit: number): boolean => {
    if (selected.has(page)) return false;
    const text = byPage.get(page)!.text;
    const next = spansWith(page);
    if (used + cost(text) > limit || next > CHAT_RETRIEVAL_MAX_SPANS)
      return false;
    used += cost(text);
    spans = next;
    selected.set(page, text);
    return true;
  };

  // 1. The anchor: opening chunks, whole, within the reserved share.
  const share = input.anchorShare ?? CHAT_RETRIEVAL_ANCHOR_SHARE;
  const anchorBudget = Math.floor(share * budget);
  for (const chunk of chunks)
    if (!tryAdd(chunk.pageNumber, anchorBudget)) break;

  // 2. The candidates: cited pages, then pages by score.
  const candidates = [...new Set([...seeds, ...confident])];
  let candidateAdded = false;
  for (const page of candidates)
    if (tryAdd(page, budget)) candidateAdded = true;

  // 3. Nothing fit whole: cut the first candidate, if it would be the
  //    highest page sent (the notice says "the last of them cut mid-page").
  let cutPage: number | null = null;
  let cutLength: number | null = null;
  const first = candidates[0];
  if (!candidateAdded && first !== undefined && !selected.has(first)) {
    const highest = Math.max(0, ...selected.keys());
    const room = budget - used - (selected.size > 0 ? separator.length : 0);
    const marker = `[Page ${first}]\n`.length;
    if (
      first > highest &&
      room > marker &&
      spansWith(first) <= CHAT_RETRIEVAL_MAX_SPANS
    ) {
      const text = byPage.get(first)!.text.slice(0, room);
      spans = spansWith(first);
      used += cost(text);
      selected.set(first, text);
      cutPage = first;
      cutLength = text.length;
    }
  }

  // 4. Whatever is left continues the opening run (never past a cut page).
  if (cutPage === null)
    for (const chunk of chunks) {
      if (selected.has(chunk.pageNumber)) continue;
      if (!tryAdd(chunk.pageNumber, budget)) break;
    }

  const pages = [...selected.keys()].sort((a, b) => a - b);
  if (pages.every((page) => prefixPages.has(page)))
    return { strategy: "prefix", reason: "contained" };

  let anchorThrough: number | null = null;
  for (const chunk of chunks) {
    if (!selected.has(chunk.pageNumber) || chunk.pageNumber === cutPage) break;
    anchorThrough = chunk.pageNumber;
  }
  return { strategy: "relevance", pages, cutPage, cutLength, anchorThrough };
}

/** The pages whose chunk starts before `maxChars`: what main's prefix touches. */
export function prefixPagesFor(
  chunks: readonly PageChunk[],
  separator: string,
  maxChars: number,
): Set<number> {
  const pages = new Set<number>();
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= maxChars) break;
    pages.add(chunk.pageNumber);
    offset += chunk.text.length + separator.length;
  }
  return pages;
}

export type RetrievedGrounding =
  | { strategy: "whole"; grounding: string }
  | { strategy: "prefix"; reason: PrefixReason; grounding: string }
  | {
      strategy: "relevance";
      grounding: string;
      pages: number[];
      spans: [number, number][];
      cutPage: number | null;
      cutLength: number | null;
      anchorThrough: number | null;
      /** The characters the page list costs, paid out of `maxChars`. */
      listLength: number;
    };

export type RetrieveGroundingInput = Omit<
  SelectPagesInput,
  "prefixPages" | "budget" | "scores" | "coverage"
> & {
  maxChars: number;
  /**
   * The characters the notice will spend naming `pages`. Defaults to the
   * span text's length; the engine passes its own notice's page-list length.
   */
  listLength?: (pages: readonly number[], cutPage: number | null) => number;
  /** The selector; production callers never pass it (the proofs' seam). */
  select?: typeof selectPages;
};

/** The most passes the D5 fixed point may take before failing closed. */
const MAX_BUDGET_PASSES = 4;

/**
 * The grounding to send: the whole text when it fits, main's exact prefix
 * when retrieval cannot add a page, or the selected chunks in page order,
 * joined as the engine joins them. The page list L the notice prints is paid
 * out of the budget as a fixed point (select with L = 0, measure, reselect,
 * at most {@link MAX_BUDGET_PASSES} passes), then `grounding + L ≤ maxChars`
 * is ASSERTED, and a run that breaks it falls back to the prefix
 * (`reason: "over-budget"`, which the budget property test requires never to
 * happen: the fallback is a second bound, not the mechanism).
 */
export function retrieveGrounding(
  input: RetrieveGroundingInput,
): RetrievedGrounding {
  const { chunks, separator, maxChars } = input;
  const joined = chunks.map((chunk) => chunk.text).join(separator);
  if (joined.length <= maxChars)
    return { strategy: "whole", grounding: joined };
  const prefix = (reason: PrefixReason): RetrievedGrounding => ({
    strategy: "prefix",
    reason,
    grounding: joined.slice(0, maxChars),
  });
  const select = input.select ?? selectPages;
  const listLength =
    input.listLength ?? ((pages) => formatPageSpans(pages).text.length);
  const prefixPages = prefixPagesFor(chunks, separator, maxChars);
  const index = wordSegmenterAvailable()
    ? scoreIndex(chunks, queryTermsFor(input.question, input.lastUserTurn))
    : undefined;

  let listChars = 0;
  let measured = 0;
  let selection: PageSelection = { strategy: "prefix", reason: "ungrounded" };
  for (let pass = 0; pass < MAX_BUDGET_PASSES; pass += 1) {
    selection = select({
      chunks,
      question: input.question,
      ...(input.lastUserTurn !== undefined
        ? { lastUserTurn: input.lastUserTurn }
        : {}),
      seedPages: input.seedPages,
      prefixPages,
      budget: maxChars - listChars,
      separator,
      ...(input.anchorShare !== undefined
        ? { anchorShare: input.anchorShare }
        : {}),
      ...(input.minCoverage !== undefined
        ? { minCoverage: input.minCoverage }
        : {}),
      ...(index ? { scores: index.scores, coverage: index.coverage } : {}),
    });
    if (selection.strategy === "prefix") return prefix(selection.reason);
    measured = listLength(selection.pages, selection.cutPage);
    if (measured <= listChars) break;
    listChars = measured;
  }
  if (selection.strategy !== "relevance") return prefix(selection.reason);

  const chosen = selection;
  const byPage = new Map(chunks.map((chunk) => [chunk.pageNumber, chunk.text]));
  const grounding = chosen.pages
    .map((page) => {
      const text = byPage.get(page)!;
      return page === chosen.cutPage && chosen.cutLength !== null
        ? text.slice(0, chosen.cutLength)
        : text;
    })
    .join(separator);
  if (grounding.length + measured > maxChars) return prefix("over-budget");
  return {
    strategy: "relevance",
    grounding,
    pages: chosen.pages,
    spans: formatPageSpans(chosen.pages).spans,
    cutPage: chosen.cutPage,
    cutLength: chosen.cutLength,
    anchorThrough: chosen.anchorThrough,
    listLength: measured,
  };
}
