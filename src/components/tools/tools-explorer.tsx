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
            className="pointer-events-none absolute top-1/2 left-4 size-4.5 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${toolCount} tools — merge, compress, sign…`}
            aria-label="Search tools"
            className="bg-surface-2 h-12 w-full rounded-full border border-white/10 pr-11 pl-11 text-sm text-white transition outline-none placeholder:text-slate-400 focus:border-violet-400/50 focus:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-violet-400/50"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute top-1/2 right-3.5 grid size-6 -translate-y-1/2 place-items-center rounded-md text-slate-400 transition hover:bg-white/10 hover:text-white"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </label>
        <p className="inline-flex items-center gap-2 text-sm text-slate-400">
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
                "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                selected
                  ? "text-ink border-transparent bg-white"
                  : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:text-white",
              )}
            >
              {filter.label}
              <span
                className={cn(
                  "text-xs tabular-nums",
                  selected ? "text-ink/60" : "text-slate-400",
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
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-16 text-center">
          <p className="text-lg font-semibold text-white">No tools found</p>
          <p className="max-w-sm text-sm text-slate-400">
            Nothing matches “{query}”. Try a different search, or clear the
            filters to see all {toolCount} tools.
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setActive("all");
            }}
            className="mt-1 rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/5 hover:text-white"
          >
            Reset filters
          </button>
        </div>
      )}
    </div>
  );
}
