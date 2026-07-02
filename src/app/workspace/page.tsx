import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ShieldCheck, Sparkles } from "lucide-react";
import { getPopularTools, toolCount } from "@/lib/tools";
import { getCategory } from "@/lib/tools/categories";
import { Container } from "@/components/ui/container";
import { Pill } from "@/components/ui/badge";
import { ToolIcon } from "@/components/ui/tool-icon";
import { UploadZone } from "@/components/upload/upload-zone";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: "Workspace",
  description:
    "Your private pdf.xyz workspace. Stage files, pick a tool, and chain tasks into repeatable workflows — most of it running right in your browser.",
  path: "/workspace",
  noIndex: true,
});

export default function WorkspacePage() {
  const quickTools = getPopularTools(8);

  return (
    <div className="py-14 sm:py-20">
      <Container className="flex flex-col gap-10">
        <div className="flex flex-col items-start gap-4">
          <Pill>
            <ShieldCheck className="size-3.5 text-emerald-400" aria-hidden />
            Files stay on your device
          </Pill>
          <h1 className="text-balance text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Your workspace
          </h1>
          <p className="max-w-2xl text-pretty text-base leading-relaxed text-slate-400 sm:text-lg">
            Drop in your documents, then pick a tool to run. Files stage in your
            browser — nothing is uploaded until a tool actually needs a secure
            worker.
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1.35fr_1fr] lg:items-start">
          <div className="gradient-border">
            <div className="glass rounded-3xl p-5 sm:p-7">
              <UploadZone
                ctaLabel="Continue"
                ctaHref="/tools"
                hint="PDF, images, Word, Excel, PowerPoint · Max 100 MB per file"
              />
            </div>
          </div>

          <aside className="flex flex-col gap-5 rounded-3xl border border-white/10 bg-surface-2 p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-500">
                Quick start
              </h2>
              <Link
                href="/tools"
                className="text-xs font-medium text-violet-300 transition hover:text-violet-200"
              >
                All {toolCount}
              </Link>
            </div>
            <ul className="flex flex-col gap-2">
              {quickTools.map((tool) => (
                <li key={tool.slug}>
                  <Link
                    href={`/tools/${tool.slug}`}
                    className="group flex items-center gap-3 rounded-xl border border-transparent px-2 py-2 transition hover:border-white/10 hover:bg-white/[0.04]"
                  >
                    <ToolIcon
                      icon={tool.icon}
                      gradient={getCategory(tool.category)?.gradient}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-white">
                        {tool.name}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {tool.tagline}
                      </span>
                    </span>
                    <ArrowRight
                      className="size-4 shrink-0 text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-white"
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
            </ul>

            <div className="flex items-start gap-3 rounded-2xl border border-violet-400/20 bg-violet-500/10 p-4">
              <Sparkles
                className="mt-0.5 size-4 shrink-0 text-violet-300"
                aria-hidden
              />
              <p className="text-xs leading-relaxed text-slate-300">
                Tip: chain tools into a workflow — merge, compress, then sign —
                and save it as a preset to rerun on your next batch.
              </p>
            </div>
          </aside>
        </div>
      </Container>
    </div>
  );
}
