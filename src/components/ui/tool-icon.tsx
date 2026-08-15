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
 * element of the old design — a different hue per category, everywhere. The
 * `gradient` prop is still accepted (category data and out-of-scope routes
 * pass it) but deliberately no longer painted; it retires with the catalog
 * data when the tool routes are redesigned.
 */
export function ToolIcon(props: {
  icon: IconName;
  /** @deprecated Ignored — kept only for call-site compatibility. */
  gradient?: string;
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
