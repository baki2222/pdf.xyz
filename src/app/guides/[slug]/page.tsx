import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import {
  getAllGuideSlugs,
  getGuideBySlug,
  guidesSharingATool,
  RELATED_GUIDE_LIMIT,
  relatedGuides,
  type Guide,
} from "@/lib/guides";
import { getToolBySlug } from "@/lib/tools";
import type { Tool } from "@/lib/tools/types";
import { Container } from "@/components/ui/container";
import { ToolCard } from "@/components/tools/tool-card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buildMetadata } from "@/lib/seo";
import { JsonLd } from "@/components/seo/json-ld";
import {
  GuideContents,
  type GuideContentsEntry,
} from "@/components/guides/guide-contents";
import { GuideDeskShell } from "@/components/intent/guide-desk-shell";
import { GuideDeskSlot } from "@/components/intent/guide-desk-slot";
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
 * and FAQ answers. D.9/B.4: 16px at every width (it was 15px below `sm`) in
 * the reading colour, not `text-muted`; secondary lines (the date, kickers)
 * stay muted. The measure is `proseMeasure`'s, in `em` for the reason that
 * file gives; it is restated here because that constant also carries the
 * policy pages' 15px phone size. `guide-page.test.tsx` holds the measure,
 * `guide-layout.test.tsx` the size and colour, `e2e/guide-article*.spec.ts`
 * the computed size in the browser.
 */
const PROSE = "text-fg max-w-[33em] text-base leading-7";

/** A list of links to other guides, under whichever heading the page uses. */
function GuideLinks({ list }: { list: readonly Guide[] }) {
  return (
    <ul className="border-line grid grid-cols-1 gap-x-10 border-t md:grid-cols-3">
      {list.map((other) => {
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
  );
}

/** "All guides", "All tools": the way out of a list to its index. */
function AllLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="group text-accent inline-flex shrink-0 items-center gap-1.5 text-sm font-medium hover:underline"
    >
      {children}
      <ArrowRight
        className="size-4 transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </Link>
  );
}

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
  // Related means sharing a tool.
  const related = guidesSharingATool(guide);
  // Topped up to RELATED_GUIDE_LIMIT from the catalogue, under "More guides"
  // (a heading that claims nothing), so no guide page is a dead end.
  const moreGuides = relatedGuides(guide)
    .filter((other) => !related.includes(other))
    .slice(0, Math.max(0, RELATED_GUIDE_LIMIT - related.length));

  // The contents, from the same values the sections below render from, in
  // their order (guide-layout.test.tsx holds the two equal).
  const contents: GuideContentsEntry[] = [
    { id: "steps", label: "Step by step" },
    ...guide.sections.map((section) => ({
      id: section.id,
      label: section.heading,
    })),
    ...(guide.faq.length > 0 ? [{ id: "faq", label: "Common questions" }] : []),
    ...(related.length > 0
      ? [{ id: "related-guides", label: "Related guides" }]
      : []),
    ...(guideTools.length > 0
      ? [{ id: "tools-used", label: "Tools used in this guide" }]
      : []),
  ];

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

        {/* From lg the contents take the left three columns, the article
            the other nine (centred in them); below lg the rail is hidden and
            the article is the grid's only item. Only classes that already
            ship: the stylesheet is at its ceiling (guide-contents.tsx). */}
        <div className="grid lg:grid-cols-12 lg:items-start lg:gap-x-10">
          <GuideContents entries={contents} variant="rail" />

          <article className="mx-auto flex w-full max-w-3xl flex-col gap-10 lg:col-span-9">
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

            <GuideContents entries={contents} variant="details" />

            <div className="flex flex-col items-start gap-5">
              {guide.intro.map((paragraph) => (
                <p key={paragraph} className={PROSE}>
                  {paragraph}
                </p>
              ))}
              {primary && (
                <GuideDeskSlot desk={guideDeskProps(primary)}>
                  <GuideDeskShell {...guideDeskProps(primary)} />
                </GuideDeskSlot>
              )}
              {primary && <OpenToolButton tool={primary} />}
            </div>

            <section
              id="steps"
              className="border-line bg-panel rounded-panel flex scroll-mt-24 flex-col gap-4 border p-5 sm:p-7"
            >
              <h2 className="text-faint kicker">Step by step</h2>
              <ol className="flex flex-col gap-3">
                {guide.steps.map((step, index) => (
                  <li key={step} className="flex items-start gap-3">
                    {/* Square, like the tool pages' step numbers (D.9): a
                        number that counts a step is a tag. */}
                    <span className="bg-invert text-fg-invert rounded-tag mt-0.5 grid size-6 shrink-0 place-items-center text-xs font-semibold">
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
                className="border-line bg-panel rounded-panel flex scroll-mt-24 flex-col gap-4 border p-5 sm:p-7"
              >
                <h2 className="text-faint kicker">Common questions</h2>
                {guide.faq.map((entry) => (
                  <div key={entry.question} className="flex flex-col gap-1.5">
                    <h3 className="text-fg text-base font-semibold">
                      {entry.question}
                    </h3>
                    <p className={PROSE}>{entry.answer}</p>
                  </div>
                ))}
              </section>
            )}

            {related.length > 0 && (
              <section
                id="related-guides"
                data-related-guides
                aria-labelledby="related-guides-heading"
                className="flex scroll-mt-24 flex-col gap-6"
              >
                <div className="flex items-end justify-between gap-4">
                  <h2
                    id="related-guides-heading"
                    className="font-display text-fg text-2xl font-medium tracking-tight"
                  >
                    Related guides
                  </h2>
                  <AllLink href="/guides">All guides</AllLink>
                </div>
                <GuideLinks list={related} />
              </section>
            )}

            {guideTools.length > 0 && (
              <section
                id="tools-used"
                aria-labelledby="tools-used-heading"
                className="border-line flex scroll-mt-24 flex-col gap-6 border-t pt-10"
              >
                <div className="flex items-end justify-between gap-4">
                  <h2
                    id="tools-used-heading"
                    className="font-display text-fg text-2xl font-medium tracking-tight"
                  >
                    Tools used in this guide
                  </h2>
                  <AllLink href="/tools">All tools</AllLink>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {guideTools.map((tool) => (
                    <ToolCard key={tool.slug} tool={tool} />
                  ))}
                </div>
              </section>
            )}

            {/* LAST child of the article, so it rides the whole article and
                stops at its end; below lg only, where the Open buttons have
                scrolled away. It sits on the consent banner's published
                inset, with a 0px fallback: a bare var() that is unset makes
                `bottom` invalid, and a sticky box with no bottom never
                sticks. Inline, because the stylesheet is at its ceiling and
                an attribute costs it nothing (CSP allows inline styles). */}
            {primary && (
              <div
                data-guide-open-bar
                style={{ bottom: "var(--sf-bottom-inset, 0px)" }}
                className="border-line bg-canvas sticky z-10 -mx-5 border-t px-5 py-3 lg:hidden"
              >
                <Link
                  href={`/tools/${primary.slug}`}
                  className={cn(
                    buttonVariants({ variant: "primary", size: "lg" }),
                    "w-full",
                  )}
                >
                  Open {primary.name}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </div>
            )}
          </article>
        </div>

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
              <AllLink href="/guides">All guides</AllLink>
            </div>
            <GuideLinks list={moreGuides} />
          </nav>
        )}
      </Container>
    </div>
  );
}
