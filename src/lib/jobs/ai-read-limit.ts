/**
 * The most of a document ONE run of a per-call AI tool (Summarize, Chat with
 * PDF, AI Data Extraction) reads, as every page states it: the FAQ (which also
 * ships as FAQPage JSON-LD), each panel's Limit row and the tool's own page
 * content all interpolate {@link aiReadLimitFor}, so they cannot disagree with
 * each other.
 *
 * ── DERIVED FROM THE PRICING, NOT RESTATED FROM IT ──────────────────────────
 *
 * A per-call run reads `min(engine window, the bound the route handed it)`
 * (`workers/processor/read-cap-limit.ts`), and the bound is whatever the
 * route's pricing returns as `delivery`. So the figure is computed by calling
 * that pricing, `aiReservationGiven` (the synchronous core of the
 * `aiReservationFor` that `POST /api/jobs` calls), for an honest declaration of
 * a document that fills the window, under BOTH answers of the running worker's
 * read-cap witness, and keeping the smaller. A page is read by a visitor whose
 * job may run on either image (the web tier deploys on merge, the worker image
 * is rebuilt by hand), so only a figure true of both is publishable.
 *
 * ⚠️ HISTORY, kept. On wave1/l01-page-leak this module published 30,774
 * "characters read per run": that lane clamped every declaration to one day's
 * allowance and priced it through `deliveryCapFor`. The branch it merged into
 * prices per-call runs through `aiReservationFor`, which clamps the CHARGE at
 * one whole run and leaves the READ bound at `declared × h`, so an honest long
 * document is read to the engine's own window. The clamp was not kept at the
 * integration (cd5515e8) and this module was dropped with it, leaving the pages
 * on the engine constants directly — true, but stated from the engine alone,
 * with no line from the figure to the pricing that decides it. The lane's own
 * re-review still asked for 30,774 in the FAQ: its guard priced through the
 * lane's function (`deliveryCapFor`), never the one the route calls. Now the
 * figure is a function OF the route's pricing, and
 * `tools/ai-ceiling-surfaces.test.ts` discovers which function the route
 * calls, runs the real processors under the bound it returns, and holds this
 * to what reaches the provider.
 */

import {
  CHAT_MAX_CHARACTERS_PER_QUESTION,
  CHAT_TOOL_SLUG,
} from "./chat-with-pdf";
import {
  AI_DELIVERY_LIMITS,
  AI_RUN_PRICING,
  aiReservationGiven,
} from "./delivery-cap";
import { AI_INPUT_LIMITS } from "./types";

/**
 * Each per-call engine's own read window, in worker-extracted characters.
 *
 * A TYPED MAP OF WHAT THE ENGINES ENFORCE, and so a constant with nothing
 * structural to keep it true. Its second, independent bound is the ceiling
 * guard, which RUNS each processor on a document longer than this and counts
 * what reaches the provider. Chat's window is its per-question ceiling, which
 * covers the document AND the conversation sent with it.
 */
const ENGINE_READ_WINDOW: Readonly<Record<string, number>> = {
  "summarize-pdf": AI_INPUT_LIMITS.maxInputCharacters,
  "ai-extract": AI_INPUT_LIMITS.maxInputCharacters,
  [CHAT_TOOL_SLUG]: CHAT_MAX_CHARACTERS_PER_QUESTION,
};

/** The tools priced per call, from the table the route prices by. */
const PER_CALL_TOOLS = Object.entries(AI_RUN_PRICING)
  .filter(([, pricing]) => pricing === "per-call")
  .map(([slug]) => slug);

/** What one run of `slug` reads when the running worker's witness says `proven`. */
function readUnder(slug: string, proven: boolean): number {
  const window = ENGINE_READ_WINDOW[slug];
  if (window === undefined) {
    throw new Error(
      `ai-read-limit: ${slug} is priced per call but has no engine read window — ` +
        "add it before any page may state how much it reads",
    );
  }
  // A document the browser counts at the window itself: honest, and as long
  // as anything the engine will read. The bound the pricing hands the worker
  // for it is what decides whether the window is reachable at all.
  const reservation = aiReservationGiven(
    slug,
    { declaredCharacters: window },
    AI_DELIVERY_LIMITS,
    proven,
  );
  return Math.min(window, reservation.delivery?.characters ?? window);
}

/**
 * The published per-run read limit of every per-call AI tool: true whether or
 * not the worker that runs the job has proved its read cap.
 */
export const AI_READ_LIMITS: Readonly<Record<string, number>> =
  Object.fromEntries(
    PER_CALL_TOOLS.map((slug) => [
      slug,
      Math.min(readUnder(slug, true), readUnder(slug, false)),
    ]),
  );

/** The figure a page of `slug` states for how much one run reads. */
export function aiReadLimitFor(slug: string): number {
  const limit = AI_READ_LIMITS[slug];
  if (limit === undefined) {
    throw new Error(
      `ai-read-limit: ${slug} is not priced per call, so it has no per-run read limit`,
    );
  }
  return limit;
}

/**
 * Page floors of that figure at the measured densities (see
 * `AI_INPUT_LIMITS`): dense pages first, so the range reads low to high.
 */
export function aiReadPagesAtDensest(slug: string): number {
  return Math.floor(
    aiReadLimitFor(slug) / AI_INPUT_LIMITS.densestCharactersPerPage,
  );
}

export function aiReadPagesAtSparsest(slug: string): number {
  return Math.floor(
    aiReadLimitFor(slug) / AI_INPUT_LIMITS.sparsestCharactersPerPage,
  );
}
