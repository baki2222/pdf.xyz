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
  if (live) return "border-ok/40 bg-ok/10 text-ok";
  switch (processing) {
    case "server":
      return "border-info/40 bg-info/10 text-info";
    case "hybrid":
      return "border-info/40 bg-info/10 text-info";
    case "ai":
      return "border-accent/40 bg-accent/10 text-accent";
    default:
      return "border-line-strong bg-wash text-muted";
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
    const push = (
      tool: WorkspaceToolSummary | undefined,
      reason: string,
      suggested: boolean,
    ) => {
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
      className="bg-panel border-line flex flex-col gap-4 rounded-[4px] border p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="suggested-heading"
          className="text-fg inline-flex items-center gap-1.5 text-sm font-semibold"
        >
          <Sparkles className="text-accent size-4" aria-hidden />
          {title}
        </h2>
        <Link
          href="/tools"
          className="text-accent hover:text-accent text-xs font-medium transition"
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
                "group flex items-center gap-3 rounded-[3px] border px-2.5 py-2 transition",
                suggested
                  ? "border-accent/40 bg-accent/10"
                  : "hover:border-line hover:bg-wash border-transparent",
              )}
            >
              <ToolIcon icon={tool.icon} gradient={tool.gradient} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-fg truncate text-sm font-medium">
                    {tool.name}
                  </span>
                  {suggested && (
                    <span className="border-accent/40 bg-accent/10 text-accent rounded-[2px] border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide uppercase">
                      Suggested
                    </span>
                  )}
                  <span
                    className={cn(
                      "ml-auto shrink-0 rounded-[2px] border px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide uppercase",
                      capabilityTone(tool.live, tool.processing),
                    )}
                  >
                    {tool.live ? "In-browser" : tool.capabilityLabel}
                  </span>
                </span>
                <span className="text-muted block truncate text-xs">
                  {reason}
                </span>
              </span>
              <ArrowRight
                className="text-muted group-hover:text-fg size-4 shrink-0 transition group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
