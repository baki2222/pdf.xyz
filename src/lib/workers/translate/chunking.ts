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

/** One provider call's worth of whole pages, in document order. */
export interface TranslateChunk {
  /** 0-based position in the plan. The assembly orders by this, never by arrival. */
  readonly index: number;
  /** Real page numbers carried by this chunk, ascending. Never indices. */
  readonly pages: readonly number[];
  /** Exactly what is sent to the model: the pages joined as the extractor joins them. */
  readonly text: string;
  readonly characters: number;
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
 */
export function planTranslateChunks(
  pageChunks: readonly { pageNumber: number; text: string }[],
  ceiling: number,
): TranslatePlan {
  const chunks: TranslateChunk[] = [];
  const oversize: OversizePage[] = [];
  const pages: number[] = [];

  let pending: { pageNumber: number; text: string }[] = [];
  let pendingChars = 0;

  const flush = (): void => {
    if (pending.length === 0) return;
    chunks.push({
      index: chunks.length,
      pages: pending.map((p) => p.pageNumber),
      text: pending.map((p) => p.text).join(PAGE_JOIN),
      characters: pendingChars,
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

    const joined =
      pending.length === 0 ? size : pendingChars + PAGE_JOIN.length + size;
    if (joined > ceiling) flush();
    pending.push(page);
    pendingChars =
      pending.length === 1 ? size : pendingChars + PAGE_JOIN.length + size;
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
 * ── THE ACCUMULATION IS A HAIR UNDER WHAT IS SENT ───────────────────────────
 *
 * Chunks are joined with {@link PAGE_JOIN}, so a call carries two characters
 * per page boundary that this walk does not count. That is a handful of
 * characters against a reservation in the tens of thousands, and it errs toward
 * delivering slightly more than was reserved rather than slightly less — the
 * direction that cannot truncate an honest caller's document. Stated because an
 * uncounted term is a defect even when it is small, and the next person needs
 * to know it was seen rather than missed.
 *
 * ── STOPS; DOES NOT SKIP ────────────────────────────────────────────────────
 *
 * Not "skip this page and try the next one that fits". A budget is exhausted
 * once, and packing later pages into the hole would scatter the missing ones
 * through the document instead of leaving one honest tail the reader can act on.
 */
export function capPagesToDelivery(
  pageChunks: readonly { pageNumber: number; text: string }[],
  ceiling: number,
  limit: DeliveryLimit,
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
  return {
    plan: planTranslateChunks(delivered, ceiling),
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
 */
export function withheldPagesMarker(
  pages: readonly number[],
  boundBy: DeliveryBound,
  limit: DeliveryLimit,
): string {
  const first = pages[0];
  const last = pages[pages.length - 1];
  const list =
    pages.length === 1 ? `Page ${first}` : `Pages ${first}\u2013${last}`;
  const because =
    boundBy === "characters"
      ? `This job reserved enough of the daily allowance for ${limit.characters.toLocaleString("en-US")} characters of text, and the document holds more.`
      : `This document was submitted as ${(limit.pages ?? 0).toLocaleString("en-US")} pages of text and holds more than that.`;
  return [
    "",
    `> \u26a0\ufe0f **${list} ${pages.length === 1 ? "is" : "are"} not translated.**`,
    `> ${because} Everything above was translated, and nothing was charged beyond what was reserved. Translate the remaining pages as a separate document.`,
    "",
  ].join("\n");
}

/** The refusal when the reservation covered no page at all. */
export function nothingDeliverableMessage(
  boundBy: DeliveryBound,
  limit: DeliveryLimit,
): string {
  return boundBy === "characters"
    ? `This job reserved enough of the daily allowance for ${limit.characters.toLocaleString("en-US")} characters of text, and the document's first page alone holds more — so no page could be translated and nothing was sent to the AI model. Submit the document again with its real length, or split it into smaller files.`
    : `This document was submitted as ${(limit.pages ?? 0).toLocaleString("en-US")} pages of text, which covers no complete page of it — so nothing was translated and nothing was sent to the AI model. Submit the document again with its real page count.`;
}
