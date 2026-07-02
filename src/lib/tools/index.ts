import { tools } from "./catalog";
import { categories, getCategory } from "./categories";
import type {
  ProcessingMode,
  Tool,
  ToolBadge,
  ToolCategory,
  ToolCategoryId,
} from "./types";

export { tools, categories, getCategory };
export type {
  Tool,
  ToolCategory,
  ToolCategoryId,
  ProcessingMode,
  ToolBadge,
};

const bySlug = new Map<string, Tool>(tools.map((tool) => [tool.slug, tool]));

/** Total number of tools in the catalog. */
export const toolCount = tools.length;

export function getToolBySlug(slug: string): Tool | undefined {
  return bySlug.get(slug);
}

export function getAllToolSlugs(): string[] {
  return tools.map((tool) => tool.slug);
}

export function getToolsByCategory(categoryId: ToolCategoryId): Tool[] {
  return tools.filter((tool) => tool.category === categoryId);
}

export function getFeaturedTools(limit?: number): Tool[] {
  const featured = tools.filter((tool) => tool.featured);
  return typeof limit === "number" ? featured.slice(0, limit) : featured;
}

export function getPopularTools(limit = 8): Tool[] {
  return tools
    .filter((tool) => tool.badge === "popular" || tool.featured)
    .slice(0, limit);
}

export function getAiTools(): Tool[] {
  return getToolsByCategory("ai");
}

/** Resolve a tool's `related` slugs into full Tool objects. */
export function getRelatedTools(tool: Tool, limit = 3): Tool[] {
  const related = (tool.related ?? [])
    .map((slug) => bySlug.get(slug))
    .filter((candidate): candidate is Tool => Boolean(candidate));
  return related.slice(0, limit);
}

/** Group every category with its tools, preserving category order. */
export function getToolsGroupedByCategory(): {
  category: ToolCategory;
  tools: Tool[];
}[] {
  return categories.map((category) => ({
    category,
    tools: getToolsByCategory(category.id),
  }));
}

/** Count of tools per category, keyed by category id. */
export function getCategoryCounts(): Record<ToolCategoryId, number> {
  const counts = {} as Record<ToolCategoryId, number>;
  for (const category of categories) {
    counts[category.id] = getToolsByCategory(category.id).length;
  }
  return counts;
}

/** Lightweight fuzzy search over name, tagline, and keywords. */
export function searchTools(query: string): Tool[] {
  const q = query.trim().toLowerCase();
  if (!q) return tools;
  return tools.filter((tool) => {
    const haystack = [
      tool.name,
      tool.tagline,
      tool.description,
      ...tool.keywords,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}
