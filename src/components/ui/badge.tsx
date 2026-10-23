import { cn } from "@/lib/utils";
import type { ToolBadge } from "@/lib/tools/types";

/**
 * Micro-tags: square-cornered, hairline, in plain case. One tag ("Popular")
 * carries the accent; the rest stay quiet. The old per-badge tinted pills
 * were the loudest repeated element on the page; the mono capitals that
 * replaced them ("POPULAR") read as a developer's label, and went on
 * 2026-10-23 with the rest of the site's mono badges.
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
        "rounded-tag inline-flex items-center border px-1.5 py-px text-[11px] leading-4 font-medium",
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
        "text-muted border-line rounded-tag inline-flex items-center gap-1.5 border px-2.5 py-1 font-mono text-xs",
        className,
      )}
    >
      {children}
    </span>
  );
}
