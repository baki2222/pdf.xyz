import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { getCategory } from "@/lib/tools/categories";
import type { Tool } from "@/lib/tools/types";
import { ToolBadgePill } from "@/components/ui/badge";
import { ToolIcon } from "@/components/ui/tool-icon";
import { ProcessingBadge } from "@/components/tools/processing-badge";
import { cn } from "@/lib/utils";

/** A single tool tile linking to /tools/[slug]. Server-renderable. */
export function ToolCard({
  tool,
  className,
}: {
  tool: Tool;
  className?: string;
}) {
  const category = getCategory(tool.category);
  return (
    <Link
      href={`/tools/${tool.slug}`}
      className={cn(
        "card-hover group relative flex h-full flex-col gap-4 rounded-2xl border border-white/10 bg-surface-2 p-5 hover:border-white/20 hover:bg-white/[0.05] hover:shadow-xl hover:shadow-black/20",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <ToolIcon icon={tool.icon} gradient={category?.gradient} size="md" />
        <div className="flex items-center gap-2">
          {tool.badge && <ToolBadgePill badge={tool.badge} />}
          <ArrowUpRight
            className="size-4 shrink-0 text-slate-400 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-white"
            aria-hidden
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="text-[15px] font-semibold text-white">{tool.name}</h3>
        <p className="line-clamp-2 text-sm leading-relaxed text-slate-400">
          {tool.tagline}
        </p>
      </div>

      <div className="mt-auto flex items-center gap-2 pt-1">
        <ProcessingBadge mode={tool.processing} />
      </div>
    </Link>
  );
}
