/**
 * Translate's reading order: which text of each page goes to the model.
 *
 * ── THE DEFECT THIS EXISTS FOR ──────────────────────────────────────────────
 *
 * The worker reads Translate's text with `pdftotext -layout` (collapsed), the
 * page's VISUAL arrangement. On a two-column page that puts every left-column
 * line beside its right-column neighbour, so the model receives the two
 * columns interleaved line by line, and translates them that way — fluently.
 * Poppler's `-bbox-layout` flow (`../pdf-text/flow`, `flowPageText`) reads
 * the same page column by column. This module decides, page by page, whether
 * that flow text may be SENT in place of the `-layout` text.
 *
 * ── THE PROPERTY IT MUST NOT BREAK ──────────────────────────────────────────
 *
 * Every figure the job is priced and capped by — the 10,258-character call
 * ceiling, the delivered allowance, the ×4 reservation, the pages bound — is
 * calibrated in the `-layout` unit. So a page is always WEIGHED by its
 * `-layout` text (`text`), and only its SENT text (`send`) changes. Two
 * rules make "never sends more than it weighed" structural rather than
 * statistical:
 *
 *  - {@link translatePageBlocks} attaches `send` only to pages
 *    `pageTextChunks` already kept, so the set of text pages cannot change;
 *  - `send` is attached only when it is no longer than `text` (gate b below).
 *
 * The planner joins `send ?? text` and sizes by `text`
 * (`./chunking.ts`, `planTranslateChunks`). The tests that hold both halves:
 * `reading-order.test.ts` (the gate) and `reading-order.chain.test.ts`
 * (weight invariance, and sent ≤ weighed over every chunk).
 *
 * ── THE GATE: ONE FUNCTION, AT THE POINT OF CONSUMPTION ─────────────────────
 *
 * {@link composeReadingOrderExtractor} attaches the RAW flow text and does not
 * judge it. {@link translatePageBlocks} judges it once, on the normalised
 * text, and sends flow only when all three hold:
 *
 *  (a) {@link sameInk}: the same multiset of non-whitespace code points, soft
 *      hyphens (U+00AD) deleted on both sides. Flow keeps line-end hyphens
 *      and turns table cells into tabs, so prose, hyphenation and tables
 *      compare equal; a word the flow parser dropped does not. ORDER-BLIND by
 *      design: it guards loss, not order.
 *  (b) `send.length <= text.length`.
 *  (c) No strong right-to-left script on the page ({@link isStrongRtl}).
 *      Flow's word order inside an RTL line has not been read back on the
 *      shipped poppler, and an order-blind gate cannot see it. The exit
 *      condition is that property being measured on the shipped binary, not
 *      a test that mentions Arabic.
 *
 * A page that fails is sent as `-layout`, exactly as before this module, and
 * counted by reason ({@link ReadingOrderTally}). When more than one gate
 * fails, the reason recorded is the first of rtl, ink, longer.
 *
 * Scripts without letter case (CJK) give flow's table rules less to see, so a
 * narrow list beside a paragraph can come out tab-joined. That is a quality
 * limit, not a loss: the ink is equal, and gate (a) passes it.
 *
 * Pure: no Node built-ins, so it is testable without poppler.
 */

import {
  normalizeExtractedText,
  type ExtractedPdfText,
  type ExtractedTextPage,
} from "@/lib/pdf/text";
import { flowPageText, type PdfFlowText } from "../pdf-text/flow";
import { rethrowIfAttemptAbort, type RunControl } from "../attempt-abort";
import type { PdfFlowExtractor } from "../pdf-office-export/engine";

/** A page as Translate reads it: its `-layout` text, and maybe its flow text. */
export type ReadingOrderPage = ExtractedTextPage & {
  /** The page's raw flow text (`flowPageText`), ungated. See the module docblock. */
  send?: string;
};

