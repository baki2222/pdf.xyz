import { createElement } from "react";
import { getIcon, type IconName } from "@/lib/icons";
import { cn } from "@/lib/utils";

const sizeMap = {
  sm: { box: "size-8", icon: "size-4" },
  md: { box: "size-10", icon: "size-5" },
  lg: { box: "size-12", icon: "size-6" },
} as const;

/**
 * Renders a tool/category icon as a plain ink glyph in a hairline box.
 *
 * The multicolour gradient tiles this used to paint were the loudest single
 * element of the old design — a different hue per category, everywhere. For
 * months after it stopped painting them it still took a `gradient` prop, and
 * every category still carried a `from-… to-…` pair for it: data nothing
 * rendered, from which Tailwind went on generating sixteen gradient stops
 * into the stylesheet every page downloads. Both retired on 2026-10-09
 * (`shipped-css.test.ts` found the stops).
 */
export function ToolIcon(props: {
  icon: IconName;
  size?: keyof typeof sizeMap;
  className?: string;
}) {
  const { icon, size = "md", className } = props;
  const dims = sizeMap[size];
  // `getIcon` returns a stable component from a static registry (it does not
  // create one during render); `createElement` keeps that intent explicit and
  // satisfies react-hooks/static-components.
  return (
    <span
      // Which glyph this is, for the guards that check a card shows its own
      // tool's icon (`tool-card.test.tsx`); the SVG itself says nothing.
      data-icon={icon}
      className={cn(
        "border-line bg-wash text-fg relative inline-flex shrink-0 items-center justify-center rounded-[3px] border",
        dims.box,
        className,
      )}
    >
      {createElement(getIcon(icon), {
        className: cn(dims.icon),
        strokeWidth: 1.5,
        "aria-hidden": true,
      })}
    </span>
  );
}
