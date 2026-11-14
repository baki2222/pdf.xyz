// @vitest-environment node
/**
 * Auto-crop's words for pages it keeps whole (`wholeNote`): every list shape
 * the runner can show. History (hostile review r2, 2026-11-14): only the
 * one-page form was exercised, so dropping "and" or "and N more" from the
 * list left every suite green.
 */
import { describe, expect, it } from "vitest";
import { wholeNote } from "./auto-crop-render";

describe("wholeNote", () => {
  it("one page: singular, 1-based", () => {
    expect(wholeNote([2]).summary).toBe(
      "Page 3 has a large image whose position could not be worked out, so it is left uncropped; crop by hand to trim it.",
    );
  });

  it("two pages: joined by 'and', plural throughout", () => {
    expect(wholeNote([1, 4]).summary).toBe(
      "Pages 2 and 5 have large images whose positions could not be worked out, so they are left uncropped; crop by hand to trim them.",
    );
  });

  it("three to eight: commas, then 'and' before the last", () => {
    expect(wholeNote([0, 1, 2]).summary).toMatch(/^Pages 1, 2 and 3 have /);
    expect(wholeNote([0, 1, 2, 3, 4, 5, 6, 7]).summary).toMatch(
      /^Pages 1, 2, 3, 4, 5, 6, 7 and 8 have /,
    );
  });

  it("past eight: the first eight, then 'and N more'", () => {
    const ten = Array.from({ length: 10 }, (_, i) => i);
    expect(wholeNote(ten).summary).toMatch(
      /^Pages 1, 2, 3, 4, 5, 6, 7, 8 and 2 more have /,
    );
  });

  it("the per-page sentence names no number", () => {
    expect(wholeNote([0, 1]).page).toBe(
      "This page has a large image whose position could not be worked out, so it is left uncropped. Crop it by hand to trim it.",
    );
  });
});