/**
 * Why the document's pages do or do not carry flow text.
 *
 *  - `flow`: flow text was read and paired page by page (each page is still
 *    gated by {@link translatePageBlocks});
 *  - `bbox_failed`: the `-bbox-layout` run threw (size, time, parse) and
 *    every page is sent as `-layout`;
 *  - `page_count`: the two runs disagree on the page count, so no pairing is
 *    knowable and no page carries flow;
 *  - `not_run`: the `-layout` run found no translatable text, so the second
 *    run was not made.
 */
export interface ReadingOrderSource {
  readonly source: "flow" | "bbox_failed" | "page_count" | "not_run";
}

/**
 * `Omit`, not a bare intersection: intersecting the two `pages` arrays would
 * read every element back as a plain `ExtractedTextPage`, without `send`.
 */
export type TranslateExtracted = Omit<ExtractedPdfText, "pages"> & {
  pages: ReadingOrderPage[];
  readingOrder?: ReadingOrderSource;
};

/**
 * Translate's extractor. Any plain `(bytes, run?) => Promise<ExtractedPdfText>`
 * is assignable to it, so every stub that predates reading order still fits.
 */
export type TranslateExtractor = (
  bytes: Uint8Array,
  run?: RunControl,
) => Promise<TranslateExtracted>;

type LayoutExtractor = (
  bytes: Uint8Array,
  run?: RunControl,
) => Promise<ExtractedPdfText>;

/**
 * Does this extraction hold text the engine will translate?
 *
 * ONE definition, read by the engine's `no_text` refusal, by the translate
 * processor's decision to run OCR first (audit translate-pdf#3), and by
 * {@link composeReadingOrderExtractor}'s decision to make the second run.
 * OCR runs on exactly the documents the engine would otherwise refuse as
 * having no text, and on nothing else. Two copies of the predicate would let
 * a PDF with a text layer be recognised (and charged for) again, or a scan
 * slip past OCR into the refusal. Defined here rather than in `./engine` so
 * this module does not import the engine; `./engine` re-exports it.
 */
export function hasTranslatableText(
  extracted: Pick<ExtractedPdfText, "hasText" | "text">,
): boolean {
  return extracted.hasText && extracted.text.trim().length > 0;
}

const SOFT_HYPHEN = "­";

/** The non-whitespace code points of `text`, soft hyphens deleted, counted. */
function inkOf(text: string): Map<string, number> {
  const ink = new Map<string, number>();
  for (const ch of text) {
    if (ch === SOFT_HYPHEN || /\s/u.test(ch)) continue;
    ink.set(ch, (ink.get(ch) ?? 0) + 1);
  }
  return ink;
}

/**
 * Do `a` and `b` carry the same ink: the same multiset of non-whitespace code
 * points, after deleting U+00AD on both sides? Order-blind by design.
 */
export function sameInk(a: string, b: string): boolean {
  const left = inkOf(a);
  const right = inkOf(b);
  if (left.size !== right.size) return false;
  for (const [ch, count] of left) if (right.get(ch) !== count) return false;
  return true;
}

/**
 * Strong right-to-left scripts, DERIVED from Unicode script properties rather
 * than typed as code-point ranges: a typed list missed Hebrew presentation
 * forms (U+FB1D–FB4F, which poppler emits for pointed Hebrew), Arabic
 * Extended-B, Syriac, Thaana, NKo, Samaritan, Mandaic and the astral scripts.
 * Over-inclusion only costs a fallback to `-layout`, the safe direction.
 */
const STRONG_RTL =
  /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}]/u;

/** Does `text` hold any character of a strong right-to-left script? */
export function isStrongRtl(text: string): boolean {
  return STRONG_RTL.test(text);
}

/** A page block as the planner reads it: weighed by `text`, sent as `send ?? text`. */
export interface TranslatePageBlock {
  pageNumber: number;
  /** The normalised `-layout` text: what the page WEIGHS. */
  text: string;
  /** The normalised flow text, present only when the gate passed. */
  send?: string;
}

