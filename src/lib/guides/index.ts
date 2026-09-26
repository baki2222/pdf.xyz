import { guides } from "./catalog";
import type { Guide, GuideFaqEntry, GuideSection } from "./types";
import { getToolBySlug } from "@/lib/tools";

export { guides };
export type { Guide, GuideFaqEntry, GuideSection };

export function getGuideBySlug(slug: string): Guide | undefined {
  return guides.find((guide) => guide.slug === slug);
}

export function getAllGuideSlugs(): string[] {
  return guides.map((guide) => guide.slug);
}

/**
 * The guides that teach `toolSlug` — DISCOVERED from each guide's own `tools`
 * field. The tool page's Guides band renders from this, so it cannot link a
 * guide that does not claim the tool back; there is no hand-typed href list
 * anywhere for the two to drift apart across.
 */
export function guidesForTool(toolSlug: string): Guide[] {
  return guides.filter((guide) => guide.tools.includes(toolSlug));
}

/** How many links a guide page gives to other guides. */
export const RELATED_GUIDE_LIMIT = 3;

function categoriesOf(guide: Guide): Set<string> {
  return new Set(
    guide.tools
      .map((slug) => getToolBySlug(slug)?.category)
      .filter((id): id is NonNullable<typeof id> => id !== undefined),
  );
}

/**
 * How close `other` is to `guide`, from the `tools` field alone: tools both
 * teach first, then tool categories both touch. A shared tool always outranks
 * any number of shared categories — they are compared in that order, not
 * summed.
 */
export function guideAffinity(
  guide: Guide,
  other: Guide,
): { tools: number; categories: number } {
  const mine = categoriesOf(guide);
  return {
    tools: other.tools.filter((t) => guide.tools.includes(t)).length,
    categories: [...categoriesOf(other)].filter((c) => mine.has(c)).length,
  };
}

/**
 * The other guides a guide page links, closest first — DERIVED from the
 * guides' `tools` fields, never a hand-typed list, so a new guide is linked
 * from its neighbours by existing.
 *
 * Ranked by {@link guideAffinity}, ties in catalogue order. A guide with
 * fewer than `limit` neighbours is filled from the rest of the catalogue in
 * order, because a guide page that links no other guide is a dead end for
 * the reader and for a crawler alike. The page's heading ("More guides")
 * claims nothing about relatedness, so the filler is not presented as a
 * neighbour it is not.
 */
export function relatedGuides(
  guide: Guide,
  limit = RELATED_GUIDE_LIMIT,
): Guide[] {
  return guides
    .filter((other) => other.slug !== guide.slug)
    .map((other, index) => ({
      other,
      index,
      score: guideAffinity(guide, other),
    }))
    .sort(
      (a, b) =>
        b.score.tools - a.score.tools ||
        b.score.categories - a.score.categories ||
        a.index - b.index,
    )
    .slice(0, limit)
    .map(({ other }) => other);
}
