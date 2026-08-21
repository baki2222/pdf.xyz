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
