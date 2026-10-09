import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getToolsGroupedByCategory } from "@/lib/tools";
import { categoryHref } from "@/lib/tools/category-href";
import type { Tool } from "@/lib/tools/types";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { ProcessingBadge } from "@/components/tools/processing-badge";
import { cn } from "@/lib/utils";

/**
 * How many of a category's tools its card shows on a phone. The rest stay
 * in the HTML, hidden below `sm`, so the home page still links every tool.
 */
const PHONE_ROWS = 3;

/**
 * "All 7 Organize tools", "All 4 AI tools": a category's way to all of its
 * tools, named with the count and the category. A category whose name
 * already ends in "Tools" does not say it twice.
 */
export function allToolsLabel(name: string, count: number): string {
  return `All ${count} ${name.replace(/\s+tools$/i, "")} tools`;
}

/**
 * One tool in a category's list: the name, a dot leader, and where it runs.
 * Deliberately names-only: a `title` attribute was tried and rejected — it
 * asserts the tagline is available while withholding it from screen readers
 * and touch, which is a claim the markup does not keep. The descriptions
 * live on /tools, one click away. On a phone the row is just the name and
 * the mode's shape (its word stays, for screen readers), and rows after the
 * first {@link PHONE_ROWS} are hidden.
 */
function IndexRow({ tool, phoneHidden }: { tool: Tool; phoneHidden: boolean }) {
  return (
    <Link
      href={`/tools/${tool.slug}`}
      className={cn(
        "group flex items-baseline gap-2 py-1 text-sm sm:gap-3 sm:py-[7px]",
        phoneHidden && "max-sm:hidden",
      )}
    >
      <span className="flex min-w-0 items-baseline gap-2">
        {tool.badge === "popular" && (
          <span
            aria-hidden
            className="bg-accent size-1.5 shrink-0 self-center max-sm:hidden"
          />
        )}
        {/* Never cut short on a phone, where the name is all a row says:
            it wraps instead ("PowerPoint to P…" was the first cut). */}
        <span className="text-fg group-hover:text-accent font-medium transition-colors sm:truncate">
          {tool.name}
        </span>
      </span>
      {/* The dot leader. Opacity is a separate utility, not a `/60` colour
          modifier: the numbers-honesty census reads class strings as prose,
          and `…strong/60 min-w-4…` scans as the figure "60 min". */}
      <span
        aria-hidden
        className="border-line-strong min-w-4 flex-1 border-b border-dotted opacity-60 max-sm:hidden"
      />
      <ProcessingBadge
        mode={tool.processing}
        className="shrink-0 max-sm:ml-auto"
        wordClassName="max-sm:sr-only"
      />
    </Link>
  );
}

/**
 * The catalogue as a table of contents.
 *
 * FROM `sm`: the category name, set in the display grotesque, in the left
 * rail with its description and a "View all" link; single-line entries with
 * dot leaders on the right — the way a document indexes itself. A popular
 * tool is marked (accent square) and every entry keeps its processing fact.
 *
 * ON A PHONE: that index was 3,678px tall (measured 2026-10-10), a third of
 * the home page. It is now a two-column grid of category cards: the
 * category, linked, with its count; its first {@link PHONE_ROWS} tools; and
 * under them "All 7 Organize tools →", the visible way to the rest. The
 * other rows stay in the HTML, hidden, so every tool is still linked from
 * the home page (`internal-links.test.ts`); the height is held at 1,100px by
 * `e2e/tool-layout.mobile.spec.ts`. One list serves both layouts, so no tool
 * is linked twice.
 *
 * The card's link is its own element, not the heading's: the WP-06 review
 * (2026-10-10) found the heading was the cards' only way to their category,
 * and on a phone it reads as plain text — no arrow, no underline, no accent,
 * and touch has no hover — while "View all" is hidden below `sm`.
 */
export function ToolShowcase() {
  const groups = getToolsGroupedByCategory();

  return (
    <section id="tools" className="border-line border-b py-20 sm:py-24">
      <Container className="flex flex-col gap-8 sm:gap-12">
        <SectionHeading
          eyebrow="The toolbox"
          title="Everything you can do with a PDF"
          description="A complete, categorized toolkit — from everyday merges and conversions to redaction, e-signatures, and AI. Every tool tells you exactly where it runs."
          // Below `sm` the cards say it: each names its category, its count
          // and its tools' shapes. Hidden, not removed — it stays in the
          // HTML — so the section fits its 1,100px with each card's "All N
          // … tools →" link (1,267px with both, measured at 390).
          descriptionClassName="max-sm:hidden"
        />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-1 sm:gap-12">
          {groups.map(({ category, tools: categoryTools }) => (
            <div
              key={category.id}
              className="border-line bg-panel rounded-panel flex min-w-0 flex-col gap-2 border p-3.5 sm:grid sm:gap-6 sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 lg:grid-cols-12"
            >
              <div className="flex flex-col items-start gap-2 lg:col-span-3">
                <h3 className="font-display text-fg text-[15px] leading-snug font-medium tracking-tight sm:text-2xl">
                  <Link
                    href={categoryHref(category.id)}
                    className="hover:text-accent transition-colors"
                  >
                    {category.name}{" "}
                    <span className="text-faint ml-1 align-middle font-mono text-xs font-normal tracking-normal sm:ml-1.5">
                      {categoryTools.length}
                    </span>{" "}
                    <span className="sr-only">tools</span>
                  </Link>
                </h3>
                <p className="text-muted max-w-xs text-sm leading-relaxed max-sm:hidden">
                  {category.description}
                </p>
                <Link
                  href={categoryHref(category.id)}
                  className="group text-accent mt-1 inline-flex items-center gap-1.5 text-sm font-medium hover:underline max-sm:hidden"
                >
                  View all <span className="sr-only">{category.name}</span>
                  <ArrowRight
                    className="size-4 transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </Link>
              </div>

              <div className="sm:border-line grid grid-cols-1 content-start sm:grid-cols-2 sm:gap-x-10 sm:border-t sm:pt-3 lg:col-span-9 xl:grid-cols-3">
                {categoryTools.map((tool, i) => (
                  <IndexRow
                    key={tool.slug}
                    tool={tool}
                    phoneHidden={i >= PHONE_ROWS}
                  />
                ))}
              </div>

              <Link
                href={categoryHref(category.id)}
                className="text-accent mt-auto inline-flex items-baseline gap-1 text-xs leading-4 font-medium underline-offset-4 hover:underline sm:hidden"
              >
                {allToolsLabel(category.name, categoryTools.length)}
                <ArrowRight
                  className="size-3 shrink-0 self-center"
                  aria-hidden
                />
              </Link>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}
