import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getToolsGroupedByCategory } from "@/lib/tools";
import { categoryHref } from "@/lib/tools/category-href";
import type { Tool } from "@/lib/tools/types";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { ProcessingBadge } from "@/components/tools/processing-badge";

/**
 * The catalogue as a table of contents: the category name, set in the
 * display grotesque, in the left rail; single-line entries with dot leaders
 * on the right — the way a document indexes itself. Round 1 gave every tool a two-line card at equal
 * weight and the section ate a third of the page saying nothing about where
 * to start; here a popular tool is marked (accent square) and every entry
 * keeps its processing fact. Deliberately names-only: a `title` attribute
 * was tried and rejected — it asserts the tagline is available while
 * withholding it from screen readers and touch, which is a claim the markup
 * does not keep. The descriptions live on /tools, one click away.
 */
function IndexRow({ tool }: { tool: Tool }) {
  return (
    <Link
      href={`/tools/${tool.slug}`}
      className="group flex items-baseline gap-3 py-[7px] text-sm"
    >
      <span className="flex min-w-0 items-baseline gap-2">
        {tool.badge === "popular" && (
          <span
            aria-hidden
            className="bg-accent size-1.5 shrink-0 self-center"
          />
        )}
        <span className="text-fg group-hover:text-accent truncate font-medium transition-colors">
          {tool.name}
        </span>
      </span>
      {/* The dot leader. Opacity is a separate utility, not a `/60` colour
          modifier: the numbers-honesty census reads class strings as prose,
          and `…strong/60 min-w-4…` scans as the figure "60 min". */}
      <span
        aria-hidden
        className="border-line-strong min-w-4 flex-1 border-b border-dotted opacity-60"
      />
      <ProcessingBadge mode={tool.processing} className="shrink-0" />
    </Link>
  );
}

export function ToolShowcase() {
  const groups = getToolsGroupedByCategory();

  return (
    <section id="tools" className="border-line border-b py-20 sm:py-24">
      <Container className="flex flex-col gap-12">
        <SectionHeading
          eyebrow="The toolbox"
          title="Everything you can do with a PDF"
          description="A complete, categorized toolkit — from everyday merges and conversions to redaction, e-signatures, and AI. Every tool tells you exactly where it runs."
        />

        {groups.map(({ category, tools: categoryTools }) => (
          <div key={category.id} className="grid gap-6 lg:grid-cols-12">
            <div className="flex flex-col items-start gap-2 lg:col-span-3">
              <h3 className="font-display text-fg text-2xl font-medium tracking-tight">
                {category.name}
                <span className="text-faint ml-2.5 align-middle font-mono text-xs font-normal tracking-normal">
                  {categoryTools.length}
                </span>
              </h3>
              <p className="text-muted max-w-xs text-sm leading-relaxed">
                {category.description}
              </p>
              <Link
                href={categoryHref(category.id)}
                className="group text-accent mt-1 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
              >
                View all
                <span className="sr-only"> {category.name}</span>
                <ArrowRight
                  className="size-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            </div>

            <div className="border-line grid grid-cols-1 content-start gap-x-10 border-t pt-3 sm:grid-cols-2 lg:col-span-9 xl:grid-cols-3">
              {categoryTools.map((tool) => (
                <IndexRow key={tool.slug} tool={tool} />
              ))}
            </div>
          </div>
        ))}
      </Container>
    </section>
  );
}
