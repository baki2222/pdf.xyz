import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { categoryIds, getCategoryLanding } from "@/lib/tools/category-landing";
import { categoryHref } from "@/lib/tools/category-href";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { ToolCard } from "@/components/tools/tool-card";
import { JsonLd } from "@/components/seo/json-ld";
import { buildMetadata } from "@/lib/seo";
import {
  breadcrumbSchema,
  categoryCollectionSchema,
} from "@/lib/structured-data";

/**
 * /tools/category/[category] — one indexable landing page per tool category.
 *
 * WHY THESE EXIST: category links used to go to `/tools?category=<id>`, a
 * filtered view whose canonical is `/tools`. Eight category intents had no page
 * that could rank, and the header, footer and every tool breadcrumb pointed at
 * URLs that declared themselves duplicates. `/tools?category=` still filters
 * (the explorer reads it), but nothing links it any more — links are built by
 * `categoryHref`.
 *
 * The set is `categories`, closed: a ninth category gets a page by existing,
 * and anything else is a real 404, not a 200 that says "not found" (the soft
 * 404 `tools/[slug]/page.tsx` documents measuring on production).
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return categoryIds().map((category) => ({ category }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category } = await params;
  const landing = getCategoryLanding(category);
  if (!landing) {
    return buildMetadata({ title: "Category not found", noIndex: true });
  }
  return buildMetadata({
    title: landing.copy.title,
    description: landing.copy.description,
    path: landing.path,
    keywords: [...landing.copy.keywords],
    imagePath: "/tools/opengraph-image",
    imageAlt: `${landing.copy.heading} — pdf.xyz`,
  });
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category: id } = await params;
  const landing = getCategoryLanding(id);
  if (!landing) notFound();
  const { category, copy, tools, runs, guides, siblings } = landing;

  const breadcrumbs = [
    { name: "All tools", path: "/tools" },
    { name: category.name, path: landing.path },
  ];

  return (
    <div className="bg-canvas text-fg py-10 sm:py-14">
      <JsonLd
        data={[
          breadcrumbSchema(breadcrumbs),
          categoryCollectionSchema({
            path: landing.path,
            name: copy.heading,
            description: copy.description,
            tools,
          }),
        ]}
      />
      <Container className="flex flex-col gap-12">
        <nav
          aria-label="Breadcrumb"
          className="text-muted flex items-center gap-2 text-sm"
        >
          <Link
            href="/tools"
            className="hover:text-fg inline-flex items-center gap-1.5 transition-colors"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            All tools
          </Link>
          <span aria-hidden>/</span>
          <span aria-current="page" className="text-fg">
            {category.name}
          </span>
        </nav>

        <div className="flex flex-col gap-6">
          <SectionHeading
            as="h1"
            eyebrow={category.name}
            title={copy.heading}
            description={copy.intro}
          />
          <ul
            aria-label="Where these tools run"
            className="text-muted flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs"
          >
            {runs.map((entry) => (
              <li key={entry.mode}>
                {entry.label}:{" "}
                <span className="text-fg tabular-nums">{entry.count}</span>
              </li>
            ))}
          </ul>
        </div>

        <section
          aria-labelledby="category-tools"
          className="flex flex-col gap-4"
        >
          <h2
            id="category-tools"
            className="font-display text-fg text-2xl font-medium tracking-tight"
          >
            Every tool in this category
            <span className="text-faint ml-2.5 align-middle font-mono text-xs font-normal tracking-normal">
              {tools.length}
            </span>
          </h2>
          <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
            {tools.map((tool) => (
              <ToolCard key={tool.slug} tool={tool} />
            ))}
          </div>
        </section>

        {guides.length > 0 && (
          <section
            aria-labelledby="category-guides"
            className="border-line flex flex-col gap-4 border-t pt-10"
          >
            <h2
              id="category-guides"
              className="font-display text-fg text-2xl font-medium tracking-tight"
            >
              Guides
            </h2>
            <ul className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
              {guides.map((guide) => (
                <li key={guide.slug} className="border-line border-b">
                  <Link
                    href={`/guides/${guide.slug}`}
                    className="group hover:bg-wash flex items-center justify-between gap-4 px-1 py-3.5 transition-colors"
                  >
                    <span className="text-fg group-hover:text-accent text-[15px] font-medium transition-colors">
                      {guide.title}
                    </span>
                    <ArrowRight
                      className="text-faint size-4 shrink-0"
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section
          aria-labelledby="other-categories"
          className="border-line flex flex-col gap-4 border-t pt-10"
        >
          <h2
            id="other-categories"
            className="font-display text-fg text-2xl font-medium tracking-tight"
          >
            Other categories
          </h2>
          <ul className="grid grid-cols-1 gap-x-8 sm:grid-cols-2 lg:grid-cols-4">
            {siblings.map((sibling) => (
              <li key={sibling.id} className="border-line border-b">
                <Link
                  href={categoryHref(sibling.id)}
                  className="group hover:bg-wash flex flex-col gap-1 px-1 py-3.5 transition-colors"
                >
                  <span className="text-fg group-hover:text-accent text-[15px] font-medium transition-colors">
                    {sibling.name}
                  </span>
                  <span className="text-muted text-sm leading-relaxed">
                    {sibling.description}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </Container>
    </div>
  );
}
