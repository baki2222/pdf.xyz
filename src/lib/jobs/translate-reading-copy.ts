/**
 * What Translate PDF's static copy says about COLUMN ORDER and PAGE HEADINGS
 * (competitor audit #29, slice 5, 2026-11-16). One definition: the tool page
 * and the guide both take these sentences from here, never retype them.
 *
 * ── WHAT EACH SENTENCE RESTS ON ─────────────────────────────────────────────
 *
 *  - {@link TRANSLATE_COLUMN_ORDER}: the worker's reading order
 *    (`src/lib/workers/translate/reading-order.ts`). A page is SENT as its
 *    flow text (poppler's own order, column by column on an ordinary
 *    two-column page) only where that text carries the same ink as the
 *    `-layout` text, is no longer, and holds no right-to-left script; and
 *    only when the flow run succeeded and its page count matched. Every
 *    other page goes as `-layout`, line by line across the columns.
 *    NOTHING CHECKS COLUMN ORDER: the ink gate is order-blind by design
 *    (reading-order.ts, gate (a)), and every fallback reason
 *    (`AiReadingOrderMeta`: ink, longer, rtl, bbox_failed, page_count) is a
 *    loss, a length, a script or a failed run. So the sentence claims no
 *    check and names no cause for the fallback beyond the one a reader can
 *    predict (a right-to-left page always falls back). It says "usually"
 *    and keeps the line-by-line clause for as long as any fallback reason
 *    exists. Was, until 2026-11-16 review: "When our server cannot confirm a
 *    page's column order, it reads that page line by line" — a check that
 *    does not exist, and the wrong cause for the fallback.
 *  - {@link TRANSLATE_PAGE_HEADINGS}: the worker's page markers
 *    (`src/lib/workers/translate/page-map.ts`). A multi-page call whose reply
 *    carries every marker back, in order, is split and each piece printed
 *    under "Page N"; otherwise the call falls back to one range heading,
 *    "Pages a–b" (`pageRangeLabel` in `translate/typeset.ts`). THREE
 *    causes lead there, and only one is the model's: the reply lost or
 *    reordered a marker; the text already holds the marker token
 *    (`markerFallback: "collision"`, chunking.ts), so no marker is sent; or
 *    the markers do not fit what is left of the day's allowance
 *    (`markerFallback: "budget"`), so none is sent. A call is bounded by
 *    characters, not pages, so "several" can be dozens of sparse pages. The
 *    sentence therefore states the OUTCOME ("cannot tell where each page's
 *    translation starts"), not a cause. Was, until 2026-11-16 review: "when
 *    the AI model keeps the page breaks. When it does not, a few pages share
 *    one heading" — false wherever no marker was sent. Verified markers do
 *    not prove each piece holds only its own page's words (a sentence
 *    finished across the break), so the sentence says so instead of
 *    promising exact boundaries. The ZIP carries no markers and is not
 *    described here.
 *
 * ── THE LIVE BOUND, STATED HONESTLY ─────────────────────────────────────────
 *
 * The web tier deploys on merge; the worker image is rebuilt by hand, so these
 * sentences can be read beside an image that lacks either behaviour. What
 * watches that is the INTERNAL heartbeat: the worker publishes
 * `translateReadingOrder` and `translatePageMap` only after its own container
 * proofs pass (`reading-order-capability.ts`, `page-map-capability.ts`, also
 * run by CI against the built image), and the operations snapshot and the
 * capability-gap alert read those keys, whose promises
 * (`observability/snapshot.ts`) name these sentences. The PUBLIC
 * `/api/worker/status` does NOT expose either key, so no browser-side check
 * reads them and the panel does not change with them. Observed true in
 * production on 2026-11-16, with one real two-column job and one real
 * three-page job decoded (`.claude/prove-translate-reading-order.ts`,
 * `.claude/prove-translate-page-map.ts`).
 *
 * Guarded by `translate-reading-order-copy.test.ts` (required claims, fallback
 * clause, ban corpus for the retired interleave admission) and the
 * `translateReadingOrder` / `translatePageMap` subjects in
 * `capability-hedges.test.ts`.
 *
 * Pure strings: safe for any bundle.
 */

/** How a two-column page is read, with the fallback a reader must know. */
export const TRANSLATE_COLUMN_ORDER =
  "A two-column page is usually read column by column. Some pages are read line by line across the columns instead, and their lines can come out mixed. A page with any right-to-left text, such as Arabic, is always read that way. So compare the order with the original before you rely on it.";

/** How the translated PDF heads each page, as decided per job. */
export const TRANSLATE_PAGE_HEADINGS =
  "In the PDF, each page's translation usually comes under its own heading, such as Page 2. When our server cannot tell where each page's translation starts, several pages share one heading, such as Pages 1\u20133. A sentence that runs over a page break can land under either heading.";
