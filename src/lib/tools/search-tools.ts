/**
 * The catalogue's search: `@/lib/intent/search` over the tools.
 *
 * Its own module, not part of `./index`, on purpose: the catalogue module
 * rides every tool page, the workspace and `/status`, and none of them
 * search. And no page loads it up front — the `/tools` explorer imports it
 * when a query arrives or the search field is approached, and the 404 loads
 * its "Did you mean" lazily — so the ranking, the synonym groups, the task
 * aliases and the unsupported-format answers cost a page nothing until
 * someone searches. `lazy-chunks.test.ts` holds that, by
 * {@link SEARCH_ENGINE_CHUNK}.
 */
import {
  buildIndex,
  nearest,
  search,
  toolDocs,
  type SearchIndex,
  type SearchMode,
  type ToolDoc,
} from "@/lib/intent/search";
import {
  unsupportedAnswer,
  type UnsupportedAnswer,
} from "@/lib/intent/unsupported";
import { tools } from "./catalog";
import type { Tool } from "./types";

/**
 * A string only this module's chunk carries. The explorer renders it as the
 * `data-chunk` of its ranked results, which keeps the export alive through
 * minification, so the bundle tests can find this chunk by content.
 */
export const SEARCH_ENGINE_CHUNK = "pdfxyz:lazy:search-engine";

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
 * calls {@link rankTools}.
 */
export function searchTools(query: string): Tool[] {
  const { results, mode } = search(toolSearchIndex(), query);
  return mode === "all" ? results.map((doc) => doc.tool) : [];
}

/** Everything the explorer shows for a query. */
export interface ToolRanking {
  /** Best first. */
  readonly ranked: readonly Tool[];
  readonly mode: SearchMode;
  /** The answer to a format no tool opens, when the query names one. */
  readonly answer: UnsupportedAnswer<Tool> | null;
  /** Names within two edits, for a query that found nothing at all. */
  readonly near: readonly Tool[];
}

/** Rank the catalogue for the `/tools` explorer, fallback and answers included. */
export function rankTools(query: string): ToolRanking {
  const index = toolSearchIndex();
  const { results, mode, unsupported } = search(index, query);
  const answer = unsupported ? unsupportedAnswer(unsupported, tools) : null;
  return {
    ranked: results.map((doc) => doc.tool),
    mode,
    answer,
    near:
      mode === "empty" && !answer
        ? nearest(index, query).map((doc) => doc.tool)
        : [],
  };
}
