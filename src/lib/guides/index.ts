import { guides } from "./catalog";
import type { Guide, GuideFaqEntry, GuideSection } from "./types";

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
