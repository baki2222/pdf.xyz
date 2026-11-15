/**
 * The ONE gate for the Overlay's only reassuring sentence (S3,
 * 2026-11-15). "No differences visible at this resolution" may be said
 * only when every pair in scope was drawn on both sides, diffed, and found
 * no region, no shift and no size difference, and nothing in scope was
 * skipped, refused, undecoded, blank against its text, unpaired or
 * stopped. Each of those is a key below, and `visual-claim.test.ts`
 * enumerates them: a bad value of ANY key closes the gate.
 *
 * The phrase is written once, here ({@link NO_VISIBLE_DIFFERENCE}); the
 * single-site guard in the test walks src/components and src/lib for it.
 * It names its own limit ("at this resolution"), and the sentence names
 * the dpi actually used, which is lower for pages larger than about 13
 * inches, and that the comparison is in grayscale.
 */

export interface ClaimState {
  /** Pairs in scope: 1 for one page, N for Check all. */
  pairsTotal: number;
  /** Pairs with BOTH planes captured and diffed. */
  pairsChecked: number;
  /** Pages with no partner (the two files' page counts differ). */
  unpaired: number;
  /** An image or page budget refusal, an unread map, an open failure. */
  refused: string | null;
  /** A page that failed to draw, a capture missing, out of memory. */
  failed: number;
  /** Pairs where pdf.js could not decode an image on either side. */
  undecoded: number;
  /** Pairs drawn blank on BOTH sides while the text layer has text there. */
  blankWithText: number;
  /** Pairs whose two pages differ in size (or orientation). */
  sizeDiffers: number;
  /** Pairs lined up by moving PDF 2's page: the move is a difference. */
  shifted: number;
  /** Pairs with at least one differing region. */
  withRegions: number;
  /** The person stopped the scan. */
  aborted: boolean;
}

/** The only state the gate opens for, with one pair: the positive control. */
export const CLEAN_CLAIM_STATE = {
  pairsTotal: 1,
  pairsChecked: 1,
  unpaired: 0,
  refused: null,
  failed: 0,
  undecoded: 0,
  blankWithText: 0,
  sizeDiffers: 0,
  shifted: 0,
  withRegions: 0,
  aborted: false,
} as const satisfies ClaimState;

/** Every key checked explicitly; `pairsTotal > 0`, since `[] ⊆ X` is vacuous. */
export function canClaimNoVisualDiff(s: ClaimState): boolean {
  return (
    s.pairsTotal > 0 &&
    s.pairsChecked === s.pairsTotal &&
    s.unpaired === 0 &&
    s.refused === null &&
    s.failed === 0 &&
    s.undecoded === 0 &&
    s.blankWithText === 0 &&
    s.sizeDiffers === 0 &&
    s.shifted === 0 &&
    s.withRegions === 0 &&
    s.aborted === false
  );
}

export const NO_VISIBLE_DIFFERENCE =
  "No differences visible at this resolution";

/**
 * The sentence, or null unless the gate opens. `minDpi` is the LOWEST dpi
 * any checked page was drawn at, so a large page's lower resolution is the
 * one named.
 */
export function noVisualDifferenceSentence(
  s: ClaimState,
  minDpi: number,
): string | null {
  if (!canClaimNoVisualDiff(s)) return null;
  const dpi = `about ${Math.round(minDpi)} dpi, in grayscale`;
  return s.pairsTotal === 1
    ? `${NO_VISIBLE_DIFFERENCE} (${dpi}).`
    : `${NO_VISIBLE_DIFFERENCE} on any of the ${s.pairsTotal.toLocaleString("en-US")} pages (${dpi}).`;
}
