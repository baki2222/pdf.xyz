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
 * behaviour. Two checks bind the claim to the heartbeat key
 * {@link CHAT_PAGE_SELECTION_CAPABILITY}, the boolean the worker publishes
 * only after proving page selection on its own pdftotext:
 *
 *  - `src/lib/tools/capability-hedges.test.ts`, "the static page-selection
 *    claim is a member of its capability's subject": every served sentence
 *    carrying this clause is matched by the `chatRetrieval` subject, so the
 *    claim is read as a claim ABOUT that key, and the key must be on the
 *    wire for the subject to exist at all.
 *  - `src/deploy/worker-chat-retrieval-proof.test.ts`: CI's container step
 *    `worker:chat-retrieval-proof` runs that same proof inside the BUILT
 *    image and fails the build unless it passes, so an image that lost the
 *    behaviour does not get built green.
 *
 * A boolean has no list to derive copy from (contrast Translate's
 * `TRANSLATE_PDF_CI_REQUIRED`, which the copy counts), so the honest
 * equivalent is the tie above: the copy names the key, and the key is what
 * the built image must prove.
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
 */
export const CHAT_PAGE_SELECTION =
  CHAT_RETRIEVAL_ANCHOR_SHARE > 0
    ? "the opening pages and the pages that share the most of the question's less common words"
    : "the pages that share the most of the question's less common words, or the opening pages when none do";
