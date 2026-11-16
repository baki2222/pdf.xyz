/**
 * Splitting a document into calls the model can actually answer.
 *
 * The translate ceiling — `translateMaxInputChars(maxOutputTokens)`, 10,258
 * characters at the shipped budget — is a property of **one provider call**:
 * translate writes as much as it reads, so a single call cannot exceed its
 * output budget. It was applied to the whole JOB, so a twelve-page document
 * whose pages are 2,000 characters each was refused outright and the caller
 * spent a daily AI run on nothing.
 *
 * ── WHY PAGE BOUNDARIES, AND NOTHING FINER ───────────────────────────────────
 *
 * A page is the smallest unit that carries its own context. Cutting mid-page
 * hands the model a fragment beginning mid-sentence: it translates it, the
 * output reads fluently, and the seam is invisible in the result — the same
 * shape as every other defect in this feature's history, where the failure
 * produces confident text rather than an error. Pages also give the artifact
 * something to NAME when a piece is missing: "page 7" is checkable by the
 * reader, "characters 41,000–52,000" is not.
 *
 * ── CONSERVATION IS THE PROPERTY THAT MATTERS ────────────────────────────────
 *
 * Every page must land in exactly one chunk, or be reported as oversize —
 * never both, never neither. A planner that drops a page produces a shorter
 * translation that reads perfectly and is wrong about the document, and no
 * assertion about formatting or cost can see it. `planTranslateChunks` is pure
 * so that property can be proven exhaustively without a provider.
 */

import { PAGE_JOIN } from "@/lib/pdf/text";
import type { DeliveryBound } from "@/lib/jobs/delivery-cap";
import type { PageSpan } from "@/lib/pdf/page-spans";
import {
  collidesWithMarker,
  separatorFor,
  separatorOverhead,
} from "./page-markers";
import { pagesLabel } from "./page-labels";

/** One provider call's worth of whole pages, in document order. */
export interface TranslateChunk {
  /** 0-based position in the plan. The assembly orders by this, never by arrival. */
  readonly index: number;
  /** Real page numbers carried by this chunk, ascending. Never indices. */
  readonly pages: readonly number[];
  /**
   * Exactly what is sent to the model: each page's SENT text (`send ?? text`,
   * see {@link PlannedPage}), joined with `separatorFor(page)`
   * (`./page-markers`) before every page after the first when {@link marked},
   * and with {@link PAGE_JOIN} otherwise. So `text.length ≤ characters` either
   * way, and an unmarked chunk is exactly the text sent before markers
   * existed.
   */
  readonly text: string;
  /**
   * What the chunk WEIGHS: each page's `text` length plus one
   * `separatorFor(page)` (`./page-markers`) per boundary, whether or not the
   * chunk ends up marked. Never less than `text.length`, because a page's
   * `send` is never longer than its `text` (`./reading-order`) and a separator
   * is never shorter than {@link PAGE_JOIN}.
   */
  readonly characters: number;
  /**
   * Whether this chunk carries page markers between its pages. Always false
   * for a one-page chunk, which has no boundary to mark.
   */
  readonly marked: boolean;
  /**
   * Why a MULTI-PAGE chunk is not marked; `null` when it is marked or has one
   * page. "collision": a page's sent text, or the job's instructions, holds
   * the marker's brand (`collidesWithMarker`). "budget": its markers did not
   * fit what was left of the reservation's slack ({@link capPagesToDelivery}).
   */
  readonly markerFallback: "collision" | "budget" | null;
}

/** How {@link planTranslateChunks} decides which chunks carry markers. */
export interface MarkerPlanOptions {
  /**
   * Characters of marker overhead (`separatorOverhead`) the plan may spend,
   * chunk by chunk in document order. Default `Infinity`: the plan an
   * UNCAPPED worker would send, which is what the browser preflight gets.
   */
  readonly markerBudget?: number;
  /**
   * `false` marks nothing and counts every multi-page chunk as a collision:
   * the engine passes it when the job's instructions hold the brand. Default
   * `true`. Neither option touches sizing.
   */
  readonly markers?: boolean;
}

/**
 * A page that cannot be translated at all, because it alone exceeds what one
 * call may produce. Named rather than skipped: the artifact has to say which
 * page is missing, and this is where that number comes from.
 */
export interface OversizePage {
  readonly pageNumber: number;
  readonly characters: number;
}

/**
 * One page as the planner reads it.
 *
 * `text` is what the page WEIGHS — every size, ceiling and bound below is in
 * its unit, the `-layout` unit the published figures were calibrated in.
 * `send`, when present, is what is SENT in its place (Translate's flow text,
 * gated by `./reading-order`'s `translatePageBlocks`). The browser preflight
 * never sets it, so its plans are unchanged.
 */
