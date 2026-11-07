// @vitest-environment node
/**
 * A guide whose title promises a file size names EVERY size the panel offers.
 *
 * Audit search-demand#2 (2026-11-06): Compress PDF's Target size and JPG to
 * PDF's Max file size both offer 100 KB, 200 KB, 500 KB and 1 MB (one list,
 * `SIZE_PRESETS`), yet the only size guides were titled "…100 KB (or 200
 * KB)". Searches for 500 KB and 1 MB, which the panels serve with one click,
 * met no page whose title named them.
 *
 * The set is DISCOVERED, not typed: every guide whose title names a size in
 * KB or MB. Each must name every preset label, so a preset added to
 * `SIZE_PRESETS` fails here until the titles catch up — and the e2e title
 * ceiling (65 with the " — pdf.xyz" suffix) is checked here too, so that
 * catch-up cannot quietly overrun a results page.
 */
import { describe, expect, it } from "vitest";
import { SIZE_PRESETS } from "@/lib/pdf/size-presets";
import { guides } from "./catalog";

const SIZE_IN_TITLE = /\b\d+ (KB|MB)\b/;
const SUFFIX = " — pdf.xyz";
const TITLE_MAX = 65;

/** The preset labels a title leaves out. */
function presetsNotNamed(title: string): string[] {
  return SIZE_PRESETS.map((p) => p.label).filter((l) => !title.includes(l));
}

describe("size guides name every size the panels offer", () => {
  const sized = guides.filter((g) => SIZE_IN_TITLE.test(g.title));

  it("finds both size guides (health check: an empty set passes vacuously)", () => {
    expect(sized.map((g) => g.slug).sort()).toEqual(
      expect.arrayContaining([
        "how-to-compress-a-pdf-to-100-kb",
        "how-to-convert-jpg-to-pdf-under-100-kb",
      ]),
    );
  });

  it("catches the titles this audit found (positive control)", () => {
    expect(
      presetsNotNamed("How to compress a PDF to 100 KB (or 200 KB)"),
    ).toEqual(["500 KB", "1 MB"]);
  });

  it.each(sized.map((g) => [g.slug, g.title]))(
    "%s names every preset",
    (_slug, title) => {
      expect(presetsNotNamed(title)).toEqual([]);
      expect((title + SUFFIX).length).toBeLessThanOrEqual(TITLE_MAX);
    },
  );
});
