/**
 * What Translate PDF's STATIC copy says about choosing pages (competitor
 * audit #29, slice 7): the phrase and its two limits, spread to the tool
 * page's intro and FAQ, the served "How much of my PDF" fact, and the
 * translate guide.
 *
 * ── WHY STATIC COPY MAY SAY IT NOW ──────────────────────────────────────────
 *
 * Slice 6 (#347) kept this out of static copy, because the web tier
 * auto-deploys and the worker image is built by hand: a static page could be
 * served beside an image that translates only the whole document. Its exit
 * condition was the PROPERTY "the image serving production translates only
 * the pages chosen", observed on the wire, and it held on 2026-11-17:
 * production's `/api/worker/status` published `translatePageRange: true`,
 * and one real job through the live page
 * (`.claude/prove-translate-page-range.ts`, a 5-page PDF, pages "2, 4",
 * target es) stored `pagesSent` [[2,2],[4,4]], said "You chose pages 2 and
 * 4 of 5." in its README and translation.md, and its PDF held the
 * translations of pages 2 and 4 and no other page.
 *
 * ── THE SECOND BOUND (house rule 5) ─────────────────────────────────────────
 *
 * What can make this claim stale is a FUTURE worker image without the
 * behaviour. The heartbeat key {@link TRANSLATE_PAGE_RANGE_CAPABILITY} is
 * the boolean a worker publishes only after proving the page range on its
 * own extractor. What each check here does and does NOT cover:
 *
 *  - `src/lib/tools/capability-hedges.test.ts`, "the translatePageRange
 *    subject": every served sentence carrying the advertisement is matched
 *    by the `translatePageRange` subject, so the claim is read as a claim
 *    ABOUT that key, and a deferral planted in it is caught. It checks the
 *    key against `WIRE_KEYS`, derived from this tree's source, not read from
 *    the production wire: it ties the copy to the key's NAME, and says
 *    nothing about what the running image publishes.
 *  - `src/deploy/worker-translate-page-range-proof.test.ts`: CI's container
 *    step runs the same proof inside an image CI BUILDS. It covers built
 *    images only; an image that never went through CI, or an older one left
 *    running, is outside it.
 *
 * The LIVE bound is therefore an operator check, not a repo test: the deploy
 * verification (`.claude/verify-live.sh`) reads production
 * `/api/worker/status` and fails when `translatePageRange` is not `true`.
 * That script is not tracked in this repository and CI never runs it; it
 * runs only when the operator runs it. So no test here fails when it is
 * skipped, and between its runs a redeployed image that stops publishing
 * `translatePageRange` is seen by nothing here — only by the panel, which
 * hides the field, so the page would advertise a choice it does not offer.
 *
 * ── WHAT IT MAY NOT SAY ─────────────────────────────────────────────────────
 *
 * Never that a scan can have pages chosen: the panel shows the field only
 * when the file has selectable text (`pageRangeOffered && !scanDetected` in
 * `translate-worker-panel.tsx`), which is why {@link TRANSLATE_PAGES_NEED_TEXT}
 * travels with the phrase wherever a reader may meet it alone. Never a
 * refill TIME: the allowance is a fixed window from its first charge, not a
 * calendar day, so the remedy says "after the allowance resets", the word
 * `AI_ALLOWANCE_FACT` already uses, and never "tomorrow" or "at midnight".
 * Never that choosing a page helps a page longer than one pass: it does not,
 * and the copy that says so is untouched. The shapes, the served sentences
 * and the surfaces that must carry it are pinned in
 * `./translate-page-choice.test.ts`.
 */
import type { HeartbeatCapabilities } from "@/lib/workers/heartbeat/types";

/** The heartbeat key the static page-choice advertisement is ABOUT. */
export const TRANSLATE_PAGE_RANGE_CAPABILITY =
  "translatePageRange" satisfies keyof HeartbeatCapabilities;

/** The advertisement, as a verb phrase: "you can {this}". */
export const TRANSLATE_PAGE_CHOICE = "choose which pages to translate";

/** The limit that goes with it: a scan gets no page choice. */
export const TRANSLATE_PAGES_NEED_TEXT =
  "Pages can be chosen only when the PDF has selectable text, not for a scan.";

/** What choosing does: only those pages are sent and charged, and named. */
export const TRANSLATE_ONLY_CHOSEN_PAGES =
  "Only the pages you choose are sent to the AI model and count against the allowance, and the result names them.";

/**
 * The remedy for a document over what the allowance has left, where the
 * split-first advice used to sit. "After the allowance resets": see above.
 */
export const TRANSLATE_OVER_ALLOWANCE_REMEDY = `You can ${TRANSLATE_PAGE_CHOICE} instead, and translate the rest after the allowance resets.`;
