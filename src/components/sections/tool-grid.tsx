import { createElement } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { toolCount } from "@/lib/tools";
import type { Tool } from "@/lib/tools/types";
import { familyOf, toolFamilies } from "@/lib/tools/families";
import { cardSummary } from "@/lib/tools/page-copy";
import { processingMeta } from "@/lib/tools/processing";
import { getIcon } from "@/lib/icons";
import { Container } from "@/components/ui/container";
import { ModeShape } from "@/components/tools/processing-badge";
import { cn } from "@/lib/utils";
import { ToolFilter } from "./tool-filter";

/**
 * Each family's colour: a solid tile, `bg-cat-<family>`, with its glyph in
 * `text-cat-ink` — the same class on the family's chip swatch, so a card and
 * its chip cannot disagree. The tokens are declared in every theme scope of
 * `globals.css`, and `design-tokens.test.ts` holds each glyph at 3:1 on its
 * tile in all four. Spelled out, one literal per family, because Tailwind
 * only generates a class it can read in the source; `tool-grid.test.tsx`
 * holds every rendered family to `bg-cat-<its id>`.
 *
 * WAS a theme ink at 10% on the tile (`bg-current/10`) with the glyph in the
 * ink: every tile read as the same pale square (review of PR #199).
 */
const FAMILY_TILE: Record<string, string> = {
  organize: "bg-cat-organize",
  convert: "bg-cat-convert",
  edit: "bg-cat-edit",
  sign: "bg-cat-sign",
  security: "bg-cat-security",
  optimize: "bg-cat-optimize",
  ai: "bg-cat-ai",
};

/** The chip that shows every card. */
const ALL = "all";

/*
 * A chip, in the same utilities as /tools' category chips
 * (`tools-explorer.tsx`); pressed is drawn from `aria-pressed`, so the state
 * a screen reader hears is the state the eye sees, and the client script
 * only has to set the attribute. The site's focus outline is a button's own.
 */
const CHIP =
  "group rounded-tag border-line text-muted hover:border-line-strong hover:bg-wash hover:text-fg aria-pressed:bg-invert aria-pressed:text-fg-invert aria-pressed:hover:bg-invert aria-pressed:hover:text-fg-invert inline-flex h-9 shrink-0 items-center gap-1.5 border px-3.5 text-sm font-medium whitespace-nowrap transition-colors aria-pressed:border-transparent";

/**
 * A tool's card: the whole card is one link. Icon tile, the name (the card's
 * only heading), one plain line on what it does (`cardSummary`), and where
 * it runs in a visitor's words (`processingMeta[mode].plain`) beside the
 * mode's shape — never the mono uppercase label the old index rows wore.
 */
function HomeToolCard({ tool }: { tool: Tool }) {
  const tile = FAMILY_TILE[familyOf(tool)] ?? "bg-invert";
  return (
    <Link
      href={`/tools/${tool.slug}`}
      className="group border-line bg-panel hover:border-line-strong rounded-panel flex h-full items-start gap-3.5 border p-3.5 transition-colors"
    >
      <span
        aria-hidden
        data-tile=""
        className={cn(
          "rounded-ctl text-cat-ink grid size-10 shrink-0 place-items-center",
          tile,
        )}
      >
        {createElement(getIcon(tool.icon), {
          className: "size-5",
          strokeWidth: 1.75,
          "aria-hidden": true,
        })}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 self-stretch">
        <h3 className="text-fg group-hover:text-accent text-[15px] leading-snug font-medium transition-colors">
          {tool.name}
        </h3>
        <p className="text-muted text-sm leading-snug">{cardSummary(tool)}</p>
        <p className="text-muted mt-auto inline-flex items-center gap-1.5 pt-1 text-xs">
          <ModeShape mode={tool.processing} />
          {processingMeta[tool.processing].plain}
        </p>
      </div>
    </Link>
  );
}

/**
 * Every tool, as a card, right under the hero (owner's brief, 2026-10-21),
 * with chips that narrow the grid to one family. Every card is rendered here,
 * on the server; the chips only choose which show (`./tool-filter`).
 */
export function ToolGrid() {
  const families = toolFamilies();
  const chips = [
    {
      id: ALL,
      label: "All",
      count: toolCount,
      say: `Showing all ${toolCount} tools`,
    },
    ...families.map((f) => ({
      id: f.id,
      label: f.label,
      count: f.tools.length,
      say: `Showing ${f.tools.length} ${f.label} tools`,
    })),
  ];
  return (
    <section
      id="tools"
      className="border-line scroll-mt-24 border-b py-10 sm:py-14"
    >
      <Container>
        <div className="flex flex-col gap-2">
          <h2 className="font-display text-fg text-display-2 font-medium text-balance">
            What do you want to do?
          </h2>
          <p className="text-muted max-w-2xl text-base leading-relaxed text-pretty">
            {toolCount} tools, all free. Pick one — or choose a file above and
            we&apos;ll suggest the right tool.
          </p>
        </div>
        <div className="mt-6">
          <ToolFilter>
            <div
              role="group"
              aria-label="Filter tools by category"
              className="flex flex-wrap gap-2"
            >
              {chips.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  data-family={chip.id}
                  data-say={chip.say}
                  aria-pressed={chip.id === ALL}
                  className={CHIP}
                >
                  {chip.id !== ALL && (
                    <span
                      aria-hidden
                      data-swatch=""
                      className={cn(
                        "rounded-tag size-2.5 shrink-0",
                        FAMILY_TILE[chip.id] ?? "bg-invert",
                      )}
                    />
                  )}
                  {chip.label}{" "}
                  <span className="text-faint group-aria-pressed:text-fg-invert/70 text-xs tabular-nums">
                    {chip.count}
                  </span>
                </button>
              ))}
            </div>
            <p role="status" className="sr-only" />
            <ul
              data-tool-grid=""
              className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5"
            >
              {/* In chip order, so "All" reads family by family. */}
              {families.flatMap((f) =>
                f.tools.map((tool) => (
                  <li key={tool.slug} data-family={f.id}>
                    <HomeToolCard tool={tool} />
                  </li>
                )),
              )}
            </ul>
          </ToolFilter>
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted text-sm text-pretty">
            Tools marked {processingMeta.ai.plain} send your PDF&apos;s text —
            not the file — to an AI provider, under terms that prohibit training
            on it.
          </p>
          <Link
            href="/tools"
            className="group text-accent inline-flex shrink-0 items-center gap-1.5 text-sm font-medium hover:underline"
          >
            Browse all tools
            <ArrowRight
              className="size-4 transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
        </div>
      </Container>
    </section>
  );
}
