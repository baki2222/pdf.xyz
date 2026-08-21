/**
 * Does THIS worker image actually do the things the product says it does?
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * The web tier auto-deploys from `main`. The worker image does not — it is
 * built and swapped by hand. On 2026-08-21 that gap was measured: the running
 * image had been built on 2026-08-12, so the chunked-translate engine (#119),
 * the delivery cap (#120) and everything after had been merged, reviewed,
 * verified on the web surface, and **never executed**. `planTranslateChunks`
 * returned 0 hits inside the container.
 *
 * Meanwhile the FAQ said, in production, *"A longer document is NOT refused: it
 * is split at page boundaries and translated a few pages at a time."* A real
 * 12-page job came back with the pre-#119 refusal. **The product was claiming a
 * capability the running worker did not have, for nine days, and every check
 * either side of the gap was green** — because both halves were verified and
 * nothing tied them together.
 *
 * ── WHY IT PROVES RATHER THAN DECLARES ──────────────────────────────────────
 *
 * A boolean somebody writes is worth nothing here: it would have said `true`
 * throughout those nine days, because it would have been written in `main`.
 * This project has paid for that distinction already — a tool reporting
 * `ready: true` is reporting its WIRING, not its capability.
 *
 * So each probe RUNS the real code path over a synthetic input and checks the
 * outcome. It costs microseconds, touches no document, calls no provider, and
 * writes nothing. An image that predates the feature does not contain the
 * function at all, so there is nothing for it to answer with — its heartbeat
 * carries no such field and the reader parses the absence as `false`. **The old
 * image does not have to cooperate, which is the only design that could work:
 * it was built before anyone thought to ask.**
 *
 * ── WHAT A PASS DOES NOT MEAN ───────────────────────────────────────────────
 *
 * That the planner behaves correctly on real documents — its own tests own
 * that. This answers one question: *is the code that does this in the image
 * that is running.* Naming it precisely is the point, because the previous
 * answer to that question was an absence, and an absence reads as fine.
 */

import { planTranslateChunks, capPagesToDelivery } from "./chunking";
import { TRANSLATE_MAX_INPUT_CHARS } from "@/lib/jobs/translate-limits";

/**
 * A synthetic document that CANNOT fit in one provider call.
 *
 * Six pages of 4,000 characters against a ~10,258 ceiling: two pages share a
 * call, three calls are needed, and no single page is oversize. Deliberately
 * not one enormous page — that would exercise the oversize path instead of the
 * splitting path, and it is the splitting the FAQ promises.
 */
const PROOF_PAGES = 6;
const PROOF_PAGE_CHARS = 4_000;

function proofDocument(): { pageNumber: number; text: string }[] {
  return Array.from({ length: PROOF_PAGES }, (_, index) => ({
    pageNumber: index + 1,
    text: "x".repeat(PROOF_PAGE_CHARS),
  }));
}

/**
 * Can this image split a document too long for one call into several, without
 * losing a page?
 *
 * Both halves are asserted because either alone is satisfiable by a stub: a
 * planner that returned one chunk per page would "chunk" while conserving
 * nothing useful, and one that returned a single chunk containing everything
 * would conserve while not chunking at all.
 */
export function provesChunkedTranslate(
  ceiling: number = TRANSLATE_MAX_INPUT_CHARS,
): boolean {
  try {
    const pages = proofDocument();
    const plan = planTranslateChunks(pages, ceiling);
    const split = plan.chunks.length > 1;
    const placed =
      plan.chunks.reduce((n, chunk) => n + chunk.pages.length, 0) +
      plan.oversize.length;
    return split && placed === pages.length;
  } catch {
    // A throw is an answer: this image cannot do it.
    return false;
  }
}

/**
 * Does this image enforce a per-job delivery bound, and say which bound stopped
 * it?
 *
 * The reservation the route charges is decorative without this — declare one
 * character, receive a whole translation. `boundBy` is checked too, because a
 * cap that withholds pages without naming the reason produces a gap nobody can
 * act on, and the naming is the half that makes a wrong headroom visible.
 */
export function provesDeliveryCap(
  ceiling: number = TRANSLATE_MAX_INPUT_CHARS,
): boolean {
  try {
    const pages = proofDocument();
    const capped = capPagesToDelivery(pages, ceiling, {
      characters: Number.POSITIVE_INFINITY,
      pages: 2,
    });
    const withheld = capped.withheldPages.length === PROOF_PAGES - 2;
    const delivered = capped.plan.chunks.reduce(
      (n, chunk) => n + chunk.pages.length,
      0,
    );
    return withheld && delivered === 2 && capped.boundBy === "pages";
  } catch {
    return false;
  }
}