export interface PlannedPage {
  pageNumber: number;
  text: string;
  send?: string;
}

export interface TranslatePlan {
  readonly chunks: readonly TranslateChunk[];
  readonly oversize: readonly OversizePage[];
  /** Every page the plan accounts for, ascending — chunked and oversize alike. */
  readonly pages: readonly number[];
}

/**
 * Pack whole pages into the fewest calls that each stay under `ceiling`.
 *
 * Greedy and in order, which is deliberate rather than merely simple: any
 * reordering to pack tighter would put pages in a call whose neighbours are not
 * their neighbours in the document, and a translator's output depends on the
 * text around it. Fewer calls is not worth a worse translation.
 *
 * An oversize page ENDS the chunk being built. It is not skipped over to keep
 * packing, because the pages after it belong after the gap — the plan has to
 * stay in document order for the assembly to place the gap where the page was.
 *
 * ── MARKERS ARE SIZED ALWAYS, AND DECIDED AFTER ─────────────────────────────
 *
 * Every boundary is sized as `separatorFor(next page)`, whether or not the
 * chunk is then marked, so the page-sets of a plan never depend on collision,
 * budget or `send`: the browser preflight (budget `Infinity`, no `send`) and
 * the worker (a capped budget) cut the same chunks. Only then is each
 * multi-page chunk marked, in document order: not on a collision (which spends
 * nothing), else only if its overhead fits the remaining budget, which it then
 * spends. `chunking.markers.test.ts` (v) holds the independence.
 */
export function planTranslateChunks(
  pageChunks: readonly PlannedPage[],
  ceiling: number,
  options: MarkerPlanOptions = {},
): TranslatePlan {
  const chunks: TranslateChunk[] = [];
  const oversize: OversizePage[] = [];
  const pages: number[] = [];
  const markers = options.markers ?? true;
  let budget = options.markerBudget ?? Number.POSITIVE_INFINITY;

  let pending: PlannedPage[] = [];
  let pendingChars = 0;

  const flush = (): void => {
    if (pending.length === 0) return;
    let marked = false;
    let markerFallback: TranslateChunk["markerFallback"] = null;
    if (pending.length > 1) {
      const overhead = pending
        .slice(1)
        .reduce((sum, p) => sum + separatorOverhead(p.pageNumber), 0);
      // Judged on the pages JOINED, not one by one: the brand tolerates a
      // space inside it (`MARKER_GAP`), so a page ending "PDF" before one
      // starting "XYZ" holds it across the boundary, and a model that runs
      // the two paragraphs together would have the reader strip both words.
      // The joined text holds every page's own text, so this is never weaker
      // than the per-page test.
      if (
        !markers ||
        collidesWithMarker(pending.map((p) => p.send ?? p.text).join(PAGE_JOIN))
      ) {
        markerFallback = "collision";
      } else if (overhead <= budget) {
        marked = true;
        budget -= overhead;
      } else {
        markerFallback = "budget";
      }
    }
    chunks.push({
      index: chunks.length,
      pages: pending.map((p) => p.pageNumber),
      text: marked
        ? pending
            .map((p, i) =>
              i === 0
                ? (p.send ?? p.text)
                : separatorFor(p.pageNumber) + (p.send ?? p.text),
            )
            .join("")
        : pending.map((p) => p.send ?? p.text).join(PAGE_JOIN),
      characters: pendingChars,
      marked,
      markerFallback,
    });
    pending = [];
    pendingChars = 0;
  };

  for (const page of pageChunks) {
    pages.push(page.pageNumber);
    const size = page.text.length;

    // A page that cannot fit alone can never fit anywhere. Flush what is
    // pending so the gap lands in document order, then record it by number.
    if (size > ceiling) {
      flush();
      oversize.push({ pageNumber: page.pageNumber, characters: size });
      continue;
    }

    const boundary = separatorFor(page.pageNumber).length;
    const joined = pending.length === 0 ? size : pendingChars + boundary + size;
    if (joined > ceiling) flush();
    pending.push(page);
    pendingChars = pending.length === 1 ? size : pendingChars + boundary + size;
  }
  flush();

  return { chunks, oversize, pages };
}

/**
 * The marker left in the assembled translation where a page could not be
 * translated.
 *
 * IT IS POSITIONED, not a footnote. A list of missing pages at the end of a
 * document is read after the reader has already believed the text is complete;
 * a gap where the page was is read at the moment it matters. The page number is
 * present so the reader can go and look at the original.
 */
