import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { getAllGuideSlugs, getGuideBySlug, relatedGuides } from "@/lib/guides";
import { getToolBySlug } from "@/lib/tools";
import type { Tool } from "@/lib/tools/types";
import { Container } from "@/components/ui/container";
import { ToolCard } from "@/components/tools/tool-card";
import { buttonVariants } from "@/components/ui/button";
import { proseMeasure } from "@/components/ui/prose";
import { cn } from "@/lib/utils";
import { buildMetadata } from "@/lib/seo";
import { JsonLd } from "@/components/seo/json-ld";
import { GuideDesk } from "@/components/intent/guide-desk";
import { guideDeskProps } from "@/lib/guides/desk";
import {
  articleSchema,
  breadcrumbSchema,
  faqPageSchema,
  namedHowToSchema,
} from "@/lib/structured-data";

export function generateStaticParams() {
  return getAllGuideSlugs().map((slug) => ({ slug }));
}

/**
 * Same reasoning as /tools/[slug], where the defect was measured: with
 * `dynamicParams` at its default an unknown slug renders the not-found body
 * with a **200** — a soft 404 crawlers index. The guides catalogue is compiled
 * in, so `generateStaticParams` above is the complete and only source of valid
 * slugs, and everything outside it must be refused with a real 404 status.
 */
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const guide = getGuideBySlug(slug);
  // An unknown param gets the 404's own head, never metadata of its own:
  // `buildMetadata` with no path declares `/` canonical, which is the defect
  // `not-found-metadata.test.ts` removed from the 404. Unreachable while
  // `dynamicParams` is false, and held by that test regardless.
  if (!guide) notFound();
  return buildMetadata({
    title: guide.title,
    description: guide.description,
    path: `/guides/${guide.slug}`,
    keywords: [...guide.keywords],
    // The site-wide share card, deliberately: buildMetadata always sets
    // explicit openGraph images, so no per-guide image route exists to shadow.
  });
}

/**
 * Body copy for the long-form parts of a guide: intro, steps, section bodies
 * and FAQ answers. Was `text-sm` (14px) across the full 768px article column,
 * well over 100 characters a line. See {@link proseMeasure}.
 */
const PROSE = cn("text-muted", proseMeasure);

/** The guide's way into the tool it teaches: a real button, not a text link. */
function OpenToolButton({ tool }: { tool: Tool }) {
  return (
    <Link
      href={`/tools/${tool.slug}`}
      className={buttonVariants({ variant: "primary", size: "lg" })}
    >
      Open {tool.name}
      <ArrowRight className="size-4" aria-hidden />
    </Link>
  );
}

