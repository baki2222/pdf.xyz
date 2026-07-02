"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { ToolIcon } from "@/components/ui/tool-icon";
import { cn } from "@/lib/utils";
import type { ProcessingMode } from "@/lib/tools/types";
import type { ToolSuggestion } from "@/lib/workspace";
import { indexSummaries, type WorkspaceToolSummary } from "./summary";

/** Accent classes for the small "where it runs" tag on each tool. */
function capabilityTone(live: boolean, processing: ProcessingMode): string {
  if (live) return "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
  switch (processing) {
    case "server":
      return "border-blue-400/30 bg-blue-400/10 text-blue-200";
    case "hybrid":
      return "border-cyan-400/30 bg-cyan-400/10 text-cyan-200";
    case "ai":
      return "border-violet-400/30 bg-violet-400/10 text-violet-200";
    default:
      return "border-white/15 bg-white/5 text-slate-300";
  }
}

interface DisplayItem {
  tool: WorkspaceToolSummary;
  reason: string;
  suggested: boolean;
}

/**
 * The workspace tool chooser. With files staged it shows file-driven suggestions;
 * with a `?tool=` deep link it surfaces that tool first as "Suggested"; otherwise
 * it falls back to popular tools so the panel is never empty. Every entry states
 * honestly where the tool runs and links to the real tool page.
 */
export function SuggestedTools({
  suggestions,
  summaries,
  popular,
  hasFiles,
  preselected,
  onOpen,
}: {
  suggestions: ToolSuggestion[];
  summaries: WorkspaceToolSummary[];
  popular: WorkspaceToolSummary[];
  hasFiles: boolean;
  preselected?: string;
  onOpen: (tool: WorkspaceToolSummary) => void;
}) {
  const bySlug = useMemo(() => indexSummaries(summaries), [summaries]);

  const items = useMemo<DisplayItem[]>(() => {
    const out: DisplayItem[] = [];
    const seen = new Set<string>();
    const push = (tool: WorkspaceToolSummary | undefined, reason: string, suggested: boolean) => {
      if (!tool || seen.has(tool.slug)) return;
      seen.add(tool.slug);
      out.push({ tool, reason, suggested });
    };

    if (preselected) {
      const tool = bySlug.get(preselected);
      if (tool) push(tool, tool.tagline, true);
    }
    if (hasFiles) {
      for (const s of suggestions) push(bySlug.get(s.slug), s.reason, false);
    } else {
      for (const tool of popular) push(tool, tool.tagline, false);
    }
    return out;
  }, [preselected, hasFiles, suggestions, popular, bySlug]);

  const title = hasFiles
    ? "Suggested for your files"
    : preselected
      ? "Pick up where you left off"
      : "Popular tools";

  return (
    <section
      aria-labelledby="suggested-heading"
      className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-surface-2 p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="suggested-heading"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-white"
        >
          <Sparkles className="size-4 text-violet-300" aria-hidden />
          {title}
        </h2>
        <Link
          href="/tools"
          className="text-xs font-medium text-violet-300 transition hover:text-violet-200"
        >
          All tools
        </Link>
      </div>

      <ul className="flex flex-col gap-1.5">
        {items.map(({ tool, reason, suggested }) => (
          <li key={tool.slug}>
            <Link
              href={`/tools/${tool.slug}`}
              onClick={() => onOpen(tool)}
              aria-current={suggested ? "true" : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-xl border px-2.5 py-2 transition",
                suggested
                  ? "border-violet-400/40 bg-violet-500/10"
                  : "border-transparent hover:border-white/10 hover:bg-white/[0.04]",
              )}
            >
              <ToolIcon icon={tool.icon} gradient={tool.gradient} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-white">
                    {tool.name}
                  </span>
                  {suggested && (
                    <span className="rounded-full border border-violet-400/40 bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-200">
                      Suggested
                    </span>
                  )}
                  <span
                    className={cn(
                      "ml-auto shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                      capabilityTone(tool.live, tool.processing),
                    )}
                  >
                    {tool.live ? "In-browser" : tool.capabilityLabel}
                  </span>
                </span>
                <span className="block truncate text-xs text-slate-500">{reason}</span>
              </span>
              <ArrowRight
                className="size-4 shrink-0 text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-white"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
