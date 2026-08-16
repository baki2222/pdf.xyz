import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { Tool } from "@/lib/tools/types";
import { ToolBadgePill } from "@/components/ui/badge";
import { ProcessingBadge } from "@/components/tools/processing-badge";
import { cn } from "@/lib/utils";

/**
 * A single tool entry linking to /tools/[slug]. Server-renderable.
 *
 * Set as an index row, not a boxed card: hairline underneath, name first,
 * one-line tagline, and the processing fact at the foot. Fifty of these read
 * as a catalogue — a directory of things that work — instead of fifty
 * identical rounded rectangles.
 */
export function ToolCard({
  tool,
  className,
}: {
  tool: Tool;
  className?: string;
}) {
  return (
    <Link
      href={`/tools/${tool.slug}`}
      className={cn(
        "group border-line hover:bg-wash relative flex h-full flex-col gap-1.5 border-b px-1 py-4 transition-colors",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-fg group-hover:text-accent text-[15px] font-medium transition-colors">
          {tool.name}
        </h3>
        <span className="flex shrink-0 items-center gap-2">
          {tool.badge && <ToolBadgePill badge={tool.badge} />}
          <ArrowUpRight
            className="text-faint size-3.5 opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden
          />
        </span>
      </div>

      <p className="text-muted line-clamp-2 text-sm leading-relaxed">
        {tool.tagline}
      </p>

      <div className="mt-auto flex items-center gap-2 pt-2">
        <ProcessingBadge mode={tool.processing} />
      </div>
    </Link>
  );
}