export default async function GuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const guide = getGuideBySlug(slug);
  if (!guide) notFound();

  // Resolved through the catalogue accessor, and a dead slug is a test
  // failure in the guides catalogue suite before it can be a dead link here.
  const guideTools = guide.tools
    .map((toolSlug) => getToolBySlug(toolSlug))
    .filter((tool): tool is Tool => tool !== undefined);
  const primary = guideTools[0];
  const moreGuides = relatedGuides(guide);

  const breadcrumbs = [
    { name: "Home", path: "/" },
    { name: "Guides", path: "/guides" },
    { name: guide.title, path: `/guides/${guide.slug}` },
  ];

  return (
    <div className="bg-canvas text-fg py-10 sm:py-14">
      <JsonLd
        data={[
          articleSchema(guide),
          breadcrumbSchema(breadcrumbs),
          // The title already reads "How to …"; `howToSchema` would prefix
          // "How to use" and ship "How to use How to merge PDF files".
          namedHowToSchema(guide.title, guide.steps),
          ...(guide.faq.length > 0
            ? [
                faqPageSchema(
                  guide.faq.map((entry) => ({
                    q: entry.question,
                    a: entry.answer,
                  })),
                ),
              ]
            : []),
        ]}
      />
      <Container className="flex flex-col gap-10">
        <nav
          aria-label="Breadcrumb"
          className="text-muted flex items-center gap-2 text-sm"
        >
          <Link
            href="/guides"
            className="hover:text-fg inline-flex items-center gap-1.5 transition-colors"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            All guides
          </Link>
          {primary && (
            <>
              <span aria-hidden>/</span>
              <Link
                href={`/tools/${primary.slug}`}
                className="hover:text-fg transition-colors"
              >
                {primary.name}
              </Link>
            </>
          )}
        </nav>

        <article className="mx-auto flex w-full max-w-3xl flex-col gap-10">
          <header className="flex flex-col gap-4">
            {primary && (
              <span className="text-accent kicker">{primary.name}</span>
            )}
            <h1 className="font-display text-fg text-3xl font-medium tracking-tight text-balance sm:text-4xl">
              {guide.title}
            </h1>
            <p className="text-muted text-xs">
              Updated{" "}
              <time dateTime={guide.updated} className="font-mono">
                {guide.updated}
              </time>
            </p>
          </header>

          <div className="flex flex-col items-start gap-5">
            {guide.intro.map((paragraph) => (
              <p key={paragraph} className={PROSE}>
                {paragraph}
              </p>
            ))}
            {primary && <GuideDesk {...guideDeskProps(primary)} />}
            {primary && <OpenToolButton tool={primary} />}
          </div>

          <section
            id="steps"
            className="border-line bg-panel flex scroll-mt-24 flex-col gap-4 rounded-[4px] border p-5 sm:p-7"
          >
            <h2 className="text-faint kicker">Step by step</h2>
            <ol className="flex flex-col gap-3">
              {guide.steps.map((step, index) => (
                <li key={step} className="flex items-start gap-3">
                  {/* Square, like the tool pages' step numbers (D.9): a
                      number that counts a step is a tag. */}
                  <span className="bg-invert text-fg-invert rounded-tag grid size-6 shrink-0 place-items-center text-xs font-semibold">
                    {index + 1}
                  </span>
                  <span className={PROSE}>{step}</span>
                </li>
              ))}
            </ol>
          </section>

          {primary && <OpenToolButton tool={primary} />}

          {guide.sections.map((section) => (
            <section
              key={section.id}
              id={section.id}
              className="flex scroll-mt-24 flex-col gap-3"
            >
              <h2 className="text-fg text-lg font-semibold">
                {section.heading}
              </h2>
              {section.body.map((paragraph) => (
                <p key={paragraph} className={PROSE}>
                  {paragraph}
                </p>
              ))}
            </section>
          ))}

          {guide.faq.length > 0 && (
            <section
              id="faq"
              className="border-line bg-panel flex scroll-mt-24 flex-col gap-4 rounded-[4px] border p-5 sm:p-7"
            >
              <h2 className="text-faint kicker">Common questions</h2>
              {guide.faq.map((entry) => (
                <div key={entry.question} className="flex flex-col gap-1.5">
                  <h3 className="text-fg text-sm font-semibold">
                    {entry.question}
                  </h3>
                  <p className={PROSE}>{entry.answer}</p>
                </div>
              ))}
            </section>
          )}
        </article>

        {guideTools.length > 0 && (
          <div className="border-line flex flex-col gap-6 border-t pt-10">
            <div className="flex items-end justify-between gap-4">
              <h2 className="font-display text-fg text-2xl font-medium tracking-tight">
                Tools used in this guide
              </h2>
              <Link
                href="/tools"
                className="group text-accent inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
              >
                All tools
                <ArrowRight
                  className="size-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {guideTools.map((tool) => (
                <ToolCard key={tool.slug} tool={tool} />
              ))}
            </div>
          </div>
        )}

        {moreGuides.length > 0 && (
          <nav
            aria-labelledby="more-guides"
            className="border-line flex flex-col gap-6 border-t pt-10"
          >
            <div className="flex items-end justify-between gap-4">
              <h2
                id="more-guides"
                className="font-display text-fg text-2xl font-medium tracking-tight"
              >
                More guides
              </h2>
              <Link
                href="/guides"
                className="group text-accent inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
              >
                All guides
                <ArrowRight
                  className="size-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
            </div>
            <ul className="border-line grid grid-cols-1 gap-x-10 border-t md:grid-cols-3">
              {moreGuides.map((other) => {
                const otherPrimary = getToolBySlug(other.tools[0] ?? "");
                return (
                  <li key={other.slug} className="border-line border-b">
                    <Link
                      href={`/guides/${other.slug}`}
                      className="group hover:bg-wash flex h-full flex-col gap-0.5 py-4 pr-2 pl-1 transition-colors"
                    >
                      <span className="text-fg group-hover:text-accent text-[15px] font-medium transition-colors">
                        {other.title}
                      </span>
                      {otherPrimary && (
                        <span className="text-faint font-mono text-[11px] tracking-wide uppercase">
                          {otherPrimary.name}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
      </Container>
    </div>
  );
}
