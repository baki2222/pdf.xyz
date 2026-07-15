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
import {
  getAllToolSlugs,
  getRelatedTools,
  getToolBySlug,
} from "@/lib/tools";
import { getCategory } from "@/lib/tools/categories";
import { getProcessingMeta } from "@/lib/tools/processing";
import { getRunnerKind } from "@/lib/pdf/registry";
import { Container } from "@/components/ui/container";
import { ToolIcon } from "@/components/ui/tool-icon";
import { ToolBadgePill } from "@/components/ui/badge";
import { ToolCard } from "@/components/tools/tool-card";
import { ProcessingBadge } from "@/components/tools/processing-badge";
import { UploadZone } from "@/components/upload/upload-zone";
import { ToolRunner } from "@/components/tools/runner/tool-runner";
import { WorkerPreview } from "@/components/tools/worker-preview";
import { OcrWorkerPanel } from "@/components/tools/ocr-worker-panel";
import { PdfSecurityWorkerPanel } from "@/components/tools/pdf-security-worker-panel";
import { PdfStructureWorkerPanel } from "@/components/tools/pdf-structure-worker-panel";
import { PdfArchiveWorkerPanel } from "@/components/tools/pdf-archive-worker-panel";
import { HtmlRenderWorkerPanel } from "@/components/tools/html-render-worker-panel";
import { OfficeConversionWorkerPanel } from "@/components/tools/office-conversion-worker-panel";
import { PdfOfficeExportWorkerPanel } from "@/components/tools/pdf-office-export-worker-panel";
import { TableExtractWorkerPanel } from "@/components/tools/table-extract-worker-panel";
import { RequestSignaturesWorkerPanel } from "@/components/tools/request-signatures-worker-panel";
import { ErrorBoundary } from "@/components/telemetry/error-boundary";
import { buildMetadata } from "@/lib/seo";
import { JsonLd } from "@/components/seo/json-ld";
import {
  breadcrumbSchema,
  toolApplicationSchema,
} from "@/lib/structured-data";

