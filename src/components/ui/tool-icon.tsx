import { createElement } from "react";
import { getIcon, type IconName } from "@/lib/icons";
import { cn } from "@/lib/utils";

const sizeMap = {
  sm: { box: "size-9 rounded-lg", icon: "size-4.5" },
  md: { box: "size-11 rounded-xl", icon: "size-5.5" },
  lg: { box: "size-14 rounded-2xl", icon: "size-7" },
} as const;

/**
 * Renders a tool/category icon inside a gradient-tinted glass tile.
 */
export function ToolIcon({
  icon,
  gradient = "from-violet-500 to-blue-500",
  size = "md",
  className,
}: {
  icon: IconName;
  gradient?: string;
  size?: keyof typeof sizeMap;
  className?: string;
}) {
  const dims = sizeMap[size];
  // `getIcon` returns a stable component from a static registry (it does not
  // create one during render); `createElement` keeps that intent explicit and
  // satisfies react-hooks/static-components.
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center border border-white/10 bg-gradient-to-br text-white shadow-inner shadow-white/5",
        dims.box,
        gradient,
        className,
      )}
    >
      {createElement(getIcon(icon), {
        className: cn(dims.icon),
        strokeWidth: 1.75,
        "aria-hidden": true,
      })}
    </span>
  );
}