export function missingPageMarker(page: OversizePage): string {
  return [
    "",
    `> ⚠️ **Page ${page.pageNumber} is not translated.**`,
    `> It holds ${page.characters.toLocaleString("en-US")} characters of text, more than this tool can translate in one pass, so it was skipped rather than truncated. Everything else in this document was translated. Extract that page on its own and translate it separately.`,
    "",
  ].join("\n");
}

/**
 * How much this job is allowed to deliver. See `@/lib/jobs/delivery-cap` for
 * why there are two bounds and why one of them is the only thing that can see
 * the other being wrong.
 */
export interface DeliveryLimit {
  /** Total characters of page text the job may send to the model. */
  readonly characters: number;
  /** Total pages the job may translate; absent means unbounded. */
  readonly pages?: number;
}

export interface CappedPlan {
  /** The plan over the pages the cap allows — chunked and oversize as usual. */
  readonly plan: TranslatePlan;
  /** Pages the cap withheld, ascending. Empty when the cap did not bind. */
  readonly withheldPages: readonly number[];
  /**
   * Which bound stopped delivery; `null` when nothing was withheld.
   *
   * Reported rather than inferred by the caller, because only this walk knows
   * which comparison failed. "The characters ran out" and "the document has
   * more pages than were declared for it" are different events with different
   * remedies — and, since there is no telemetry, a named bound in the artifact
   * is the ONLY way anyone will learn which one binds in practice.
   */
  readonly boundBy: DeliveryBound | null;
}

/**
 * Decide which pages this job may translate, then plan those.
 *
 * ── IT CUTS AT A PAGE, NOT AT A CHUNK ───────────────────────────────────────
 *
 * The first version of this cut whole CHUNKS, which was simpler and quietly
 * meaner: chunks hold up to five pages, so a reservation covering four pages
 * would have delivered zero. The budget is spent per page, so the cut belongs
 * per page — and planning happens AFTER the cut, over exactly the pages that
 * were paid for.
 *
 * ── OVERSIZE PAGES CONSUME NEITHER BOUND ────────────────────────────────────
 *
 * A page larger than one call's ceiling is never sent to the model, so charging
 * it against a budget denominated in what is sent would withhold real pages to
 * pay for text nobody translated. It still gets its own marker, from the
 * planner, because it is inside the delivered range.
 *
 * ── EVERY SENT CHARACTER IS WEIGHED, WITH ONE RECORDED EXCEPTION ────────────
 *
 * The general rule: any character in `chunk.text` that a page's `text` length
 * does not include must be COUNTED. Since reading order, a page is weighed by
 * its `-layout` `text` while its flow `send` is what goes out, so a term added
 * to the sent text is invisible to every bound unless it is counted
 * explicitly. `reading-order.chain.test.ts` ("sent ≤ weighed") goes red when
 * it is not.
 *
 * Page markers (`./page-markers`) are such a term, and they are counted in two
 * places, for two different bounds:
 *
 * - SIZED in {@link planTranslateChunks}: every boundary weighs
 *   `separatorFor(page)`, so `text.length ≤ characters ≤ ceiling` per call
 *   (`chunking.markers.test.ts` (i)), and the browser preflight, which plans
 *   with the same function, inherits it.
 * - BUDGETED here, out of the reservation's SLACK: the walk below is NOT
 *   changed (same size, same cut, same `boundBy`), and after the cut the
 *   markers may spend only `limit.characters − Σ delivered size`
 *   (`chunking.markers.test.ts` (iii)). A chunk whose markers do not fit is
 *   sent unmarked. Charging markers inside the walk would withhold a page an
 *   unmarked plan delivers, and the withheld notice ("the document holds
 *   more") would then be false; `chunking.markers.test.ts` (ii) proves the
 *   delivered set is identical to a reference copy of the walk without
 *   markers.
 *
 * The one exception is {@link PAGE_JOIN}: every page boundary carries one (a
 * marked boundary's separator is `PAGE_JOIN + marker + PAGE_JOIN`, and all of
 * it past the first `PAGE_JOIN` is the budgeted overhead), so a call carries
 * two characters per page boundary that this walk does not count
 * (`planTranslateChunks` does count them, in `characters`). That is a handful
 * of characters against a reservation in the tens of thousands, and it errs
 * toward delivering slightly more than was reserved rather than slightly
 * less — the direction that cannot truncate an honest caller's document. The
 * test subtracts exactly this term (`UNCOUNTED_JOIN_PER_BOUNDARY`) and no
 * other; it is not a precedent for a second uncounted term, and markers are
 * not one (they are budgeted, above).
 *
 * ── STOPS; DOES NOT SKIP ────────────────────────────────────────────────────
 *
 * Not "skip this page and try the next one that fits". A budget is exhausted
 * once, and packing later pages into the hole would scatter the missing ones
 * through the document instead of leaving one honest tail the reader can act on.
 */
