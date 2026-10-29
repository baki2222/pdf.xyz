import type { ReactNode } from "react";
import type { ToolCategoryId } from "@/lib/tools/types";
import { familyIdOf } from "@/lib/tools/family-id";
import { cn } from "@/lib/utils";

/**
 * Each family's colour: a solid tile, `bg-cat-<family>`, with its glyph in
 * `text-cat-ink` — the same class on the family's chip swatch, so a card and
 * its chip cannot disagree. The tokens are declared in every theme scope of
 * `globals.css`, and `design-tokens.test.ts` holds each glyph at 3:1 on its
 * tile in all four. Spelled out, one literal per family, because Tailwind
 * only generates a class it can read in the source; `tool-grid.test.tsx` and
 * `tool-card.test.tsx` hold every rendered family to `bg-cat-<its id>`.
 *
 * WAS a theme ink at 10% on the tile (`bg-current/10`) with the glyph in the
 * ink: every tile read as the same pale square (review of PR #199). Moved
 * here from the home grid on 2026-10-23, when every tool card on the site
 * (the catalogue, the category pages, a tool page's related tools, a guide's
 * tools used, the workspace's rows) took the home card's tile.
 */
export const FAMILY_TILE: Readonly<Record<string, string>> = {
  organize: "bg-cat-organize",
  convert: "bg-cat-convert",
  edit: "bg-cat-edit",
  sign: "bg-cat-sign",
  security: "bg-cat-security",
  optimize: "bg-cat-optimize",
  ai: "bg-cat-ai",
};

/** A family's tile class; the inverted ink for a family with no colour. */
export function familyTileClass(family: string): string {
  return FAMILY_TILE[family] ?? "bg-invert";
}

/**
 * A filter chip, as on the home page and /tools: pressed is drawn from
 * `aria-pressed`, so the state a screen reader hears is the state the eye
 * sees. The site's focus outline is a button's own.
 */
export const FILTER_CHIP =
  "group rounded-tag border-line text-muted hover:border-line-strong hover:bg-wash hover:text-fg aria-pressed:bg-invert aria-pressed:text-fg-invert aria-pressed:hover:bg-invert aria-pressed:hover:text-fg-invert inline-flex h-11 shrink-0 items-center gap-1.5 border px-3.5 text-sm font-medium whitespace-nowrap transition-colors aria-pressed:border-transparent";

/** A family's swatch on its chip, in its tile's class. */
export function FamilySwatch({ family }: { family: string }) {
  return (
    <span
      aria-hidden
      data-swatch=""
      className={cn("rounded-tag size-2.5 shrink-0", familyTileClass(family))}
    />
  );
}

const TILE_SIZE = {
  sm: "size-8 [&>svg]:size-4",
  md: "size-10 [&>svg]:size-5",
} as const;

/**
 * A tool's tile: its family's colour, the glyph white on it. The glyph is
 * handed in (`ToolGlyph`, or one drawn by a server page), so this module
 * carries no icon registry into a client bundle.
 */
export function FamilyTile({
  category,
  size = "md",
  className,
  children,
}: {
  category: ToolCategoryId;
  size?: keyof typeof TILE_SIZE;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      aria-hidden
      data-tile=""
      className={cn(
        "rounded-ctl text-cat-ink grid shrink-0 place-items-center",
        TILE_SIZE[size],
        familyTileClass(familyIdOf(category)),
        className,
      )}
    >
      {children}
    </span>
  );
}
