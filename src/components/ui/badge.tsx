import { cn } from "@/lib/utils";
import type { ToolBadge } from "@/lib/tools/types";

/**
 * Editorial micro-tags: square-cornered, mono, hairline. One tag ("Popular")
 * carries the accent; the rest stay quiet. The old per-badge tinted pills
 * were the loudest repeated element on the page.
 */
const badgeStyles: Record<ToolBadge, { label: string; className: string }> = {
  popular: {
    label: "Popular",
    className: "border-accent/50 text-accent",
  },
  new: {
    label: "New",
    className: "border-line-strong text-muted",
  },
  ai: {
    label: "AI",
    className: "border-line-strong text-muted",
  },
  beta: {
    label: "Beta",
    className: "border-line-strong text-muted",
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
        "inline-flex items-center rounded-[2px] border px-1.5 py-px font-mono text-[10px] font-medium tracking-wider uppercase",
        style.className,
        className,
      )}
    >
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
        "text-muted border-line inline-flex items-center gap-1.5 rounded-[2px] border px-2.5 py-1 font-mono text-xs",
        className,
      )}
    >
      {children}
    </span>
  );
}
