import { categories } from "./categories";
import type { ToolCategoryId } from "./types";

export type ToolsFilter = ToolCategoryId | "all";

export interface ToolsQuery {
  readonly category: ToolsFilter;
  readonly query: string;
}

const CATEGORY_IDS = new Set<string>(categories.map((c) => c.id));

/**
 * Read `/tools?category=…&q=…` into explorer state.
 *
 * This used to happen on the SERVER: `tools/page.tsx` awaited `searchParams`,
 * which made `/tools` dynamic — `Cache-Control: private, no-store`, a server
 * render on the one-vCPU origin for every hit and every prefetch of the page
 * that links all fifty tools (measured on production). The route is
 * now prerendered with the full grid in its HTML, and the explorer applies
 * this after hydration, so old shared filter URLs and the WebSite
 * SearchAction's `/tools?q=` template keep working.
 *
 * An unknown category is `"all"`, never an empty grid.
 */
export function parseToolsQuery(search: string): ToolsQuery {
  const params = new URLSearchParams(search);
  const category = params.get("category");
  return {
    category:
      category !== null && CATEGORY_IDS.has(category)
        ? (category as ToolCategoryId)
        : "all",
    query: params.get("q") ?? "",
  };
}

/**
 * The query string the explorer writes back for a filter, keeping any other
 * parameter the reader arrived with (a campaign tag, say). `""` for the
 * unfiltered view.
 */
export function toolsSearch(current: string, state: ToolsQuery): string {
  const params = new URLSearchParams(current);
  if (state.category === "all") params.delete("category");
  else params.set("category", state.category);
  const q = state.query.trim();
  if (q) params.set("q", q);
  else params.delete("q");
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
