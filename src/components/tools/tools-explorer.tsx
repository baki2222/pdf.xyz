"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { categories, getCategoryCounts, toolCount, tools } from "@/lib/tools";
import { searchTools } from "@/lib/tools/search-tools";
import type { Tool } from "@/lib/tools/types";
import { categoryHref } from "@/lib/tools/category-href";
import {
  parseToolsQuery,
  toolsSearch,
  type ToolsFilter,
  type ToolsQuery,
} from "@/lib/tools/tools-query";
import { ToolCard } from "@/components/tools/tool-card";
import { cn } from "@/lib/utils";

const counts = getCategoryCounts();

/** How long typing must pause before the result count is announced. */
export const ANNOUNCE_DELAY_MS = 400;

const noSubscription = () => () => {};

/**
 * The words a screen reader hears after the grid changes. One sentence for
 * every state, including the empty one — "No tools found" used to be a plain
 * div that mounted silently (WCAG 4.1.3).
 */
export function resultAnnouncement(count: number, state: ToolsQuery): string {
  const q = state.query.trim();
  const category =
    state.category === "all"
      ? undefined
      : categories.find((c) => c.id === state.category)?.name;
  if (count === 0) {
    return q
      ? `No tools match “${q}”${category ? ` in ${category}` : ""}`
      : "No tools found";
  }
  return `${count} ${count === 1 ? "tool" : "tools"}${q ? ` for “${q}”` : ""}${category ? ` in ${category}` : ""}`;
}

/**
 * The tool catalogue's search-and-filter grid.
 *
 * PRERENDERED WITH EVERY TOOL. `/tools` no longer reads `searchParams` on the
 * server, so its static HTML is the unfiltered grid — fifty internal links a
 * crawler reads without running script. A `?category=` or `?q=` deep link is
 * applied after hydration from `window.location` (see `parseToolsQuery`);
 * until the reader touches a control, the URL is left exactly as they arrived
 * with.
 *
 * HEADINGS. Grouped under an `<h2>` per category (each linking that category's
 * landing page) when there is no search; a search shows one flat list under a
 * visually hidden "Search results" `<h2>`, so matches are not scattered across
 * category headings. Either way the cards' `<h3>`s sit under an `<h2>` — the
 * page used to jump from its `<h1>` straight to fifty `<h3>`s.
 */
