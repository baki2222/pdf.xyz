"use client";

import { useEffect, useState } from "react";
import {
  Boxes,
  Download,
  FileText,
  Gauge,
  ImageIcon,
  Info,
  ServerCog,
  Sparkles,
} from "lucide-react";
import {
  analyzePdf,
  summarizeAnalysis,
  type AnalyzeResult,
  type OptimizeRecommendation,
} from "@/lib/pdf/analyze";
import { downloadBytes } from "@/lib/pdf/browser";
import { outputName } from "@/lib/pdf/files";
import { cn, formatBytes } from "@/lib/utils";
import { ErrorNote, Spinner, errorMessage } from "./runner-kit";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import type { LoadedPdf } from "./use-single-pdf";

export function CompressRunner() {
  return (
    <SinglePdfRunner hint="One PDF · analyzed privately in your browser">
      {(pdf, reset) => <CompressEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

const HEADLINES: Record<
  OptimizeRecommendation,
  { title: string; tone: string; icon: typeof Sparkles }
> = {
  "lossless-helps": {
    title: "Lossless cleanup shrank this file",
    tone: "border-emerald-400/25 bg-emerald-500/[0.07] text-emerald-300",
    icon: Sparkles,
  },
  "needs-worker": {
    title: "This PDF is image-heavy",
    tone: "border-blue-400/25 bg-blue-500/[0.07] text-blue-300",
    icon: ImageIcon,
  },
  "already-lean": {
    title: "This PDF is already lean",
    tone: "border-white/15 bg-white/[0.03] text-slate-300",
    icon: Gauge,
  },
};

function pct(ratio: number): number {
  return Math.round(ratio * 100);
}

function CompressEditor({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  const [state, setState] = useState<{
    result: AnalyzeResult | null;
    error: string | null;
    busy: boolean;
  }>({ result: null, error: null, busy: true });

  useEffect(() => {
    let active = true;
    void analyzePdf(pdf.bytes)
      .then((r) => {
        if (active) {
          setState({ result: r, error: null, busy: false });
        }
      })
      .catch((err) => {
        if (active) {
          setState({ result: null, error: errorMessage(err), busy: false });
        }
      });
    return () => {
      active = false;
    };
  }, [pdf.bytes]);

  const { result, error, busy } = state;

  if (busy) {
    return (
      <div className="flex flex-col gap-5">
        <FileHeader pdf={pdf} />
        <div className="flex items-center justify-center gap-2 rounded-3xl border border-white/10 bg-white/[0.02] px-6 py-12 text-sm text-slate-400">
          <Spinner />
          Analyzing your PDF…
        </div>
      </div>
    );
  }

  if (error || !result) {
    return (
      <div className="flex flex-col gap-5">
        <FileHeader pdf={pdf} />
        {error && <ErrorNote message={error} />}
        <button
          type="button"
          onClick={onReset}
          className="self-start text-xs font-medium text-slate-400 transition hover:text-white"
        >
          Try another file
        </button>
      </div>
    );
  }

  const { analysis } = result;
  const summary = summarizeAnalysis(analysis);
  const headline = HEADLINES[summary.recommendation];
  const HeadlineIcon = headline.icon;
  const canDownload = summary.savedBytes > 0;

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <div className={cn("flex items-start gap-3 rounded-3xl border p-5", headline.tone)}>
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/5">
          <HeadlineIcon className="size-5" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold text-white">{headline.title}</h3>
          <p className="text-sm text-slate-300/90">
            {summary.recommendation === "lossless-helps" &&
              `Repacking this PDF losslessly saved ${formatBytes(summary.savedBytes)} (${pct(summary.savedRatio)}%) — no quality lost.`}
            {summary.recommendation === "needs-worker" &&
              `About ${pct(summary.imageShare)}% of this file is images. Real size wins come from downsampling them, which runs on our secure worker.`}
            {summary.recommendation === "already-lean" &&
              "There's little structural overhead to remove, and images aren't the bulk of the file. Deeper compression would trade away quality."}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile icon={FileText} label="Current size" value={formatBytes(analysis.originalBytes)} />
        <StatTile icon={Boxes} label="Pages" value={String(analysis.pageCount)} />
        <StatTile
          icon={ImageIcon}
          label="Images"
          value={String(analysis.imageCount)}
          hint={analysis.imageCount > 0 ? `${pct(summary.imageShare)}% of file` : "none found"}
        />
        <StatTile
          icon={Gauge}
          label="Lossless result"
          value={
            summary.savedBytes > 0
              ? `−${formatBytes(summary.savedBytes)}`
              : "No change"
          }
          hint={summary.savedBytes > 0 ? `${pct(summary.savedRatio)}% smaller` : undefined}
        />
      </div>

      {canDownload && (
        <button
          type="button"
          onClick={() =>
            downloadBytes(result.optimized, outputName(pdf.file.name, "optimized"))
          }
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-violet-500 via-indigo-500 to-blue-500 px-7 py-3 text-base font-semibold text-white shadow-lg shadow-violet-500/25 transition hover:brightness-110 sm:w-auto sm:self-start"
        >
          <Download className="size-4" aria-hidden />
          Download optimized PDF ({formatBytes(analysis.optimizedBytes)})
        </button>
      )}

      <div className="flex items-start gap-2.5 rounded-2xl border border-white/10 bg-surface-2 p-4 text-sm leading-relaxed text-slate-400">
        <ServerCog className="mt-0.5 size-4 shrink-0 text-blue-300" aria-hidden />
        <p>
          <span className="font-medium text-slate-300">Deep compression is on the roadmap.</span>{" "}
          Aggressive image downsampling and re-encoding can&apos;t be done reliably in
          the browser, so it will run on an encrypted, auto-deleting worker. This
          analysis stays 100% on your device — nothing is uploaded.
        </p>
      </div>

      <button
        type="button"
        onClick={onReset}
        className="inline-flex items-center gap-1.5 self-start text-xs font-medium text-slate-400 transition hover:text-white"
      >
        Analyze another file
      </button>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Info;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-white/10 bg-white/[0.02] p-3.5">
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </span>
      <span className="text-lg font-semibold tabular-nums text-white">{value}</span>
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </div>
  );
}
