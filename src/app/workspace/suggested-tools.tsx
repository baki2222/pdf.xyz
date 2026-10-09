"use client";

import { useId, useMemo } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import { ModeShape } from "@/components/tools/processing-badge";
import { ToolIcon } from "@/components/ui/tool-icon";
import { getProcessingMeta } from "@/lib/tools/processing";
import { cn } from "@/lib/utils";
import { indexSummaries, type WorkspaceToolSummary } from "./summary";

interface DisplayItem {
  tool: WorkspaceToolSummary;
  suggested: boolean;
}

/** Rows shown before "More": as many as the suggestions list shows. */
const SHOWN = 3;

/**
 * The workspace's tool list before any file is staged: the deep-linked tool
 * (`?tool=`) first as "Suggested", then popular tools, so the panel is never
 * empty. Every entry says where the tool runs — its shape and its word — and
 * links to the real tool page. Once files are staged, `./file-suggestions`
 * takes this panel's place with suggestions ranked from the files themselves.
 *
 * THE SAME BOX as what replaces it: a heading row, {@link SHOWN} rows of the
 * suggestion row's line boxes, and a "More" footer — so staging a file
 * swaps the panel's words, not its height. WAS every popular tool in a
 * column, ~570px against the suggestions' ~380px, so the recent activity and
 * privacy note under it jumped ~190px on every first staging (review,
 * 2026-10-09). The rest stay links, inside the footer.
 */
export function SuggestedTools({
  summaries,
  popular,
  preselected,
  onOpen,
  className,
}: {
  summaries: WorkspaceToolSummary[];
  popular: WorkspaceToolSummary[];
  preselected?: string;
  onOpen: (tool: WorkspaceToolSummary) => void;
  className?: string;
}) {
  const headingId = useId();
  const bySlug = useMemo(() => indexSummaries(summaries), [summaries]);

  const items = useMemo<DisplayItem[]>(() => {
    const out: DisplayItem[] = [];
    const seen = new Set<string>();
    const push = (
      tool: WorkspaceToolSummary | undefined,
      suggested: boolean,
    ) => {
      if (!tool || seen.has(tool.slug)) return;
      seen.add(tool.slug);
      out.push({ tool, suggested });
    };
    if (preselected) push(bySlug.get(preselected), true);
    for (const tool of popular) push(tool, false);
    return out;
  }, [preselected, popular, bySlug]);

  const row = ({ tool, suggested }: DisplayItem) => (
    <li key={tool.slug}>
      <Link
        href={`/tools/${tool.slug}`}
        onClick={() => onOpen(tool)}
        aria-current={suggested ? "true" : undefined}
        className={cn(
          "group rounded-panel grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 border px-3 py-2.5 transition-colors",
          "focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-2",
          suggested
            ? "border-accent/40 bg-select"
            : "hover:border-line hover:bg-wash border-transparent",
        )}
      >
        <ToolIcon icon={tool.icon} size="sm" className="mt-0.5" />
        {/* The suggestion row's line boxes: a 20px name, a relaxed 12px
            line and a relaxed 11px line, each one line high. */}
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            <span className="text-fg truncate text-sm font-medium">
              {tool.name}
            </span>
            {suggested && (
              <span className="border-accent/40 text-accent rounded-tag border px-1.5 py-0.5 font-mono text-[10px] leading-none font-semibold tracking-wide uppercase">
                Suggested
              </span>
            )}
          </span>
          <span className="text-muted line-clamp-1 text-xs leading-relaxed">
            {tool.tagline}
          </span>
          <span className="text-faint flex items-center gap-1.5 text-[11px] leading-relaxed">
            <ModeShape mode={tool.processing} />
            <span className="font-mono font-medium tracking-wide uppercase">
              {getProcessingMeta(tool.processing).short}
            </span>
          </span>
        </span>
        <ArrowRight
          className="text-faint group-hover:text-fg mt-1 size-4 shrink-0 transition-[color,translate] motion-safe:group-hover:translate-x-0.5"
          aria-hidden
        />
      </Link>
    </li>
  );

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "bg-panel border-line rounded-panel flex flex-col gap-4 border p-5",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="kicker text-muted">
          {preselected ? "Pick up where you left off" : "Popular tools"}
        </h2>
        <Link
          href="/tools"
          className="text-accent text-xs font-medium underline-offset-4 hover:underline"
        >
          All tools
        </Link>
      </div>

      <ul className="flex flex-col gap-1.5">
        {items.slice(0, SHOWN).map(row)}
      </ul>
      {items.length > SHOWN && (
        <details className="group/more border-line border-t pt-3">
          <summary className="text-muted hover:text-fg flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium [&::-webkit-details-marker]:hidden">
            <ChevronDown
              className="size-3.5 transition-transform group-open/more:rotate-180"
              aria-hidden
            />
            More popular tools ({items.length - SHOWN})
          </summary>
          <ul className="mt-3 flex flex-col gap-1.5">
            {items.slice(SHOWN).map(row)}
          </ul>
        </details>
      )}
    </section>
  );
}
