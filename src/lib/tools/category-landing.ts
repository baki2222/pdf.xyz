import { guides, type Guide } from "@/lib/guides";
import { categories, getCategory, getToolsByCategory } from "./index";
import { categoryHref } from "./category-href";
import { categoryPageCopy, type CategoryPageCopy } from "./category-pages";
import { processingMeta } from "./processing";
import type {
  ProcessingMode,
  Tool,
  ToolCategory,
  ToolCategoryId,
} from "./types";

export interface CategoryLanding {
  readonly category: ToolCategory;
  readonly copy: CategoryPageCopy;
  readonly path: string;
  /** The category's tools, in catalogue order — the list the page renders. */
  readonly tools: readonly Tool[];
  /**
   * How many of those tools run in each place, in `processingMeta` order, with
   * empty modes dropped. COUNTED from each tool's own `processing`, never
   * typed: see the note on `categoryPageCopy`.
   */
  readonly runs: readonly {
    mode: ProcessingMode;
    label: string;
    count: number;
  }[];
  /**
   * Guides that name one of this category's tools in their own `tools` field —
   * the same relationship the tool page's Guides band discovers from, so a
   * category page cannot link a guide that does not claim one of its tools.
   */
  readonly guides: readonly Guide[];
  /** Every OTHER category, for the cross-links at the foot of the page. */
  readonly siblings: readonly ToolCategory[];
}

/** The ids the category route prerenders — `categories`, never a typed list. */
export function categoryIds(): ToolCategoryId[] {
  return categories.map((category) => category.id);
}

export function getCategoryLanding(id: string): CategoryLanding | undefined {
  const category = getCategory(id as ToolCategoryId);
  if (!category) return undefined;
  const tools = getToolsByCategory(category.id);
  const slugs = new Set(tools.map((tool) => tool.slug));
  const runs = (Object.keys(processingMeta) as ProcessingMode[])
    .map((mode) => ({
      mode,
      label: processingMeta[mode].label,
      count: tools.filter((tool) => tool.processing === mode).length,
    }))
    .filter((entry) => entry.count > 0);
  return {
    category,
    copy: categoryPageCopy[category.id],
    path: categoryHref(category.id),
    tools,
    runs,
    guides: guides.filter((guide) =>
      guide.tools.some((slug) => slugs.has(slug)),
    ),
    siblings: categories.filter((other) => other.id !== category.id),
  };
}
