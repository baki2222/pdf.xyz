import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getToolsGroupedByCategory } from "@/lib/tools";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { ToolIcon } from "@/components/ui/tool-icon";
import { ToolCard } from "@/components/tools/tool-card";

export function ToolShowcase() {
  const groups = getToolsGroupedByCategory();

  return (
    <section id="tools" className="py-20 sm:py-28">
      <Container className="flex flex-col gap-16">
        <SectionHeading
          eyebrow="The toolbox"
          title="Everything you can do with a PDF"
          description="A complete, categorized toolkit — from everyday merges and conversions to redaction, e-signatures, and AI. Every tool tells you exactly where it runs."
        />

        {groups.map(({ category, tools: categoryTools }) => (
          <div key={category.id} className="flex flex-col gap-6">
            <div className="flex flex-col gap-4 border-b border-white/10 pb-5 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex items-center gap-4">
                <ToolIcon
                  icon={category.icon}
                  gradient={category.gradient}
                  size="lg"
                />
                <div className="flex flex-col gap-1">
                  <h3 className="text-xl font-semibold text-white">
                    {category.name}
                    <span className="ml-2 text-sm font-normal text-slate-500">
                      {categoryTools.length}
                    </span>
                  </h3>
                  <p className="max-w-xl text-sm text-slate-400">
                    {category.description}
                  </p>
                </div>
              </div>
              <Link
                href={`/tools?category=${category.id}`}
                className="group inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-violet-300 transition hover:text-violet-200"
              >
                View all
                <ArrowRight
                  className="size-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
