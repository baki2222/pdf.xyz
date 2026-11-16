/**
 * The page marker: one line placed BETWEEN two pages of a multi-page chunk, so
 * a reply can be split back into the pages it came from (`./page-map`).
 *
 * A pure leaf with no import beyond {@link PAGE_JOIN}. It is client-reachable
 * (`./chunking` → `./preflight` → the Translate panel's lazy chunk), so it
 * stays tiny and no first-load module may import it.
 *
 * ── THE FORMAT ──────────────────────────────────────────────────────────────
 *
 * `<<<PDFXYZ_PAGE_${n}>>>` on a line of its own, where `n` is the real page
 * number of the page that BEGINS after it. ASCII, and no word of any target
 * language: an all-caps identifier between brackets reads as code, which a
 * translator copies, and the digits are the one thing the system prompt
 * already tells the model to keep. The brand token is what makes the
 * collision rule ({@link MARKER_COLLISION}) a single cheap test.
 *
 * Markers go only between pages. A one-page chunk carries none, so a page
 * alone never pays for one and no page becomes oversize that would otherwise
 * have been translated.
 *
 * The tests: `page-markers.test.ts` (lengths, ASCII, collision),
 * `chunking.markers.test.ts` (sizing, budget, delivered set).
 */

import { PAGE_JOIN } from "@/lib/pdf/text";

/** The marker line that precedes page `n` inside a marked chunk. */
export function markerFor(n: number): string {
  return `<<<PDFXYZ_PAGE_${n}>>>`;
}

/**
 * What stands between two pages of a marked chunk, in place of a bare
 * {@link PAGE_JOIN}: `PAGE_JOIN + markerFor(n) + PAGE_JOIN`. Its length is
 * `22 + digits(n)`.
 */
export function separatorFor(n: number): string {
  return PAGE_JOIN + markerFor(n) + PAGE_JOIN;
}

/**
 * What a marked boundary before page `n` costs OVER a plain {@link PAGE_JOIN}:
 * `20 + digits(n)`. The unit of the marker budget and of
 * `pageMap.markerCharacters`.
 */
export function separatorOverhead(n: number): number {
  return separatorFor(n).length - PAGE_JOIN.length;
}

/**
 * A page whose sent text matches this (in its NFKC form, see
 * {@link collidesWithMarker}) makes its chunk unmarked. That is what makes
 * stripping safe in a marked chunk: the source held no "pdfxyz", so any
 * "pdfxyz" in the reply is ours or the model's, never the document's.
 */
export const MARKER_COLLISION = /pdfxyz/i;

/**
 * The collision rule, on the reader's normal form. `./page-map` recognises
 * markers after NFKC, so a page holding a full-width "PDFXYZ" (U+FF30 ...) must collide
 * too, or the reader would strip the document's own text.
 */
export function collidesWithMarker(text: string): boolean {
  return MARKER_COLLISION.test(text.normalize("NFKC"));
}
