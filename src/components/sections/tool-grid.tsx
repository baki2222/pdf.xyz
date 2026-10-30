import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { toolCount } from "@/lib/tools";
import { toolFamilies } from "@/lib/tools/families";
import { processingMeta } from "@/lib/tools/processing";
import { Container } from "@/components/ui/container";
import { ToolCard } from "@/components/tools/tool-card";
import { FILTER_CHIP, FamilySwatch } from "@/components/tools/family-tile";
import { ToolFilter } from "./tool-filter";

/** The chip that shows every card. */
const ALL = "all";

/*
 * A tool's card is the site's one card (`ToolCard`): the family's coloured
 * tile, the name, one plain line, and where it runs in plain words. It began
 * here, as this grid's own `HomeToolCard`, and moved out on 2026-10-23 so
 * /tools, the category pages and every related-tools list wear it too. The
 * chips are `FILTER_CHIP`, the same class as /tools' category chips.
 */

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
                  className={FILTER_CHIP}
                >
                  {chip.id !== ALL && <FamilySwatch family={chip.id} />}
                  {chip.label}{" "}
                  <span className="text-faint group-aria-pressed:text-fg-invert/70 tnum text-xs">
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
                    <ToolCard tool={tool} />
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
