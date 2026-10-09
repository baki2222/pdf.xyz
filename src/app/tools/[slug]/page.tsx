import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileDown,
  FileUp,
  ShieldCheck,
} from "lucide-react";
import { getAllToolSlugs, getRelatedTools, getToolBySlug } from "@/lib/tools";
import { getCategory } from "@/lib/tools/categories";
import { getProcessingMeta } from "@/lib/tools/processing";
import { stagingHint } from "@/lib/tools/file-ceilings";
import { modeUploadsFiles } from "@/lib/tools/processing-split";
import { getRunnerKind } from "@/lib/pdf/registry";
import { Container } from "@/components/ui/container";
import { ToolIcon } from "@/components/ui/tool-icon";
import { ToolBadgePill } from "@/components/ui/badge";
import { ToolCard } from "@/components/tools/tool-card";
import { ProcessingBadge } from "@/components/tools/processing-badge";
import { UploadZone } from "@/components/upload/upload-zone";
import { ToolRunner } from "@/components/tools/runner/tool-runner";
import { WorkerPreview } from "@/components/tools/worker-preview";
import {
  OcrWorkerPanel,
  PdfSecurityWorkerPanel,
  PdfStructureWorkerPanel,
  PdfArchiveWorkerPanel,
  HtmlRenderWorkerPanel,
  OfficeConversionWorkerPanel,
  PdfOfficeExportWorkerPanel,
  TableExtractWorkerPanel,
  RequestSignaturesWorkerPanel,
  SummarizeWorkerPanel,
  TranslateWorkerPanel,
  AiExtractWorkerPanel,
  ChatWithPdfWorkerPanel,
} from "@/components/tools/worker-panels";
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
   * THIS TOOL's ceiling, not the worker's. The staging hint below interpolated
   * `JOB_LIMITS.maxFileBytes` — 100 MB — for whatever tool rendered it, while
   * `image-to-pdf` refuses at 25 MB and `text-to-pdf` at 2 MB.
   *
   * Measured on 2026-08-22 before the change: that branch renders for a tool
   * that is `processing: "client"` AND has no runner, and the intersection of
   * those two sets is EMPTY — 29 client tools, 20 runner-less tools, 0 in both
   * — so the wrong number reached no reader. It was a loaded gun rather than a
   * live defect: removing any one runner would have shipped 100 MB on a page
   * whose gate refuses at 2 MB. `file-ceilings.test.ts` renders all fifty pages
   * and would fail on that the moment it happened.
   */
  const hint = stagingHint(tool);

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
              theme ground — 16.4:1 here, and correct inside any future scope. */}
          <span className="bg-invert text-fg-invert grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold">
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

  const formatChips = (
    <div className="flex flex-wrap items-center gap-2">
      <ProcessingBadge mode={tool.processing} variant="long" />
      <span className="border-line bg-wash text-muted inline-flex items-center gap-1.5 rounded-[2px] border px-2.5 py-1 font-mono text-[11px]">
        <FileUp className="text-faint size-3.5" aria-hidden />
        In: {tool.accept.join(", ")}
      </span>
      <span className="border-line bg-wash text-muted inline-flex items-center gap-1.5 rounded-[2px] border px-2.5 py-1 font-mono text-[11px]">
        <FileDown className="text-faint size-3.5" aria-hidden />
        Out: {tool.outputs.join(", ")}
      </span>
    </div>
  );

  return (
    <div className="bg-canvas text-fg py-10 sm:py-14">
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
      <Container className="flex flex-col gap-10">
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

        {runnerKind ? (
          /* ── Workbench layout: interactive, client-side tool runner ── */
          <div className="flex flex-col gap-8">
            <div className="flex flex-col gap-5">
              <div className="flex items-start gap-4">
                <ToolIcon icon={tool.icon} size="lg" />
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="font-display text-fg text-4xl font-medium tracking-tight sm:text-5xl">
                      {tool.name}
                    </h1>
                    {tool.badge && <ToolBadgePill badge={tool.badge} />}
                  </div>
                  <p className="text-muted text-base">{tool.tagline}</p>
                </div>
              </div>
              {formatChips}
            </div>

            <div className="border-line bg-panel flex flex-col gap-5 rounded-[4px] border p-5 sm:p-7">
              <div className="text-ok flex items-center gap-2 text-sm">
                <ShieldCheck className="size-4" aria-hidden />
                {/* Gated on the PROPERTY (can this file leave the device?),
                    not on `=== "hybrid"`. The fallback branch here is the
                    STRONG claim — "never leaves your device" — so a mode the
                    condition did not anticipate defaulted into a promise
                    rather than out of one. `modeUploadsFiles` is exhaustive
                    over ProcessingMode by construction, so a new mode is a
                    compile error instead of a false promise. */}
                {modeUploadsFiles(tool.processing)
                  ? "Analyzed privately in your browser. Any secure-worker step is optional and clearly labeled before a file is uploaded."
                  : "Runs in your browser — your file never leaves your device."}
              </div>
              <ErrorBoundary boundary="tool-runner">
                <ToolRunner kind={runnerKind} slug={tool.slug} />
              </ErrorBoundary>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <div className="border-line bg-panel flex flex-col gap-3 rounded-[4px] border p-5">
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
                <div className="border-line bg-panel flex flex-col gap-4 rounded-[4px] border p-5">
                  <h2 className="text-faint kicker">How it works</h2>
                  {stepList}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ── Overview layout: polished, implementation-ready placeholder ── */
          <div className="grid gap-10 lg:grid-cols-[1fr_1.05fr] lg:items-start">
            <div className="flex flex-col gap-6">
              <div className="flex items-start gap-4">
                <ToolIcon icon={tool.icon} size="lg" />
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="font-display text-fg text-4xl font-medium tracking-tight sm:text-5xl">
                      {tool.name}
                    </h1>
                    {tool.badge && <ToolBadgePill badge={tool.badge} />}
                  </div>
                  <p className="text-muted text-base">{tool.tagline}</p>
                </div>
              </div>

              {intro.map((paragraph, i) => (
                <p
                  key={i}
                  className={`${i === 0 ? "text-fg text-base" : "text-muted text-sm"} leading-relaxed text-pretty`}
                >
                  {paragraph}
                </p>
              ))}

              {formatChips}

              <p className="border-line bg-wash text-muted rounded-[4px] border p-4 text-sm leading-relaxed">
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

            <div className="lg:sticky lg:top-24">
              {!modeUploadsFiles(tool.processing) ? (
                /* Never-upload tool without a runner yet: stage files locally. */
                <div className="border-line bg-panel flex flex-col gap-5 rounded-[4px] border p-5 sm:p-7">
                  <div className="flex flex-col gap-1">
                    <h2 className="text-fg text-lg font-semibold">
                      {tool.name}
                    </h2>
                    <p className="text-muted text-sm">
                      Add your files to get started —{" "}
                      {processing.short.toLowerCase()}.
                    </p>
                  </div>
                  <UploadZone
                    ctaLabel={`Run ${tool.name}`}
                    ctaHref={`/workspace?tool=${tool.slug}`}
                    hint={hint}
                  />
                </div>
              ) : tool.slug === "ocr-pdf" ? (
                /* OCR: a premium, OCR-specific secure-worker flow (honest, live
                   capability check, real job path when a worker is available). */
                <ErrorBoundary boundary="ocr-worker-panel">
                  <OcrWorkerPanel tool={tool} />
                </ErrorBoundary>
              ) : tool.slug === "protect-pdf" || tool.slug === "unlock-pdf" ? (
                /* Protect / Unlock: a qpdf-backed secure-worker flow (honest, live
                   capability check, real job path with a masked password field). */
                <ErrorBoundary boundary="pdf-security-worker-panel">
                  <PdfSecurityWorkerPanel tool={tool} />
                </ErrorBoundary>
              ) : tool.slug === "repair-pdf" || tool.slug === "optimize-web" ? (
                /* Repair / Optimize for Web: qpdf-backed structure operations with
                   the same honest secure-worker lifecycle and real output download. */
                <ErrorBoundary boundary="pdf-structure-worker-panel">
                  <PdfStructureWorkerPanel tool={tool} />
                </ErrorBoundary>
              ) : tool.slug === "pdf-to-pdfa" ? (
                /* PDF/A: Ghostscript-backed secure-worker conversion with real output download. */
                <ErrorBoundary boundary="pdf-archive-worker-panel">
                  <PdfArchiveWorkerPanel tool={tool} />
                </ErrorBoundary>
              ) : tool.slug === "html-to-pdf" ||
                tool.slug === "webpage-to-pdf" ? (
                /* HTML/Webpage to PDF: Chromium-backed secure-worker conversion with real output download. */
                <ErrorBoundary boundary="html-render-worker-panel">
                  <HtmlRenderWorkerPanel tool={tool} />
                </ErrorBoundary>
              ) : tool.slug === "word-to-pdf" ||
                tool.slug === "excel-to-pdf" ||
                tool.slug === "powerpoint-to-pdf" ? (
                /* Office to PDF: LibreOffice-backed secure-worker conversion with real output download. */
                <ErrorBoundary boundary="office-conversion-worker-panel">
                  <OfficeConversionWorkerPanel tool={tool} />
                </ErrorBoundary>
              ) : tool.slug === "pdf-to-word" ||
                tool.slug === "pdf-to-excel" ||
                tool.slug === "pdf-to-powerpoint" ? (
                /* PDF to Office: selectable-text worker export with real Office Open XML output download. */
                <ErrorBoundary boundary="pdf-office-export-worker-panel">
                  <PdfOfficeExportWorkerPanel tool={tool} />
                </ErrorBoundary>
              ) : tool.slug === "extract-tables" ? (
                /* Extract Tables: pdfjs positioned-text layout detection with real
                   CSV + XLSX output packaged in a ZIP on the secure worker. */
                <ErrorBoundary boundary="table-extract-worker-panel">
                  <TableExtractWorkerPanel tool={tool} />
                </ErrorBoundary>
              ) : tool.slug === "request-signatures" ? (
                /* Request Signatures: pdf-lib field preparation packaged as a real
                   signature-request ZIP (prepared PDF + manifest + audit) on the worker. */
                <ErrorBoundary boundary="request-signatures-worker-panel">
                  <RequestSignaturesWorkerPanel tool={tool} />
                </ErrorBoundary>
              ) : tool.slug === "summarize-pdf" ? (
                /* Summarize PDF: selectable-text extraction summarized by a configured
                   AI provider, packaged as a real summary ZIP (md + txt + manifest) on
                   the worker. Fails honestly when no provider is configured — never faked. */
                <ErrorBoundary boundary="summarize-worker-panel">
                  <SummarizeWorkerPanel tool={tool} />
                </ErrorBoundary>
              ) : tool.slug === "translate-pdf" ? (
                /* Translate PDF: selectable-text extraction translated by a configured
                   AI provider, packaged as a real translation ZIP (md + txt + manifest)
                   on the worker. Fails honestly when no provider is configured — never faked. */
                <ErrorBoundary boundary="translate-worker-panel">
                  <TranslateWorkerPanel tool={tool} />
                </ErrorBoundary>
              ) : tool.slug === "ai-extract" ? (
                /* AI Data Extraction: selectable-text extraction turned into structured
                   JSON by a configured AI provider, packaged as a real extraction ZIP
                   (extraction.json + model-output.json + extraction.md + manifest) on the worker. Fails
                   honestly when no provider is configured or the reply isn't JSON — never faked. */
                <ErrorBoundary boundary="ai-extract-worker-panel">
                  <AiExtractWorkerPanel tool={tool} />
                </ErrorBoundary>
              ) : tool.slug === "chat-with-pdf" ? (
                /* Chat with PDF: selectable-text extraction answered by a configured
                   AI provider from ONLY the document text, with page-level [p.N]
                   citations when page metadata is present, packaged as a real answer ZIP
                   (answer.md + answer.txt + manifest) on the worker. Fails honestly when
                   no provider is configured or the PDF has no selectable text — never faked. */
                <ErrorBoundary boundary="chat-with-pdf-worker-panel">
                  <ChatWithPdfWorkerPanel tool={tool} />
                </ErrorBoundary>
              ) : (
                /* Secure-worker / hybrid / AI tool: honest future-flow preview. */
                <WorkerPreview tool={tool} />
              )}
            </div>
          </div>
        )}

        {(facts.length > 0 || faq.length > 0) && (
          <div className="grid gap-6 sm:grid-cols-2">
            {facts.length > 0 && (
              <div className="border-line bg-panel flex flex-col gap-4 rounded-[4px] border p-5">
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
              <div className="border-line bg-panel flex flex-col gap-4 rounded-[4px] border p-5">
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
                  className="border-line bg-panel hover:border-line-strong flex flex-col gap-2 rounded-[4px] border p-5 transition-colors"
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
