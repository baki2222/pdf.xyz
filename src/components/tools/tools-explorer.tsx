"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import {
  categories,
  getCategoryCounts,
  searchTools,
  toolCount,
  tools,
} from "@/lib/tools";
import type { ToolCategoryId } from "@/lib/tools/types";
import { ToolCard } from "@/components/tools/tool-card";
import { cn } from "@/lib/utils";

type Filter = ToolCategoryId | "all";

const counts = getCategoryCounts();

export function ToolsExplorer({
  initialCategory = "all",
  initialQuery = "",
}: {
  initialCategory?: Filter;
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState<Filter>(initialCategory);

  // Keep the URL shareable (?category=…&q=…) without triggering a navigation.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (active === "all") params.delete("category");
    else params.set("category", active);
    if (query.trim()) params.set("q", query.trim());
    else params.delete("q");
    const qs = params.toString();
    window.history.replaceState(
      null,
      "",
      qs ? `${window.location.pathname}?${qs}` : window.location.pathname,
    );
  }, [active, query]);

  const results = useMemo(() => {
    const matched = query.trim() ? searchTools(query) : tools;
    return active === "all"
      ? matched
      : matched.filter((tool) => tool.category === active);
  }, [query, active]);

  const filters: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "All tools", count: toolCount },
    ...categories.map((c) => ({
      id: c.id as Filter,
      label: c.short,
      count: counts[c.id],
    })),
  ];

  return (
    <div className="flex flex-col gap-6">
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

      {results.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {results.map((tool) => (
            <ToolCard key={tool.slug} tool={tool} />
          ))}
        </div>
      ) : (
        <div className="border-line-strong bg-wash flex flex-col items-center gap-3 rounded-[4px] border border-dashed px-6 py-16 text-center">
          <p className="text-fg text-lg font-semibold">No tools found</p>
          <p className="text-muted max-w-sm text-sm">
            Nothing matches “{query}”. Try a different search, or clear the
            filters to see all {toolCount} tools.
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setActive("all");
            }}
            className="border-line-strong hover:bg-wash text-fg mt-1 rounded-[3px] border px-4 py-2 text-sm font-medium transition-colors"
          >
            Reset filters
          </button>
        </div>
      )}
    </div>
  );
}
