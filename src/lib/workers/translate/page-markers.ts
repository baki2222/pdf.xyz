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
 * What may sit INSIDE the brand, or between its parts, without hiding it:
 * whitespace (NBSP included, which NFKC also maps to a space) and format
 * characters (`\p{Cf}`: zero-width space, soft hyphen, bidi marks). A model
 * that breaks the brand with one of these must still be recognised, or
 * `<<<PDF XYZ_PAGE_2>>>` ships as visible text. Punctuation is NOT a gap:
 * "pdf.xyz", this product's own name, and "pdf-xyz" are ordinary text.
 */
export const MARKER_GAP = String.raw`[\s\p{Cf}]*`;

/** `word`'s letters with a {@link MARKER_GAP} between each two. */
export function gapped(word: string): string {
  return Array.from(word).join(MARKER_GAP);
}

/**
 * The brand, as both the collision rule and the reader find it: "pdfxyz"
 * with any {@link MARKER_GAP} between its letters, tested on
 * {@link foldForMarker}'s form. A page whose sent text matches makes its
 * chunk unmarked. That is what makes stripping safe in a marked chunk: the
 * source held no brand, so any brand in the reply is ours or the model's,
 * never the document's.
 */
export const MARKER_COLLISION = new RegExp(gapped("pdfxyz"), "iu");

/**
 * One character in the marker's folded form: its own NFKC, lower-cased.
 * Per CHARACTER, never per string: a whole-string NFKC composes "z" plus a
 * combining acute into one letter and so hides a brand that the per-character
 * reader in `./page-map` then strips. Both sides call this, so a page judged
 * safe is never stripped as marker text.
 */
export function foldChar(c: string): string {
  return (c.charCodeAt(0) < 0x80 ? c : c.normalize("NFKC")).toLowerCase();
}

/** `text` folded character by character ({@link foldChar}). */
export function foldForMarker(text: string): string {
  let out = "";
  for (const c of text) out += foldChar(c);
  return out;
}

/**
 * The collision rule, on the reader's folded form. A full-width "PDFXYZ"
 * (U+FF30 ...), a brand broken by a space or a zero-width character, or one
 * followed by a combining mark collides too, or the reader would strip the
 * document's own text.
 */
export function collidesWithMarker(text: string): boolean {
  return MARKER_COLLISION.test(foldForMarker(text));
}
