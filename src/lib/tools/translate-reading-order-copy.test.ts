/**
 * Translate PDF's column-order sentence stays TRUE ON BOTH WORKER IMAGES.
 *
 * The web tier deploys on merge; the worker image is rebuilt by hand. So the
 * sentence in useCases[1] is read beside an old image (which always sends a
 * two-column page line by line across it) and a new one (which sends flow
 * text column by column, except on every page that falls back to `-layout`:
 * right-to-left scripts, ink that differs, a failed or mismatched flow run).
 * The both-states form keeps the DISCLOSURE — removing it would be a positive
 * claim by omission, false of those fallback pages on both images.
 *
 * Until slice 5 (after `translateReadingOrder` is observed live and one real
 * two-column job is decoded) this must stay a disclosure, and slice 5's
 * positive sentence must keep a fallback clause while any fallback exists.
 */
import { describe, expect, it } from "vitest";
import { getToolContent } from "./content";

describe("translate-pdf useCases[1]: the column-order disclosure", () => {
  const member = getToolContent("translate-pdf")?.useCases?.[1];

  it("health: the member exists and is the column-order sentence", () => {
    expect(member?.body).toMatch(/two-column paper/i);
  });

  it("still discloses that columns can reach the model interleaved", () => {
    expect(member?.body).toMatch(/interleav/i);
    expect(member?.body).toMatch(/\bcan send\b/i);
  });

  it("makes no positive claim that columns are read in order", () => {
    expect(member?.body).not.toMatch(
      /columns are read in order|one (column )?after the other|column by column/i,
    );
    // The pre-reading-order sentence, true only of the old image.
    expect(member?.body).not.toMatch(/reads each line straight across/i);
  });
});
