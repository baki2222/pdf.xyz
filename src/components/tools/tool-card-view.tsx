import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { Tool } from "@/lib/tools/types";
import { ToolBadgePill } from "@/components/ui/badge";
import { ProcessingBadge } from "@/components/tools/processing-badge";
import { FormatsLine } from "@/components/tools/formats-line";
import { cn } from "@/lib/utils";

/**
 * A tool's card, linking to /tools/[slug] — the markup, with the icon handed
 * in. Server-renderable, and safe inside a client component.
 *
 * Set as an index row, not a boxed card: hairline underneath, the tool's
 * glyph in its hairline box, name first, a two-line tagline, and a foot that
 * says what goes in and out ("PDF → DOCX") and where it runs. Fifty of these
 * read as a catalogue — a directory of things that work — instead of fifty
 * identical rounded rectangles.
 *
 * WHY THE ICON IS A PROP. Drawing it here would import the icon registry
 * (`@/lib/icons`, ~50 lucide glyphs), and `/tools` renders its cards inside
 * the client explorer, so the whole registry would ship to that page.
 * `ToolCard` (`./tool-card`) draws it for every server surface; `/tools`
 * draws all of them on the server and passes them through the explorer
 * (`tool-card.test.tsx` holds both, on the page as served).
 *
 * The name is the card's only heading, so a surface's outline is the same
 * with or without the glyph; the tagline is clamped to two lines visually
 * and kept whole in the DOM.
 */
export function ToolCardView({
  tool,
  icon,
  className,
}: {
  tool: Tool;
  /** The tool's glyph, drawn by the caller; decorative. */
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={`/tools/${tool.slug}`}
      className={cn(
        "group border-line hover:bg-wash relative flex h-full items-start gap-3.5 border-b px-1 py-4 transition-colors",
        className,
      )}
    >
      {icon && (
        <span
          aria-hidden
          className="group-hover:[&>span]:border-line-strong shrink-0 pt-0.5 [&>span]:transition-colors"
        >
          {icon}
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 self-stretch">
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

        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pt-2">
          <FormatsLine tool={tool} />
          <ProcessingBadge mode={tool.processing} />
        </div>
      </div>
    </Link>
  );
}
