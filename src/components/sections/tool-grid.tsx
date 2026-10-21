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
 * Each family's colour: its icon, drawn in a theme role, on a tile tinted
 * with the same colour (`bg-current/10`). Roles, never palette hues
 * (`raw-palette.test.ts`), so both schemes resolve them. Decorative: the
 * card's name says what the tool is. A family missing here is drawn in ink.
 */
const FAMILY_INK: Record<string, string> = {
  organize: "text-accent",
  convert: "text-info",
  edit: "text-warn",
  sign: "text-ok",
  security: "text-err",
  optimize: "text-fg",
  ai: "text-mark",
};

/**
 * A tool's card: the whole card is one link. Icon tile, the name (the card's
 * only heading), one plain line on what it does (`cardSummary`), and where
 * it runs in a visitor's words (`processingMeta[mode].plain`) beside the
 * mode's shape — never the mono uppercase label the old index rows wore.
 */
function HomeToolCard({ tool }: { tool: Tool }) {
  const ink = FAMILY_INK[familyOf(tool)] ?? "text-fg";
  return (
    <Link
      href={`/tools/${tool.slug}`}
      className="group border-line bg-panel hover:border-line-strong rounded-panel flex h-full items-start gap-3.5 border p-3.5 transition-colors"
    >
      <span
        aria-hidden
        className={cn(
          "rounded-ctl grid size-10 shrink-0 place-items-center bg-current/10",
          ink,
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
          <ToolFilter
            label="Filter tools by category"
            chips={families.map((f) => ({
              id: f.id,
              label: f.label,
              count: f.tools.length,
            }))}
            // In chip order, so "All" reads family by family.
            cards={families.flatMap((f) =>
              f.tools.map((tool) => ({
                slug: tool.slug,
                family: f.id,
                card: <HomeToolCard tool={tool} />,
              })),
            )}
          />
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
