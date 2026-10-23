import type { ReactNode } from "react";
import Link from "next/link";
import type { Tool } from "@/lib/tools/types";
import { cardSummary } from "@/lib/tools/card-summary";
import { ToolBadgePill } from "@/components/ui/badge";
import { ProcessingBadge } from "@/components/tools/processing-badge";
import { FamilyTile } from "@/components/tools/family-tile";
import { cn } from "@/lib/utils";

/**
 * A tool's card, linking to /tools/[slug] — the markup, with the glyph handed
 * in. Server-renderable, and safe inside a client component.
 *
 * THE HOME CARD, EVERYWHERE (owner, 2026-10-23: "/tools is still not
 * user-friendly"). Its family's coloured tile with the glyph white on it,
 * the name (the card's only heading), one plain line on what it does
 * (`cardSummary`), and where it runs in a visitor's words beside the mode's
 * shape. The whole card is one link.
 *
 * WAS an index row: a hairline under it, the glyph in a grey hairline box,
 * the specialist's tagline, and a foot in mono capitals — "PDF → DOCX" and
 * "SECURE WORKER". The formats line still opens each tool page's facts row,
 * where it answers a question the reader on that page has.
 *
 * WHY THE GLYPH IS A PROP. Drawing it here would import the icon registry
 * (`@/lib/icons`, ~50 lucide glyphs), and `/tools` renders its cards inside
 * the client explorer, so the whole registry would ship to that page.
 * `ToolCard` (`./tool-card`) draws it for every server surface; `/tools`
 * draws all of them on the server and passes them through the explorer
 * (`tool-card.test.tsx` holds both, on the page as served).
 */
export function ToolCardView({
  tool,
  icon,
  className,
}: {
  tool: Tool;
  /** The tool's glyph (`ToolGlyph`), drawn by the caller; decorative. */
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={`/tools/${tool.slug}`}
      className={cn(
        "group border-line bg-panel hover:border-line-strong rounded-panel flex h-full items-start gap-3.5 border p-3.5 transition-colors",
        className,
      )}
    >
      <FamilyTile category={tool.category}>{icon}</FamilyTile>
      <div className="flex min-w-0 flex-1 flex-col gap-1 self-stretch">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-fg group-hover:text-accent text-[15px] leading-snug font-medium transition-colors">
            {tool.name}
          </h3>
          {tool.badge && (
            <ToolBadgePill badge={tool.badge} className="mt-px shrink-0" />
          )}
        </div>
        <p className="text-muted text-sm leading-snug">{cardSummary(tool)}</p>
        <ProcessingBadge mode={tool.processing} className="mt-auto pt-1" />
      </div>
    </Link>
  );
}
