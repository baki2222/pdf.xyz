"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Droplets, FileImage, ShieldCheck, TriangleAlert } from "lucide-react";
import {
  GRAYSCALE_DPI_PRESETS,
  grayscaleOutputName,
  grayscalePdf,
  grayscalePresetById,
  type GrayscaleResult,
} from "@/lib/pdf/grayscale";
import { downloadBytes } from "@/lib/pdf/browser";
import { buttonVariants } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import {
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  Spinner,
  useAsyncRun,
} from "./runner-kit";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import { PrivacyLine, SegmentedControl } from "./stamp-controls";
import type { LoadedPdf } from "./use-single-pdf";

export function GrayscaleRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · pages rasterized to grayscale locally in your browser"
      handoffSlug="grayscale-pdf"
      toolName="Grayscale PDF"
    >
      {(pdf, reset) => <GrayscaleEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

function GrayscaleEditor({ pdf, onReset }: { pdf: LoadedPdf; onReset: () => void }) {
  const { busy, error, result, run } = useAsyncRun<GrayscaleResult>();
  const [presetId, setPresetId] = useState("print");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const onRun = () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const preset = grayscalePresetById(presetId);
    setProgress({ done: 0, total: pdf.pageCount });
    void run(async () => {
      const converted = await grayscalePdf(pdf.bytes, {
        dpi: preset.dpi,
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      if (controller.signal.aborted) throw new Error("Conversion was cancelled.");
      return converted;
    });
  };

  if (result) {
    return (
      <ResultPanel
        title="Grayscale PDF ready"
        summary={`${result.pageCount} page${result.pageCount === 1 ? "" : "s"} rasterized · ${formatBytes(result.bytes.byteLength)}`}
        onReset={onReset}
      >
        <button
          type="button"
          onClick={() => downloadBytes(result.bytes, grayscaleOutputName(pdf.file.name))}
          className={buttonVariants({ variant: "primary", size: "lg" })}
        >
          <Download className="size-4" aria-hidden />
          Download grayscale PDF
        </button>
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection title="Output quality">
        <SegmentedControl
          label="Rasterization quality"
          value={presetId}
          onChange={setPresetId}
          options={GRAYSCALE_DPI_PRESETS.map((preset) => ({
            value: preset.id,
            label: `${preset.label} (${preset.dpi} DPI)`,
          }))}
        />
      </RunnerSection>

      <div className="grid gap-3 sm:grid-cols-3">
        <InfoTile
          icon={Droplets}
          title="Grayscale pages"
          body="Each page is rendered, converted to luminance grayscale, and placed back into a new PDF."
        />
        <InfoTile
          icon={ShieldCheck}
          title="Private"
          body="Rendering happens in your browser using the bundled pdf.js worker — no upload."
        />
        <InfoTile
          icon={TriangleAlert}
          title="Raster output"
          body="Text, vectors, forms, and annotations are flattened into page images; selectable text is not preserved."
        />
      </div>

      {busy && progress && <RenderProgress done={progress.done} total={progress.total} />}
      {error && <ErrorNote message={error} />}

      <PrivacyLine>
        Grayscale conversion happens on your device — your PDF never leaves the browser.
      </PrivacyLine>

      <div className="flex justify-end">
        <RunButton onClick={onRun} busy={busy} busyLabel="Converting…">
          <FileImage className="size-4" aria-hidden />
          Convert to grayscale
        </RunButton>
      </div>
    </div>
  );
}

function RenderProgress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1.5" role="status" aria-live="polite">
      <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
        <Spinner className="size-3" /> Converting pages… {done}/{total}
      </span>
      <span className="h-1 w-full overflow-hidden rounded-full bg-white/5" aria-hidden>
        <span className="block h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-500 transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

function InfoTile({ icon: Icon, title, body }: { icon: typeof ShieldCheck; title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200">
        <Icon className="size-4 text-violet-300" aria-hidden />
        {title}
      </div>
      <p className="text-xs leading-relaxed text-slate-400">{body}</p>
    </div>
  );
}
