import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getToolsGroupedByCategory } from "@/lib/tools";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { ToolCard } from "@/components/tools/tool-card";

/**
 * The catalogue, set as a directory: serif category name in a left rail,
 * dense hairline index rows on the right. Fifty working tools ARE the
 * product — showing them at density is the argument, so no icon tiles,
 * no boxes, no per-category colour.
 */
export function ToolShowcase() {
  const groups = getToolsGroupedByCategory();

  return (
    <section id="tools" className="border-line border-b py-20 sm:py-28">
      <Container className="flex flex-col gap-16">
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
                href={`/tools?category=${category.id}`}
                className="group text-accent mt-1 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
              >
                View all
                <ArrowRight
                  className="size-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            </div>

            <div className="border-line grid grid-cols-1 gap-x-8 border-t sm:grid-cols-2 lg:col-span-9 xl:grid-cols-3">
              {categoryTools.map((tool) => (
                <ToolCard key={tool.slug} tool={tool} />
              ))}
            </div>
          </div>
        ))}
      </Container>
    </section>
  );
}
