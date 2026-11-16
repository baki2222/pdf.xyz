/**
 * What Summarize PDF's STATIC copy says about choosing part of a document
 * (audit summarize-pdf#5, PR 5b): one phrase, spread to the tool page's
 * intro and FAQ and the summarize guide. (Its tool-facts line is the
 * allowance only, and the mode FAQ that lists options is not served on a
 * page with authored content, so neither describes this choice.)
 *
 * ── WHY STATIC COPY MAY SAY IT NOW ──────────────────────────────────────────
 *
 * PR 5a (#343) kept this out of static copy, because the web tier
 * auto-deploys and the worker image is built by hand: a static page could
 * be served beside an image that reads only the whole document. Its exit
 * condition was the PROPERTY "the image serving production reads only the
 * pages chosen", observed on the wire, and it held on 2026-11-16:
 * production's `/api/worker/status` published `summarizePages: true`, and
 * one real job through the live page (`.claude/prove-summarize-pages.ts`, a
 * 6-page PDF, pages 3-4 chosen) stored `pagesSent` [[3,4]], and its summary
 * covered only those pages' subjects.
 *
 * ── THE SECOND BOUND (house rule 5) ─────────────────────────────────────────
 *
 * What can make this claim stale is a FUTURE worker image without the
 * behaviour. The heartbeat key {@link SUMMARIZE_PAGES_CAPABILITY} is the
 * boolean a worker publishes only after proving the page range on its own
 * pdftotext. What each check here does and does NOT cover:
 *
 *  - `src/lib/tools/capability-hedges.test.ts`, "the static page-choice
 *    advertisement is a member of its capability's subject": every served
 *    sentence carrying the advertisement is matched by the `summarizePages`
 *    subject, so the claim is read as a claim ABOUT that key, and a
 *    deferral planted in it is caught. It checks the key against
 *    `WIRE_KEYS`, derived from this tree's source, not read from the
 *    production wire: it ties the copy to the key's NAME, and says nothing
 *    about what the running image publishes.
 *  - `src/deploy/worker-summarize-pages-proof.test.ts`: CI's container step
 *    `worker:summarize-pages-proof` runs that same proof inside an image CI
 *    BUILDS. It covers built images only; an image that never went through
 *    CI, or an older one left running, is outside it.
 *
 * The LIVE bound is therefore an operator check, not a repo test: the
 * deploy verification (`verify-live`) reads production
 * `/api/worker/status` and must fail when `summarizePages` is not `true`.
 * It lives outside this repository, so no test here can fail when it is
 * skipped. When this was written that check did NOT yet read the key; the
 * operator is to add it. Until then nothing fails if a redeployed image
 * stops publishing `summarizePages` — except the panel itself, which hides
 * the control, so the page would advertise a choice it does not offer.
 *
 * ── WHAT IT MAY NOT SAY ─────────────────────────────────────────────────────
 *
 * No figures: not how many spans a reader may type, nor how many sections
 * are listed. Those are the panel's and the route's limits and free to
 * move. Never that every PDF offers sections: the panel lists them only
 * when the PDF has bookmarks, which is why {@link SUMMARIZE_SECTIONS_NEED_BOOKMARKS}
 * travels with the phrase wherever a reader may meet it alone. The shapes,
 * the served sentences and the surfaces that must carry it are pinned in
 * `./summarize-page-choice.test.ts`.
 */
import type { HeartbeatCapabilities } from "@/lib/workers/heartbeat/types";

/** The heartbeat key the static page-choice advertisement is ABOUT. */
export const SUMMARIZE_PAGES_CAPABILITY =
  "summarizePages" satisfies keyof HeartbeatCapabilities;

/** The advertisement, as a verb phrase: "you can {this}". */
export const SUMMARIZE_PAGE_CHOICE = "choose pages or a bookmarked section";

/** The limit that goes with it: a PDF without bookmarks lists no sections. */
export const SUMMARIZE_SECTIONS_NEED_BOOKMARKS =
  "Sections are listed only when the PDF has bookmarks.";