export function generateStaticParams() {
  return getAllToolSlugs().map((slug) => ({ slug }));
}

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
    title: tool.name,
    description: tool.description,
    path: `/tools/${tool.slug}`,
    keywords: tool.keywords,
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
  const steps = tool.how ?? [];
  const runnerKind = getRunnerKind(tool.slug);

  const breadcrumbs = [
    { name: "All tools", path: "/tools" },
    ...(category
      ? [{ name: category.name, path: `/tools?category=${category.id}` }]
      : []),
    { name: tool.name, path: `/tools/${tool.slug}` },
  ];

  const formatChips = (
    <div className="flex flex-wrap items-center gap-2">
      <ProcessingBadge mode={tool.processing} variant="long" />
      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
        <FileUp className="size-3.5 text-slate-400" aria-hidden />
        In: {tool.accept.join(", ")}
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
        <FileDown className="size-3.5 text-slate-400" aria-hidden />
        Out: {tool.outputs.join(", ")}
      </span>
    </div>
  );

  return (
    <div className="py-10 sm:py-14">
      <JsonLd
        data={[toolApplicationSchema(tool), breadcrumbSchema(breadcrumbs)]}
      />
      <Container className="flex flex-col gap-10">
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-2 text-sm text-slate-500"
        >
          <Link
            href="/tools"
            className="inline-flex items-center gap-1.5 transition hover:text-white"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            All tools
          </Link>
          <span aria-hidden>/</span>
          {category && (
            <Link
              href={`/tools?category=${category.id}`}
              className="transition hover:text-white"
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
                <ToolIcon
                  icon={tool.icon}
                  gradient={category?.gradient}
                  size="lg"
                />
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                      {tool.name}
                    </h1>
                    {tool.badge && <ToolBadgePill badge={tool.badge} />}
                  </div>
                  <p className="text-base text-slate-400">{tool.tagline}</p>
                </div>
              </div>
              {formatChips}
            </div>

            <div className="gradient-border">
              <div className="glass flex flex-col gap-5 rounded-3xl p-5 sm:p-7">
                <div className="flex items-center gap-2 text-sm text-emerald-300">
                  <ShieldCheck className="size-4" aria-hidden />
                  {tool.processing === "hybrid"
                    ? "Analyzed privately in your browser. Any secure-worker step is optional and clearly labeled before a file is uploaded."
                    : "Runs in your browser — your file never leaves your device."}
                </div>
                <ErrorBoundary boundary="tool-runner">
                  <ToolRunner kind={runnerKind} slug={tool.slug} />
                </ErrorBoundary>
              </div>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-surface-2 p-5">
                <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-500">
                  About this tool
                </h2>
                <p className="text-sm leading-relaxed text-slate-300">
                  {tool.description}
                </p>
                <p className="text-sm leading-relaxed text-slate-500">
                  {processing.description}
                </p>
              </div>
              {steps.length > 0 && (
                <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-surface-2 p-5">
                  <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-500">
                    How it works
                  </h2>
                  <ol className="flex flex-col gap-3">
                    {steps.map((step, i) => (
                      <li key={step} className="flex items-start gap-3">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-blue-500 text-xs font-semibold text-white">
                          {i + 1}
                        </span>
                        <span className="text-sm leading-relaxed text-slate-300">
                          {step}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ── Overview layout: polished, implementation-ready placeholder ── */
          <div className="grid gap-10 lg:grid-cols-[1fr_1.05fr] lg:items-start">
            <div className="flex flex-col gap-6">
              <div className="flex items-start gap-4">
                <ToolIcon
                  icon={tool.icon}
                  gradient={category?.gradient}
                  size="lg"
                />
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                      {tool.name}
                    </h1>
                    {tool.badge && <ToolBadgePill badge={tool.badge} />}
                  </div>
                  <p className="text-base text-slate-400">{tool.tagline}</p>
                </div>
              </div>

              <p className="text-pretty text-base leading-relaxed text-slate-300">
                {tool.description}
              </p>

              {formatChips}

              <p className="rounded-2xl border border-white/10 bg-surface-2 p-4 text-sm leading-relaxed text-slate-400">
                {processing.description}
              </p>

              {steps.length > 0 && (
                <div className="flex flex-col gap-4">
                  <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-500">
                    How it works
                  </h2>
                  <ol className="flex flex-col gap-3">
                    {steps.map((step, i) => (
                      <li key={step} className="flex items-start gap-3">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-blue-500 text-xs font-semibold text-white">
                          {i + 1}
                        </span>
                        <span className="text-sm leading-relaxed text-slate-300">
                          {step}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>

            <div className="lg:sticky lg:top-24">
              {tool.processing === "client" ? (
                /* Client tool without a runner yet: stage files locally. */
                <div className="gradient-border">
                  <div className="glass flex flex-col gap-5 rounded-3xl p-5 sm:p-7">
                    <div className="flex flex-col gap-1">
                      <h2 className="text-lg font-semibold text-white">
                        {tool.name}
                      </h2>
                      <p className="text-sm text-slate-400">
                        Add your files to get started —{" "}
                        {processing.short.toLowerCase()}.
                      </p>
                    </div>
                    <UploadZone
                      ctaLabel={`Run ${tool.name}`}
                      ctaHref={`/workspace?tool=${tool.slug}`}
                      hint={`Accepts ${tool.accept.join(", ")} · Max 100 MB per file`}
                    />
                  </div>
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
              ) : tool.slug === "html-to-pdf" || tool.slug === "webpage-to-pdf" ? (
                /* HTML/Webpage to PDF: Chromium-backed secure-worker conversion with real output download. */
                <ErrorBoundary boundary="html-render-worker-panel">
                  <HtmlRenderWorkerPanel tool={tool} />
                </ErrorBoundary>
              ) : tool.slug === "word-to-pdf" || tool.slug === "excel-to-pdf" || tool.slug === "powerpoint-to-pdf" ? (
                /* Office to PDF: LibreOffice-backed secure-worker conversion with real output download. */
                <ErrorBoundary boundary="office-conversion-worker-panel">
                  <OfficeConversionWorkerPanel tool={tool} />
                </ErrorBoundary>
              ) : tool.slug === "pdf-to-word" || tool.slug === "pdf-to-excel" || tool.slug === "pdf-to-powerpoint" ? (
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
              ) : (
                /* Secure-worker / hybrid / AI tool: honest future-flow preview. */
                <WorkerPreview tool={tool} />
              )}
            </div>
          </div>
        )}

        {related.length > 0 && (
          <div className="flex flex-col gap-6 border-t border-white/10 pt-10">
            <div className="flex items-end justify-between gap-4">
              <h2 className="text-xl font-semibold text-white">Related tools</h2>
              <Link
                href="/tools"
                className="group inline-flex items-center gap-1.5 text-sm font-medium text-violet-300 transition hover:text-violet-200"
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

        <p className="inline-flex items-center gap-2 text-xs text-slate-500">
          <Check className="size-3.5 text-emerald-400" aria-hidden />
          No sign-up required. Your files stay on your device until you run a
          tool.
        </p>
      </Container>
    </div>
  );
}
