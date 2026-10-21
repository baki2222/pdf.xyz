import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, ShieldCheck } from "lucide-react";
import {
  getAllToolSlugs,
  getRelatedTools,
  getToolBySlug,
  tools,
} from "@/lib/tools";
import { continueTargetsFor } from "@/lib/intent/next-steps";
import { getCategory } from "@/lib/tools/categories";
import { getProcessingMeta } from "@/lib/tools/processing";
import { modeUploadsFiles } from "@/lib/tools/processing-split";
import { getRunnerKind } from "@/lib/pdf/registry";
import { Container } from "@/components/ui/container";
import { ToolIcon } from "@/components/ui/tool-icon";
import { ToolBadgePill } from "@/components/ui/badge";
import { ToolCard } from "@/components/tools/tool-card";
import { ProcessingBadge } from "@/components/tools/processing-badge";
import { FormatsLine } from "@/components/tools/formats-line";
import { ToolRunner } from "@/components/tools/runner/tool-runner";
import { ToolRunProvider } from "@/components/tools/runner/tool-context";
import { TicketRail } from "@/components/intent/ticket-rail";
import { WORKER_PANELS } from "@/components/tools/worker-panels";
import { ErrorBoundary } from "@/components/telemetry/error-boundary";
import { ToolTelemetry } from "@/components/telemetry/tool-telemetry";
import { capabilityForMode } from "@/lib/jobs/capabilities";
import { buildMetadata } from "@/lib/seo";
import { JsonLd } from "@/components/seo/json-ld";
import {
  breadcrumbSchema,
  faqPageSchema,
  howToSchema,
  toolApplicationSchema,
} from "@/lib/structured-data";
import { toolFacts } from "@/lib/tools/tool-facts";
import {
  pageDescription,
  pageFaq,
  pageGuides,
  pageIntro,
  pageSteps,
  pageTitle,
  pageUseCases,
} from "@/lib/tools/page-copy";
import { categoryHref } from "@/lib/tools/category-href";
import { ViewTransition } from "@/components/motion/vt";

export function generateStaticParams() {
  return getAllToolSlugs().map((slug) => ({ slug }));
}

/**
 * A slug that is not a tool must be a real 404, not a page that says so.
 *
 * `notFound()` below is reached only when this segment renders, and with
 * `dynamicParams` left at its default an unknown slug DOES render: Next serves
 * it on demand, caches it, and returns **200** with the not-found body. That is
 * a soft 404 — measured on production 2026-08-05, `/tools/does-not-exist-xyz`
 * answered `200` with `<title>Tool not found — pdf.xyz</title>` and 36 KB of
 * markup. Crawlers index the URL, and a `noIndex` tag only asks them not to.
 *
 * The catalogue is compiled in, so `generateStaticParams` above is the complete
 * and only source of valid slugs — there is no runtime origin for a new one.
 * Closing the set is therefore exact, and Next answers anything outside it with
 * a 404 status before this module runs.
 */
export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tool = getToolBySlug(slug);
  if (!tool) {
    return buildMetadata({ title: "Tool not found", noIndex: true });
  }
  return buildMetadata({
    // The authored, search-facing title and description
    // (`@/lib/tools/content`), keyword-first and unique per tool; the
    // catalogue's `seoTitle`, then the name, where a tool has none. The H1
    // stays the tool's name, and the canonical is unchanged.
    title: pageTitle(tool),
    description: pageDescription(tool),
    path: `/tools/${tool.slug}`,
    keywords: tool.keywords,
    // Every tool gets its own share card, leading with where it actually runs.
    imagePath: `/tools/${tool.slug}/opengraph-image`,
    imageAlt: `${tool.name} — ${tool.tagline}`,
  });
}