export function ToolsExplorer() {
  // The server snapshot is "" — the prerendered, unfiltered grid. On the
  // client React re-renders once with the real query string after hydration.
  const search = useSyncExternalStore(
    noSubscription,
    () => window.location.search,
    () => "",
  );
  const linked = useMemo(() => parseToolsQuery(search), [search]);
  // `null` until the reader changes something: the deep link rules until then.
  const [chosen, setChosen] = useState<ToolsQuery | null>(null);
  const active: ToolsFilter = chosen?.category ?? linked.category;
  const query = chosen?.query ?? linked.query;
  const setActive = (category: ToolsFilter) => setChosen({ category, query });
  const setQuery = (next: string) =>
    setChosen({ category: active, query: next });

  // Keep the URL shareable (?category=…&q=…) without triggering a navigation.
  // Skipped until the reader acts, so first paint cannot strip a deep link.
  useEffect(() => {
    if (!chosen) return;
    const qs = toolsSearch(window.location.search, chosen);
    window.history.replaceState(null, "", `${window.location.pathname}${qs}`);
  }, [chosen]);

  const trimmed = query.trim();
  const results = useMemo(() => {
    const matched = trimmed ? searchTools(trimmed) : tools;
    return active === "all"
      ? matched
      : matched.filter((tool) => tool.category === active);
  }, [trimmed, active]);

  // One always-mounted live region, debounced so typing "compress" is not
  // read out letter by letter, and silent on load so the page does not open
  // by announcing "50 tools".
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (!chosen) return;
    const text = resultAnnouncement(results.length, {
      category: active,
      query: trimmed,
    });
    const timer = setTimeout(() => setAnnouncement(text), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [chosen, results.length, active, trimmed]);

  const groups = useMemo(
    () =>
      categories
        .map((category) => ({
          category,
          tools: results.filter((tool) => tool.category === category.id),
        }))
        .filter((group) => group.tools.length > 0),
    [results],
  );

  const filters: { id: ToolsFilter; label: string; count: number }[] = [
    { id: "all", label: "All tools", count: toolCount },
    ...categories.map((c) => ({
      id: c.id as ToolsFilter,
      label: c.short,
      count: counts[c.id],
    })),
  ];

  return (
    <div className="flex flex-col gap-6">
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {announcement}
      </p>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <label className="relative w-full lg:max-w-md">
          <Search
            className="text-muted pointer-events-none absolute top-1/2 left-4 size-4.5 -translate-y-1/2"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${toolCount} tools — merge, compress, sign…`}
            aria-label="Search tools"
            className="bg-panel border-line placeholder:text-faint focus:border-accent/40 focus-visible:ring-accent/50 text-fg h-12 w-full rounded-[3px] border pr-11 pl-11 text-sm transition outline-none focus-visible:ring-2"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="text-muted hover:bg-wash hover:text-fg absolute top-1/2 right-3.5 grid size-6 -translate-y-1/2 place-items-center rounded-md transition"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </label>
        <p className="text-muted inline-flex items-center gap-2 text-sm">
          <SlidersHorizontal className="size-4" aria-hidden />
          <span className="tabular-nums">{results.length}</span>
          {results.length === 1 ? " tool" : " tools"}
        </p>
      </div>

      <div
        className="-mx-1 flex flex-wrap gap-2 px-1"
        role="group"
        aria-label="Filter by category"
      >
        {filters.map((filter) => {
          const selected = active === filter.id;
          return (
            <button
              key={filter.id}
              type="button"
              aria-pressed={selected}
              onClick={() => setActive(filter.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-[2px] border px-3.5 py-1.5 text-sm font-medium transition-colors",
                selected
                  ? "bg-invert text-fg-invert border-transparent"
                  : "border-line text-muted hover:border-line-strong hover:bg-wash hover:text-fg",
              )}
            >
              {filter.label}
              <span
                className={cn(
                  "text-xs tabular-nums",
                  selected ? "text-fg-invert/70" : "text-faint",
                )}
              >
                {filter.count}
              </span>
            </button>
          );
        })}
      </div>

      {results.length === 0 ? (
        <div className="border-line-strong bg-wash flex flex-col items-center gap-3 rounded-[4px] border border-dashed px-6 py-16 text-center">
          <p className="text-fg text-lg font-semibold">No tools found</p>
          <p className="text-muted max-w-sm text-sm">
            Nothing matches “{query}”. Try a different search, or clear the
            filters to see all {toolCount} tools.
          </p>
          <button
            type="button"
            onClick={() => setChosen({ category: "all", query: "" })}
            className="border-line-strong hover:bg-wash text-fg mt-1 rounded-[3px] border px-4 py-2 text-sm font-medium transition-colors"
          >
            Reset filters
          </button>
        </div>
      ) : trimmed ? (
        <section className="flex flex-col gap-3">
          <h2 className="sr-only">Search results</h2>
          <ToolGrid tools={results} />
        </section>
      ) : (
        <div className="flex flex-col gap-12">
          {groups.map(({ category, tools: groupTools }) => (
            <section
              key={category.id}
              aria-labelledby={`tools-group-${category.id}`}
              className="flex flex-col gap-3"
            >
              <div className="flex flex-col gap-1">
                <h2
                  id={`tools-group-${category.id}`}
                  className="font-display text-fg text-2xl font-medium tracking-tight"
                >
                  <Link
                    href={categoryHref(category.id)}
                    className="hover:text-accent transition-colors"
                  >
                    {category.name}
                  </Link>
                  <span className="text-faint ml-2.5 align-middle font-mono text-xs font-normal tracking-normal">
                    {groupTools.length}
                  </span>
                </h2>
                <p className="text-muted text-sm leading-relaxed">
                  {category.description}
                </p>
              </div>
              <ToolGrid tools={groupTools} />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function ToolGrid({ tools: list }: { tools: readonly Tool[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {list.map((tool) => (
        <ToolCard key={tool.slug} tool={tool} />
      ))}
    </div>
  );
}