/** How the document's text pages were sent, by reason. Bounded integers. */
export interface ReadingOrderTally {
  /** Text pages sent as flow. */
  flowPages: number;
  /** Text pages sent as `-layout`: no flow text, or a gate failed. */
  layoutPages: number;
  /** Pages that HAD flow text and fell back, by the first gate that failed. */
  fellBack: { ink: number; longer: number; rtl: number };
}

export interface TranslatePageBlocks {
  blocks: TranslatePageBlock[];
  tally: ReadingOrderTally;
}

/**
 * The text page blocks Translate plans over — exactly `pageTextChunks(pages)`
 * (same page numbers, same `text`) — with `send` attached where the gate in
 * the module docblock passes. The ONE place that gate runs.
 */
export function translatePageBlocks(
  pages: readonly Pick<ReadingOrderPage, "pageNumber" | "text" | "send">[],
): TranslatePageBlocks {
  const tally: ReadingOrderTally = {
    flowPages: 0,
    layoutPages: 0,
    fellBack: { ink: 0, longer: 0, rtl: 0 },
  };
  const blocks: TranslatePageBlock[] = [];
  for (const page of pages) {
    // pageTextChunks' own rule, applied to the same text: normalise, then
    // keep only pages with text. `send` can never add a page.
    const text = normalizeExtractedText(page.text);
    if (text.length === 0) continue;
    if (page.send === undefined) {
      tally.layoutPages += 1;
      blocks.push({ pageNumber: page.pageNumber, text });
      continue;
    }
    const send = normalizeExtractedText(page.send);
    const reason =
      isStrongRtl(text) || isStrongRtl(send)
        ? "rtl"
        : !sameInk(text, send)
          ? "ink"
          : send.length > text.length
            ? "longer"
            : null;
    if (reason === null) {
      tally.flowPages += 1;
      blocks.push({ pageNumber: page.pageNumber, text, send });
    } else {
      tally.fellBack[reason] += 1;
      tally.layoutPages += 1;
      blocks.push({ pageNumber: page.pageNumber, text });
    }
  }
  return { blocks, tally };
}

/**
 * Translate's extractor: `-layout` first, exactly as before, then — only for
 * a document with translatable text — `-bbox-layout`, whose flow text is
 * attached to each page as `send`, RAW. It does not gate:
 * {@link translatePageBlocks} gates once, where the text is consumed.
 *
 * `text`, `characterCount`, `hasText` and every page's `text` stay the
 * `-layout` reading, so everything that weighs or describes the document is
 * unchanged. Any failure of the second run is an extraction that is no worse
 * than before (`bbox_failed`, every page sent as `-layout`) — the allowance
 * was charged when the job was created, so failing the job here would charge
 * for nothing — EXCEPT an attempt abort, which is rethrown first.
 */
export function composeReadingOrderExtractor(
  layout: LayoutExtractor,
  flow: PdfFlowExtractor,
): TranslateExtractor {
  return async (bytes, run) => {
    const extracted = await layout(bytes, run);
    if (!hasTranslatableText(extracted)) {
      return { ...extracted, readingOrder: { source: "not_run" } };
    }
    let flowed: PdfFlowText;
    try {
      flowed = await flow(bytes, run);
    } catch (err) {
      rethrowIfAttemptAbort(err);
      return { ...extracted, readingOrder: { source: "bbox_failed" } };
    }
    // Both parsers number pages by position, so a count mismatch means the
    // pairing is unknowable: no page carries flow.
    if (flowed.pageCount !== extracted.pageCount) {
      return { ...extracted, readingOrder: { source: "page_count" } };
    }
    const flowByPage = new Map(
      flowed.pages.map((page) => [page.pageNumber, flowPageText(page)]),
    );
    const pages: ReadingOrderPage[] = extracted.pages.map((page) => {
      const send = flowByPage.get(page.pageNumber);
      return send === undefined ? page : { ...page, send };
    });
    return { ...extracted, pages, readingOrder: { source: "flow" } };
  };
}
