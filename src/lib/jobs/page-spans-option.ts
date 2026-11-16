/**
 * The WIRE half of the one page grammar: a job option naming the pages a tool
 * should read, as canonical spans. The TYPED half is `parsePageList`
 * (`@/lib/pdf/ranges`), which turns what a person writes ("1-3, 8") into
 * 0-based indices against the page count only the browser and the worker know;
 * {@link pageSpansFromIndices} is the one step between the two.
 *
 * Canonical means one spelling per selection: 1-based inclusive PHYSICAL page
 * numbers, `[[first, last], ...]`, sorted, disjoint and NON-ADJACENT. Equal
 * selections are therefore charged, echoed and compared identically — the
 * panel's echo check (`./selection-echo`) is a deep equality, which only holds
 * if there is exactly one way to write a selection. `[[1, 2], [3, 4]]` is
 * refused rather than merged, because a writer that emits it has a bug the
 * echo check would otherwise trip over later, far from the cause.
 *
 * The route cannot resolve "8-" or check "15" (it has no page count), so this
 * bounds only what it can see: at most {@link MAX_PAGE_SPANS} spans and page
 * numbers up to {@link MAX_PAGE_NUMBER}. "Page 15 of a 4-page PDF" is the
 * worker's refusal, and the browser's before it.
 *
 * Pure: `./responses` plus type-only imports. Summarize (`./summarize-pdf`)
 * is the first caller; translate's page range is meant to reuse this module
 * rather than grow a second grammar.
 */

import type { PageRange } from "@/lib/pdf/types";
import { pageSpans, type PageSpan } from "@/lib/pdf/page-spans";
import { apiError, type ParseResult } from "./responses";

/**
 * Most spans one request may name. Twenty bounds the model notice that lists
 * them, and the read-cap proof has to fit that notice inside the per-call
 * instruction allowance.
 */
export const MAX_PAGE_SPANS = 20;

/** An integer bound only; no real PDF reaches it. */
export const MAX_PAGE_NUMBER = 100_000;

function invalid(message: string, field: string): ParseResult<never> {
  return {
    ok: false,
    error: apiError("invalid_request", message, [{ field, message }]),
  };
}

/**
 * Parse an untrusted `pages` option into canonical spans, or refuse it with
 * an `invalid_request` naming `field`. Never repairs: a list out of order, or
 * two spans that touch, is refused, not sorted or merged (see the module
 * docblock for why).
 */
export function parsePageSpansOption(
  value: unknown,
  field = "pages",
): ParseResult<PageSpan[]> {
  const name = `\`${field}\``;
  if (!Array.isArray(value)) {
    return invalid(
      `${name} must be a list of [first, last] page ranges.`,
      field,
    );
  }
  if (value.length === 0) {
    return invalid(
      `${name} cannot be empty. Leave it out to use the whole document.`,
      field,
    );
  }
  if (value.length > MAX_PAGE_SPANS) {
    return invalid(
      `${name} can name at most ${MAX_PAGE_SPANS} separate page ranges.`,
      field,
    );
  }
  const spans: PageSpan[] = [];
  for (const entry of value as unknown[]) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      return invalid(
        `Each entry in ${name} must be a [first, last] pair.`,
        field,
      );
    }
    const [first, last] = entry as unknown[];
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) {
      return invalid(`Page numbers in ${name} must be whole numbers.`, field);
    }
    const a = first as number;
    const b = last as number;
    if (a < 1) {
      return invalid(`Page numbers in ${name} start at 1.`, field);
    }
    if (b > MAX_PAGE_NUMBER) {
      return invalid(
        `Page numbers in ${name} cannot be greater than ${MAX_PAGE_NUMBER.toLocaleString("en-US")}.`,
        field,
      );
    }
    if (a > b) {
      return invalid(
        `Each range in ${name} must start at or before its end.`,
        field,
      );
    }
    const prev = spans[spans.length - 1];
    if (prev && a <= prev[1]) {
      return invalid(
        `Ranges in ${name} must be in ascending order and must not overlap.`,
        field,
      );
    }
    if (prev && a === prev[1] + 1) {
      return invalid(
        `Ranges in ${name} that touch must be written as one range.`,
        field,
      );
    }
    spans.push([a, b]);
  }
  return { ok: true, value: spans };
}

/**
 * `parsePageList`'s 0-based indices as canonical 1-based spans. The ONLY
 * 0→1 conversion between typed text and the wire; sorting, de-duplication
 * and run merging are `pageSpans`'s (the one run compressor).
 */
export function pageSpansFromIndices(indices0: readonly number[]): PageSpan[] {
  return pageSpans(indices0.map((index) => index + 1));
}

/**
 * A 0-based `PageRange` (what `rangesFromStarts` returns for an outline
 * section) as a 1-based span. The ONLY 0→1 conversion between outline ranges
 * and the wire.
 */
export function pageSpanFromRange({ start, end }: PageRange): PageSpan {
  return [start + 1, end + 1];
}
