import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolBadge } from "@/lib/tools/types";

const badgeStyles: Record<ToolBadge, { label: string; className: string }> = {
  popular: {
    label: "Popular",
    className: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  },
  new: {
    label: "New",
    className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  },
  ai: {
    label: "AI",
    className: "border-violet-400/30 bg-violet-400/10 text-violet-200",
  },
  beta: {
    label: "Beta",
    className: "border-blue-400/30 bg-blue-400/10 text-blue-200",
  },
};

export function ToolBadgePill({
  badge,
  className,
}: {
  badge: ToolBadge;
  className?: string;
}) {
  const style = badgeStyles[badge];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
        style.className,
        className,
      )}
    >
      {badge === "ai" && <Sparkles className="size-2.5" aria-hidden />}
      {style.label}
    </span>
  );
}

export function Pill({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300",
        className,
      )}
    >
      {children}
    </span>
  );
}