export function capPagesToDelivery(
  pageChunks: readonly PlannedPage[],
  ceiling: number,
  limit: DeliveryLimit,
  /**
   * Passed through to {@link planTranslateChunks}: `false` when the job's
   * instructions hold the marker's brand. It never touches the walk.
   */
  options: Pick<MarkerPlanOptions, "markers"> = {},
): CappedPlan {
  const maxPages = limit.pages ?? Number.POSITIVE_INFINITY;
  let characters = 0;
  let pages = 0;
  let boundBy: DeliveryBound | null = null;
  let cut = pageChunks.length;

  for (const [i, page] of pageChunks.entries()) {
    const size = page.text.length;
    // Never sent, never translated, never charged — but still inside the
    // delivered range, so the planner will name it.
    if (size > ceiling) continue;

    if (characters + size > limit.characters) {
      boundBy = "characters";
      cut = i;
      break;
    }
    if (pages + 1 > maxPages) {
      boundBy = "pages";
      cut = i;
      break;
    }
    characters += size;
    pages += 1;
  }

  const delivered = pageChunks.slice(0, cut);
  // The reservation's slack: what the delivered pages left of the character
  // bound. Markers spend only this, so the walk above never moves.
  const markerBudget = limit.characters - characters;
  return {
    plan: planTranslateChunks(delivered, ceiling, {
      markerBudget,
      ...(options.markers === false ? { markers: false } : {}),
    }),
    withheldPages: pageChunks.slice(cut).map((page) => page.pageNumber),
    boundBy,
  };
}

/**
 * The marker left where delivery stopped because the job ran out of what it
 * reserved.
 *
 * IT NAMES THE BOUND. "Delivered 8 of 12 pages" is not actionable; "the
 * remaining pages held more text than this job reserved" and "the document has
 * more pages than were declared for it" lead to different next steps — and
 * telling them apart is also the only way anyone learns which bound binds in
 * practice, because nothing else records it.
 *
 * `chosen` is the job's page selection (or `null`), read from the gap part.
 * The page list is `pagesLabel`'s (`./page-labels`), so under a selection it
 * names only chosen pages; and the `because` sentence names the object the
 * declaration was OF: under a selection the browser declared the chosen
 * pages, so "the document" would be the wrong one. For a whole-document job
 * both are byte-identical to what they were (the ZIP's characterisation SHAs).
 */
export function withheldPagesMarker(
  pages: readonly number[],
  boundBy: DeliveryBound,
  limit: DeliveryLimit,
  chosen: readonly PageSpan[] | null,
): string {
  const list = pagesLabel(pages, chosen);
  const reserved = limit.characters.toLocaleString("en-US");
  const declared = (limit.pages ?? 0).toLocaleString("en-US");
  const because =
    boundBy === "characters"
      ? `This job reserved enough of the daily allowance for ${reserved} characters of text, and ${chosen ? "the pages you chose hold" : "the document holds"} more.`
      : chosen
        ? `The pages you chose were submitted as ${declared} pages of text and hold more than that.`
        : `This document was submitted as ${declared} pages of text and holds more than that.`;
  return [
    "",
    `> \u26a0\ufe0f **${list} ${pages.length === 1 ? "is" : "are"} not translated.**`,
    `> ${because} Everything above was translated, and nothing was charged beyond what was reserved. Translate the remaining pages as a separate document.`,
    "",
  ].join("\n");
}

/**
 * The refusal when the reservation covered no page at all.
 *
 * `chosen` is true for a job that chose pages: the declaration was then of
 * the chosen pages, and "the document's first page" is not the first page
 * the walk met. Byte-identical for a whole-document job (`chosen` false).
 */
export function nothingDeliverableMessage(
  boundBy: DeliveryBound,
  limit: DeliveryLimit,
  chosen: boolean,
): string {
  const reserved = limit.characters.toLocaleString("en-US");
  const declared = (limit.pages ?? 0).toLocaleString("en-US");
  if (boundBy === "characters")
    return `This job reserved enough of the daily allowance for ${reserved} characters of text, and ${chosen ? "the first page you chose" : "the document's first page"} alone holds more — so no page could be translated and nothing was sent to the AI model. Submit the document again with its real length, or split it into smaller files.`;
  return chosen
    ? `The pages you chose were submitted as ${declared} pages of text, which covers no complete page of them — so nothing was translated and nothing was sent to the AI model. Submit them again with their real page count.`
    : `This document was submitted as ${declared} pages of text, which covers no complete page of it — so nothing was translated and nothing was sent to the AI model. Submit the document again with its real page count.`;
}