export default async function ToolPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tool = getToolBySlug(slug);
  if (!tool) notFound();

  const category = getCategory(tool.category);
  const processing = getProcessingMeta(tool.processing);
  const related = getRelatedTools(tool, 3);
  // Everything the page SAYS comes through `@/lib/tools/page-copy` — the same
  // accessors the honesty guards read, so a guard cannot certify copy this
  // page no longer renders. Authored content first; the derived copy (the
  // catalogue's steps or the mode-true default, the derived FAQ) where a tool
  // has none.
  const intro = pageIntro(tool);
  const useCases = pageUseCases(tool);
  const steps = pageSteps(tool);
  const facts = toolFacts(tool.slug);
  const faq = pageFaq(tool);
  // `guidesForTool`'s band — discovered from each guide's own `tools` field,
  // guides that teach this tool first, a reverse-direction guide left out —
  // with the guides this tool's authored content names first in each role.
  const toolGuides = pageGuides(tool);
  const runnerKind = getRunnerKind(tool.slug);
  /*
   * What runs this tool: its in-browser runner, or the worker panel the
   * registry routes it to (`@/components/tools/worker-panels`). There is no
   * third answer. The page used to end its panel chain in a `WorkerPreview`
   * fallback, and to give an in-browser tool without a runner an
   * `UploadZone` that staged files for the workspace; both rendered for zero
   * tools, so a slug that lost its route would have shipped a preview page
   * for a live tool. Now it fails the build here, and
   * `tool-page-registry.test.ts` names the slug before a build is needed.
   */
  const panel = runnerKind ? undefined : WORKER_PANELS[tool.slug];
  if (!runnerKind && !panel)
    throw new Error(
      `/tools/${tool.slug} has neither an in-browser runner nor a worker panel route`,
    );

  const breadcrumbs = [
    { name: "All tools", path: "/tools" },
    ...(category
      ? [{ name: category.name, path: categoryHref(category.id) }]
      : []),
    { name: tool.name, path: `/tools/${tool.slug}` },
  ];

  const useCaseList =
    useCases.length > 0 ? (
      <ul className="flex flex-col gap-3">
        {useCases.map((useCase) => (
          <li key={useCase.title} className="flex flex-col gap-1">
            <h3 className="text-fg text-sm font-semibold">{useCase.title}</h3>
            <p className="text-muted text-sm leading-relaxed">{useCase.body}</p>
          </li>
        ))}
      </ul>
    ) : null;

  const stepList = (
    <ol className="flex flex-col gap-3">
      {steps.map((step, i) => (
        <li key={i} className="flex items-start gap-3">
          {/* Was white-on-gradient (3.9:1, below AA); the token chip inverts the
              theme ground — 16.4:1 here, and correct inside any future scope.
              Square since WP-06: a number that counts a step is a tag. */}
          <span className="bg-invert text-fg-invert rounded-tag grid size-6 shrink-0 place-items-center text-xs font-semibold">
            {i + 1}
          </span>
          <span className="text-muted text-sm leading-relaxed">
            {step.title && (
              <span className="text-fg font-semibold">{step.title}. </span>
            )}
            {step.text}
          </span>
        </li>
      ))}
    </ol>
  );

  /*
   * The facts a reader checks before they pick a file: where the tool runs
   * and what goes in and out. One line, so on a phone the panel sits right
   * under the tool's name; it may scroll sideways rather than wrap, and
   * `e2e/tool-layout.mobile.spec.ts` holds that on every tool page today it
   * never has to.
   */
  const factsRow = (
    <div
      data-tool-facts
      className="-mx-5 flex [scrollbar-width:none] items-center gap-3 overflow-x-auto px-5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden"
    >
      <ProcessingBadge
        mode={tool.processing}
        variant="long"
        className="shrink-0"
      />
      <span className="border-line bg-wash rounded-tag inline-flex shrink-0 items-center border px-2.5 py-1">
        <FormatsLine tool={tool} />
      </span>
    </div>
  );

  /** The tool's name, what it does, and its facts: first on every layout. */
  const head = (
    <div className="flex flex-col gap-4 sm:gap-5">
      <div className="flex items-start gap-4">
        <ToolIcon icon={tool.icon} size="lg" />
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-fg text-4xl font-medium tracking-tight sm:text-5xl">
              {tool.name}
            </h1>
            {tool.badge && <ToolBadgePill badge={tool.badge} />}
          </div>
          <p className="text-muted text-base">{tool.tagline}</p>
        </div>
      </div>
      {factsRow}
    </div>
  );

  const breadcrumb = (
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
      {category && (
        <Link
          href={categoryHref(category.id)}
          className="hover:text-fg transition-colors"
        >
          {category.name}
        </Link>
      )}
    </nav>
  );

  return (
    /* The page's top padding is one variable (`--tool-page-pt`): the
       workbench's first screen subtracts it, with the header's, from the
       screen's height, so the two cannot drift apart. */
    <div className="bg-canvas text-fg pt-[var(--tool-page-pt)] pb-10 [--tool-page-pt:2.5rem] sm:pb-14 sm:[--tool-page-pt:3.5rem]">
      {/* Names this page's tool for run-outcome telemetry and sends
          `tool_viewed`. Renders nothing. */}
      <ToolTelemetry
        toolSlug={tool.slug}
        capability={capabilityForMode(tool.processing)}
      />
      <JsonLd
        data={[
          toolApplicationSchema(tool),
          breadcrumbSchema(breadcrumbs),
          howToSchema(tool.name, steps),
          ...(faq.length > 0
            ? [faqPageSchema(faq.map((e) => ({ q: e.question, a: e.answer })))]
            : []),
        ]}
      />
      <Container className="flex flex-col gap-6 sm:gap-10">
        {/* The workbench draws its breadcrumb inside its first screen. */}
        {!runnerKind && breadcrumb}
        {runnerKind ? (
          /* ── Workbench: the in-browser runner, under the head ── */
          <div className="flex flex-col gap-6 sm:gap-8">
            {/*
             * THE FIRST SCREEN IS THE WORKBENCH'S. The breadcrumb, the
             * tool's name and its panel are held to the bottom of the screen
             * from the first paint (`100svh`, less the sticky header and the
             * page's top padding), and the panel takes what is left of it.
             * So what follows the runner — About this tool, from 638 px down
             * at 1280 x 900 — starts below the screen on every tool page,
             * and nothing a pick, a result or its ending draws can move
             * anything on screen but the panel's own contents.
             *
             * WHY (2026-10-11): the About section sat on screen under the
             * drop sheet at every size from 360 x 800 to 2560 x 1440, and a
             * runner grows by hundreds of pixels after a pick — long after
             * the pick's input window when the file was dropped, pasted or
             * handed over. Compress PDF's held stage moved it once, at the
             * pick: page CLS 0.0567 at 1280 x 900 and 0.1212 at 768 x 1024;
             * Merge PDF 0.2133 at 390 x 844, Edit PDF 1.39. A stage held to
             * the result's size moves what follows at the pick instead of
             * at the result; only a screen that has nothing under the runner
             * to move holds still at both. `e2e/continue-chain.spec.ts`
             * measures every tool with an ending at eight sizes.
             *
             * `svh`, not `vh`: the small viewport, so a phone's collapsing
             * address bar never resizes it under a reader.
             */}
            <div
              data-first-screen
              className="flex min-h-[calc(100svh_-_var(--sf-header-h)_-_var(--tool-page-pt))] flex-col gap-6 sm:gap-10"
            >
              {breadcrumb}
              <div className="flex flex-1 flex-col gap-6 sm:gap-8">
                {head}

                {/* `data-tool-name`: the tool this page is, for what its
                    drop boxes tell the page — "Release to add to Merge
                    PDF", "Replaced a.pdf with b.pdf in Rotate PDF." — read
                    by the drop engine when a file arrives, so no box
                    carries the name in its code (`toolNameAt`,
                    `@/lib/intent/drop-engine`). */}
                <div
                  data-tool-panel
                  data-tool-name={tool.name}
                  className="border-line bg-panel rounded-panel flex flex-1 flex-col gap-5 border p-5 sm:p-7"
                >
                  {/* The job this run is part of: the tool, where its output
                      can go next — computed HERE, on the server, from the
                      catalogue, and handed over as data — and the steps the
                      files came through, which the runner's hand-off fills
                      in. */}
                  <ToolRunProvider
                    tool={{
                      slug: tool.slug,
                      name: tool.name,
                      category: tool.category,
                    }}
                    plan={continueTargetsFor(tool, tools)}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
                      <div className="text-ok flex items-center gap-2 text-sm">
                        <ShieldCheck className="size-4 shrink-0" aria-hidden />
                        {/* Gated on the PROPERTY (can this file leave the
                            device?), not on `=== "hybrid"`. The fallback
                            branch here is the STRONG claim — "never leaves
                            your device" — so a mode the condition did not
                            anticipate defaulted into a promise rather than
                            out of one. `modeUploadsFiles` is exhaustive over
                            ProcessingMode by construction, so a new mode is a
                            compile error instead of a false promise. */}
                        {modeUploadsFiles(tool.processing)
                          ? "Analyzed privately in your browser. Any secure-worker step is optional and clearly labeled before a file is uploaded."
                          : "Runs in your browser — your file never leaves your device."}
                      </div>
                      <TicketRail />
                    </div>
                    {/* The runner's stage: the rest of the panel. While a
                        runner shows its page's drop sheet and nothing else
                        of its kind (an empty state), the runner fills the
                        stage and the sheet takes the room, so the first
                        screen is one sheet to drop on — never a short sheet
                        over a blank panel. Only then: a sheet that shares
                        its runner with a list, an editor or a run bar
                        (Image to PDF, Compare, Text to PDF) keeps its own
                        height, because a sheet that gave its room back as
                        files arrived would move its own words (measured:
                        JPG to PDF 0.0196 at 360 x 800, the sheet's mark and
                        sentence drawn up 57 px). A result does not stretch:
                        it is drawn at its own size, from the top. Held from
                        a Run press — never past the bottom of the screen once
                        the run settles, the rest given back at the reader's
                        next click or key (`./stage-hold` in the runner kit). */}
                    <ViewTransition name="work-sheet">
                      <div
                        data-runner-stage
                        className="flex flex-1 flex-col [&>*>[data-page-drop-target]:only-of-type]:grow [&>:has(>[data-page-drop-target]:only-of-type)]:grow"
                      >
                        <ErrorBoundary boundary="tool-runner">
                          <ToolRunner kind={runnerKind} slug={tool.slug} />
                        </ErrorBoundary>
                      </div>
                    </ViewTransition>
                  </ToolRunProvider>
                </div>
              </div>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <div className="border-line bg-panel rounded-panel flex flex-col gap-3 border p-5">
                <h2 className="text-faint kicker">About this tool</h2>
                {intro.map((paragraph, i) => (
                  <p
                    key={i}
                    className={`${i === 0 ? "text-fg" : "text-muted"} text-sm leading-relaxed`}
                  >
                    {paragraph}
                  </p>
                ))}
                <p className="text-muted text-sm leading-relaxed">
                  {processing.description}
                </p>
                {useCaseList}
              </div>
              {steps.length > 0 && (
                <div className="border-line bg-panel rounded-panel flex flex-col gap-4 border p-5">
                  <h2 className="text-faint kicker">How it works</h2>
                  {stepList}
                </div>
              )}
            </div>
          </div>
        ) : (
          /*
           * ── Worker and AI tools: head, panel, details ──
           * DOM order is head → panel → details, so on a phone the panel
           * comes right after the tool's name (it was under the whole
           * introduction: 2,192px down on Word to PDF at 390px), with no
           * placement needed. From `lg` the panel takes a sticky second
           * column spanning both rows, beside the head and the details, as
           * before. Placed by column and row, not `grid-template-areas`: an
           * areas value needs quotes, and a quoted arbitrary class broke the
           * stylesheet scanner the motion guards read (fixed there too).
           *
           * Rows `auto 1fr`, never two auto rows: a spanning panel taller
           * than the head and the details shares its extra height into every
           * auto row it spans, so row 1 grew past the head, a gap opened
           * above the details, and it grew again when the worker status
           * answered and the panel grew — the details moved 45-57px after
           * the answer at 1440, CLS 0.1028 on Protect PDF at 1280 (WP-06
           * review, 2026-10-10). With a flexible row 2 the panel's extra
           * height goes there alone, so the details sit one row gap under
           * the head whatever the panel does (`e2e/layout-stability.spec.ts`
           * measures it on every worker panel, before and after the answer).
           */
          <div className="grid gap-10 lg:grid-cols-[1fr_1.05fr] lg:grid-rows-[auto_1fr] lg:items-start lg:gap-y-6">
            <div className="lg:col-start-1 lg:row-start-1">{head}</div>

            <div
              data-tool-panel
              data-tool-name={tool.name}
              className="self-start lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1"
            >
              {panel && (
                // The same job as the workbench's: the result card reads
                // where its output can go next — or, after Protect PDF and
                // PDF to PDF/A, why nowhere (`ResultCard`).
                <ToolRunProvider
                  tool={{
                    slug: tool.slug,
                    name: tool.name,
                    category: tool.category,
                  }}
                  plan={continueTargetsFor(tool, tools)}
                >
                  <ErrorBoundary boundary={panel.boundary}>
                    <panel.Panel tool={tool} />
                  </ErrorBoundary>
                </ToolRunProvider>
              )}
            </div>

            <div className="flex flex-col gap-6 lg:col-start-1 lg:row-start-2">
              {intro.map((paragraph, i) => (
                <p
                  key={i}
                  className={`${i === 0 ? "text-fg text-base" : "text-muted text-sm"} leading-relaxed text-pretty`}
                >
                  {paragraph}
                </p>
              ))}

              <p className="border-line bg-wash text-muted rounded-panel border p-4 text-sm leading-relaxed">
                {processing.description}
              </p>

              {useCaseList && (
                <div className="flex flex-col gap-4">
                  <h2 className="text-faint kicker">When to use it</h2>
                  {useCaseList}
                </div>
              )}

              {steps.length > 0 && (
                <div className="flex flex-col gap-4">
                  <h2 className="text-faint kicker">How it works</h2>
                  {stepList}
                </div>
              )}
            </div>
          </div>
        )}

        {(facts.length > 0 || faq.length > 0) && (
          <div className="grid gap-6 sm:grid-cols-2">
            {facts.length > 0 && (
              <div className="border-line bg-panel rounded-panel flex flex-col gap-4 border p-5">
                <h2 className="text-faint kicker">What this tool can do</h2>
                <dl className="flex flex-col gap-3">
                  {facts.map((fact) => (
                    <div key={fact.label} className="flex flex-col gap-1">
                      <dt className="text-faint font-mono text-[11px] font-medium tracking-wide uppercase">
                        {fact.label}
                      </dt>
                      <dd className="text-muted text-sm leading-relaxed">
                        {fact.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            {faq.length > 0 && (
              <div className="border-line bg-panel rounded-panel flex flex-col gap-4 border p-5">
                <h2 className="text-faint kicker">Common questions</h2>
                {faq.map((entry) => (
                  <div key={entry.question} className="flex flex-col gap-1.5">
                    <h3 className="text-fg text-sm font-semibold">
                      {entry.question}
                    </h3>
                    <p className="text-muted text-sm leading-relaxed">
                      {entry.answer}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {related.length > 0 && (
          <div className="border-line flex flex-col gap-6 border-t pt-10">
            <div className="flex items-end justify-between gap-4">
              <h2 className="font-display text-fg text-2xl font-medium tracking-tight">
                Related tools
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
              {related.map((item) => (
                <ToolCard key={item.slug} tool={item} />
              ))}
            </div>
          </div>
        )}

        {toolGuides.length > 0 && (
          <div className="border-line flex flex-col gap-6 border-t pt-10">
            <div className="flex items-end justify-between gap-4">
              <h2 className="font-display text-fg text-2xl font-medium tracking-tight">
                Guides
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {toolGuides.map(({ guide, role }) => (
                <Link
                  key={guide.slug}
                  href={`/guides/${guide.slug}`}
                  className="border-line bg-panel hover:border-line-strong rounded-panel flex flex-col gap-2 border p-5 transition-colors"
                >
                  <span className="text-faint font-mono text-[11px] font-medium tracking-wide uppercase">
                    {role === "primary"
                      ? "Step-by-step guide"
                      : "Related guide"}
                  </span>
                  <h3 className="text-fg text-sm font-semibold text-balance">
                    {guide.title}
                  </h3>
                  <p className="text-muted text-sm leading-relaxed">
                    {guide.description}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        )}

        <p className="text-muted inline-flex items-center gap-2 text-xs">
          <Check className="text-ok size-3.5" aria-hidden />
          No sign-up required. Your files stay on your device until you run a
          tool.
        </p>
      </Container>
    </div>
  );
}
