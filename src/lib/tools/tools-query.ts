import { FORMATS, formatForToken, type Format } from "@/lib/intent/formats";
import { categories } from "./categories";
import type { ToolCategoryId } from "./types";
import { runsFilter, type RunsFilter } from "./where-it-runs";

export type ToolsFilter = ToolCategoryId | "all";

export interface ToolsQuery {
  readonly category: ToolsFilter;
  readonly query: string;
  /** Only tools that take this format (`?accepts=pdf`); null for any. */
  readonly accepts: Format | null;
  /** Only tools that run here (`?runs=never-uploads`); "all" for any. */
  readonly runs: RunsFilter;
}

const CATEGORY_IDS = new Set<string>(categories.map((c) => c.id));

/**
 * `?accepts=` as a format some tool takes, in any spelling ("jpeg", "JPG"),
 * or null — an unknown value, or a format nothing here opens, filters
 * nothing rather than emptying the grid.
 */
function acceptsFormat(value: string | null): Format | null {
  if (value === null) return null;
  const format = formatForToken(value);
  return format !== null && (FORMATS as readonly string[]).includes(format)
    ? (format as Format)
    : null;
}

/**
 * Read `/tools?category=…&q=…&accepts=…&runs=…` into explorer state.
 *
 * This used to happen on the SERVER: `tools/page.tsx` awaited `searchParams`,
 * which made `/tools` dynamic — `Cache-Control: private, no-store`, a server
 * render on the one-vCPU origin for every hit and every prefetch of the page
 * that links all fifty tools (measured on production). The route is
 * now prerendered with the full grid in its HTML, and the explorer applies
 * this after hydration, so old shared filter URLs and the WebSite
 * SearchAction's `/tools?q=` template keep working. `?accepts=` and `?runs=`
 * are read the same way and never by the page, so neither can make the route
 * dynamic again, and the canonical stays `/tools` (`buildMetadata` writes
 * the static path).
 *
 * An unknown category is `"all"`, never an empty grid; so is an unknown
 * format, and so is a `runs` value the explorer does not offer.
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
    accepts: acceptsFormat(params.get("accepts")),
    runs: runsFilter(params.get("runs")),
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
  if (state.accepts === null) params.delete("accepts");
  else params.set("accepts", state.accepts.toLowerCase());
  if (state.runs === "all") params.delete("runs");
  else params.set("runs", state.runs);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
