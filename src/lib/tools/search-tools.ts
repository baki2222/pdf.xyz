/**
 * The catalogue's search: `@/lib/intent/search` over the tools.
 *
 * Its own module, not part of `./index`, on purpose: the catalogue module
 * rides every tool page, the workspace and `/status`, and none of them
 * search. Kept here, the ranking, the synonym groups and the task aliases load
 * only where a search runs — the `/tools` explorer, and the 404's lazily
 * loaded "Did you mean".
 */
import {
  buildIndex,
  search,
  toolDocs,
  type SearchIndex,
  type ToolDoc,
} from "@/lib/intent/search";
import { tools } from "./catalog";
import type { Tool } from "./types";

let index: SearchIndex<ToolDoc<Tool>> | undefined;

/** The catalogue's search index, built on first use and kept. */
export function toolSearchIndex(): SearchIndex<ToolDoc<Tool>> {
  index ??= buildIndex(toolDocs(tools));
  return index;
}

/**
 * The tools that match EVERY word of `query`, best first; the whole
 * catalogue for a blank query, nothing for one with no words ("???").
 *
 * Strictly the "all" mode of the ranked search: a caller that offers the
 * result as a suggestion (the 404's "Did you mean") must never receive the
 * "closest" fallback's guesses. The explorer, which labels its fallback,
 * calls `search` itself.
 */
export function searchTools(query: string): Tool[] {
  const { results, mode } = search(toolSearchIndex(), query);
  return mode === "all" ? results.map((doc) => doc.tool) : [];
}
