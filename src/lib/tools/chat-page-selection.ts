/**
 * What Chat with PDF's STATIC copy says about how a longer file's pages are
 * chosen (audit #30, chat-with-pdf#2, slice 4): one clause, spread to the
 * tool page's intro and FAQ, the tool-facts answer and the chat guide.
 *
 * ── WHY STATIC COPY MAY SAY IT NOW ──────────────────────────────────────────
 *
 * Slice 3 banned this from static copy, because the web tier auto-deploys
 * and the worker image is built by hand: a static page could be served
 * beside an image that reads only the opening pages. Its exit condition was
 * the PROPERTY "the image serving production chooses pages by the
 * question", observed on the wire, and it held on 2026-11-16: production's
 * `/api/worker/status` published `chatRetrieval: true`, and one real
 * question through the live page (a 70-page document, the fact on page 60)
 * came back with `selection: "relevance"` and page 60 read.
 *
 * ── THE SECOND BOUND (house rule 5) ─────────────────────────────────────────
 *
 * What can make this claim stale is a FUTURE worker image without the
 * behaviour. The heartbeat key {@link CHAT_PAGE_SELECTION_CAPABILITY} is the
 * boolean a worker publishes only after proving page selection on its own
 * pdftotext. What each check here does and does NOT cover:
 *
 *  - `src/lib/tools/capability-hedges.test.ts`, "the static page-selection
 *    claim is a member of its capability's subject": every served sentence
 *    carrying this clause is matched by the `chatRetrieval` subject, so the
 *    claim is read as a claim ABOUT that key. It checks the key against
 *    `WIRE_KEYS`, which is derived from this tree's source, not read from
 *    the production wire: it ties the copy to the key's NAME, and says
 *    nothing about what the running image publishes.
 *  - `src/deploy/worker-chat-retrieval-proof.test.ts`: CI's container step
 *    `worker:chat-retrieval-proof` runs that same proof inside an image CI
 *    BUILDS and fails the build unless it passes. It covers built images
 *    only; the worker image is built and deployed by hand, so an image that
 *    never went through CI, or an older one left running, is outside it.
 *
 * The LIVE bound is therefore an operator check, not a repo test: the deploy
 * verification reads production `/api/worker/status` and fails when
 * `chatRetrieval` is not `true`. It lives in the operator's verify script,
 * outside this repository, so no test here can fail when it is skipped.
 *
 * A boolean has no list to derive copy from (contrast Translate's
 * `TRANSLATE_PDF_CI_REQUIRED`, which the copy counts), so the honest
 * equivalent in the repo is the tie above: the copy names the key, and the
 * key is what a CI-built image must prove.
 *
 * ── WHAT IT MAY NOT SAY ─────────────────────────────────────────────────────
 *
 * No anchor share, no coverage threshold and no page count: those are the
 * selector's tuning, measured by its own eval and free to move. "the opening
 * pages and" is chosen from the measured share, as the panel's line is
 * (`chatRetrievalPanelLine`), because it is true only while some budget is
 * reserved for them. Never "every page" and never that the right page is
 * always found: matching is by words, and the copy beside this clause says so.
 * The overclaim shapes and the required row live in `./chat-retrieval-claims`.
 */
import { CHAT_RETRIEVAL_ANCHOR_SHARE } from "@/lib/pdf/chat-retrieval-anchor";
import type { HeartbeatCapabilities } from "@/lib/workers/heartbeat/types";

/** The heartbeat key the static page-selection claim is ABOUT. */
export const CHAT_PAGE_SELECTION_CAPABILITY =
  "chatRetrieval" satisfies keyof HeartbeatCapabilities;

/**
 * Which pages a longer file's question is sent, as a noun phrase:
 * "each question is sent {this}".
 *
 * CONDITIONAL on purpose. The selector sends ONLY the opening pages when no
 * page shares enough of the question's informative words: the coverage gate
 * (`CHAT_RETRIEVAL_MIN_COVERAGE`, reason "low-coverage") and the no-signal
 * fallback in `selectPages` (`src/lib/pdf/page-retrieval.ts`). Until review
 * (2026-11-16) this said "the opening pages and the pages that share the
 * most of …", which was false in exactly those states; that wording is kept
 * in `CHAT_PAGE_SELECTION_UNCONDITIONAL` (`./chat-retrieval-claims`).
 */
export function chatPageSelection(anchorShare: number): string {
  return anchorShare > 0
    ? "the opening pages and, when some pages share enough of the question's less common words, those pages"
    : "the pages that share enough of the question's less common words, or the opening pages when none do";
}

/** {@link chatPageSelection} at the measured anchor share: the served clause. */
export const CHAT_PAGE_SELECTION = chatPageSelection(
  CHAT_RETRIEVAL_ANCHOR_SHARE,
);

/**
 * The limit every entry carrying {@link CHAT_PAGE_SELECTION} must state, as a
 * sentence: the match is by words, so it can miss. Required per ENTRY by
 * `chat-retrieval-copy.test.ts`, because an entry can be read alone (the
 * tool-facts answer ships as FAQ JSON-LD, away from the page's other text).
 */
export const CHAT_SELECTION_MISS =
  "The match is by words, so a question worded differently from the document can miss the page it needs.";
