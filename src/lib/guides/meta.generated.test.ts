// @vitest-environment node
/**
 * The guides' search metadata is the catalogue's, regenerated — never edited.
 *
 * WHY A GENERATED FILE. The command palette ranks guides in the browser, from
 * a lazy chunk with a 12 KB gz budget. `catalog.ts` is the whole article set
 * (steps, sections, FAQs) and imports a dozen modules to interpolate its
 * figures, so the palette cannot import it. `meta.generated.ts` is the five
 * fields the palette reads, written by `pnpm guides:meta`.
 *
 * A COPY GOES STALE. So this compares the generated file with a fresh
 * projection of the catalogue, in full, and fails on any drift — a title
 * edited, a guide added, a keyword dropped. The positive control mutates a
 * COPY of the catalogue and proves the same comparison sees it; without it,
 * a projection that returned the generated file (or nothing, against an
 * empty file) would pass for ever.
 */
import { describe, expect, it } from "vitest";
import { guides } from "./catalog";
import { GUIDE_META } from "./meta.generated";
import { projectGuideMeta } from "./meta";

describe("meta.generated.ts", () => {
  it("health check: the catalogue and the generated file are both real", () => {
    expect(guides.length).toBeGreaterThanOrEqual(10);
    expect(GUIDE_META.length).toBeGreaterThanOrEqual(10);
  });

  it("equals a fresh projection of the catalogue (run `pnpm guides:meta`)", () => {
    expect(GUIDE_META).toEqual(projectGuideMeta(guides));
  });

  it("carries exactly the five fields the palette reads", () => {
    for (const meta of GUIDE_META) {
      expect(Object.keys(meta).sort()).toEqual(
        ["description", "keywords", "primary", "slug", "title"].sort(),
      );
    }
  });

  it("the primary is each guide's first tool", () => {
    for (const guide of guides) {
      const meta = GUIDE_META.find((m) => m.slug === guide.slug);
      expect(meta?.primary, guide.slug).toBe(guide.tools[0]);
    }
  });

  it("positive control: a catalogue changed without regenerating fails the comparison", () => {
    // A mutation in a COPY of the catalogue: the real one is untouched, so
    // the equality above still describes the shipped file.
    const copy = guides.map((g) => ({ ...g }));
    copy[0] = { ...copy[0]!, title: `${copy[0]!.title} (edited)` };
    expect(projectGuideMeta(copy)).not.toEqual(GUIDE_META);
    const added = [...guides, { ...guides[0]!, slug: "a-new-guide" }];
    expect(projectGuideMeta(added)).not.toEqual(GUIDE_META);
    const keywords = guides.map((g, i) =>
      i === 1 ? { ...g, keywords: g.keywords.slice(1) } : g,
    );
    expect(projectGuideMeta(keywords)).not.toEqual(GUIDE_META);
  });
});
