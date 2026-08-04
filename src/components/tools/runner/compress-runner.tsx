"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  Download,
  FileText,
  Gauge,
  ImageIcon,
  Info,
  Lock,
  ServerCog,
  Sparkles,
} from "lucide-react";
import {
  analyzePdf,
  summarizeAnalysis,
  type AnalyzeResult,
  type OptimizeRecommendation,
  type PdfAnalysis,
} from "@/lib/pdf/analyze";
import { downloadBytes } from "@/lib/pdf/browser";
import { outputName, partitionPdfFiles } from "@/lib/pdf/files";
import {
  runWorkerCompression,
  type CompressWorkerResult,
} from "@/lib/workers/client";
import type { WorkerStatus } from "@/lib/workers/status";
import { cn, formatBytes } from "@/lib/utils";
import {
  ChipButton,
  Dropzone,
  ErrorNote,
  ResultCard,
  Spinner,
  errorMessage,
  useOutcomeFocus,
} from "./runner-kit";
import { CompressBatchRunner } from "./compress-batch";
import {
  HandoffLoadedBadge,
  HandoffLoading,
  HandoffProblem,
} from "./handoff-notice";
import { FileHeader } from "./single-pdf-runner";
import { useSinglePdf, type LoadedPdf } from "./use-single-pdf";
import { useToolHandoff } from "./use-tool-handoff";

interface Rejection {
  name: string;
  reason: string;
}

/**
 * Compress accepts one or more PDFs. A single file gets the full on-device
 * analyzer (image share, lossless repack, and the honest secure-worker deep
 * path). Two or more route to the in-browser batch runner (lossless per file).
 * Files can arrive via the picker or be handed off from the workspace — either
 * way they stay in the browser and are never uploaded.
 */
export function CompressRunner() {
  const handoff = useToolHandoff("compress-pdf");
  const [files, setFiles] = useState<File[]>([]);
  const [rejections, setRejections] = useState<Rejection[]>([]);

  // Seed from a workspace hand-off exactly once.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    if (handoff.status === "ready" && handoff.files.length > 0) {
      seededRef.current = true;
      queueMicrotask(() => {
        setFiles(handoff.files);
      });
    }
  }, [handoff.status, handoff.files]);

  const addFiles = useCallback((incoming: File[]) => {
    const { accepted, rejected } = partitionPdfFiles(incoming);
    setRejections(rejected.map((r) => ({ name: r.file.name, reason: r.reason })));
    if (accepted.length > 0) setFiles((prev) => [...prev, ...accepted]);
  }, []);

  const reset = useCallback(() => {
    setFiles([]);
    setRejections([]);
  }, []);

  const preloaded = handoff.status === "ready";

  if (files.length >= 2) {
    return (
      <CompressBatchRunner
        files={files}
        onReset={reset}
        preloaded={preloaded}
        skipped={handoff.skipped}
      />
    );
  }

  if (files.length === 1) {
    return (
      <CompressSingle
        file={files[0]!}
        onReset={reset}
        preloaded={preloaded}
        skipped={handoff.skipped}
      />
    );
  }

  if (handoff.status === "loading") return <HandoffLoading />;

  return (
    <div className="flex flex-col gap-4">
      <HandoffProblem handoff={handoff} toolName="Compress PDF" />
      <Dropzone
        onFiles={addFiles}
        accept="application/pdf"
        multiple
        hint="One or more PDFs · analyzed privately in your browser"
      />
      <RejectionsNote rejections={rejections} onDismiss={() => setRejections([])} />
    </div>
  );
}

/** Load one File into the on-device analyzer. */
function CompressSingle({
  file,
  onReset,
  preloaded,
  skipped,
}: {
  file: File;
  onReset: () => void;
  preloaded: boolean;
  skipped: number;
}) {
  const { pdf, loading, error, open } = useSinglePdf();

  useEffect(() => {
    void open(file);
  }, [file, open]);

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <ErrorNote message={error} />
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

  if (!pdf || loading) {
    return preloaded ? (
      <HandoffLoading />
    ) : (
      <div className="flex items-center justify-center gap-2 rounded-3xl border border-white/10 bg-white/[0.02] px-6 py-12 text-sm text-slate-400">
        <Spinner />
        Reading your PDF…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {preloaded && <HandoffLoadedBadge count={1} skipped={skipped} />}
      <CompressEditor
        key={`${pdf.file.name}:${pdf.file.size}`}
        pdf={pdf}
        onReset={onReset}
      />
    </div>
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

  /**
   * The analysis headline is this tool's first outcome — it replaces a spinner
   * that ran for as long as the PDF took to inspect, so it is a completion in
   * every sense that matters to someone who cannot see it appear.
   *
   * Declared here, above the early returns, because hooks cannot follow one.
   * `useOutcomeFocus` only takes focus when focus was orphaned, and after a file
   * picker it is still on the input — so in practice this announces rather than
   * yanking the user out of the upload control, which is what we want.
   */
  const analysisHeadline = result
    ? HEADLINES[summarizeAnalysis(result.analysis).recommendation].title
    : "";
  const analysisOutcome = useOutcomeFocus(
    Boolean(result),
    `Analysis complete. ${analysisHeadline}.`,
  );

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

      <div
        {...analysisOutcome}
        role="group"
        aria-label={`Analysis complete. ${headline.title}.`}
        className={cn(
          "flex items-start gap-3 rounded-3xl border p-5 outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50",
          headline.tone,
        )}
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/5">
          <HeadlineIcon className="size-5" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold text-white">{headline.title}</h3>
          <p className="text-sm text-slate-300/90">
            {summary.recommendation === "lossless-helps" &&
              `Repacking this PDF losslessly saved ${formatBytes(summary.savedBytes)} (${pct(summary.savedRatio)}%) — no quality lost.`}
            {summary.recommendation === "needs-worker" &&
              `About ${pct(summary.imageShare)}% of this file is images. Real size wins come from downsampling them, which runs on the secure worker below.`}
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

      <WorkerDeepPanel pdf={pdf} analysis={analysis} />

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

/** Quality presets for deep compression, mapped to a target image DPI. */
const DEEP_QUALITY = [
  { dpi: 96, label: "Smaller" },
  { dpi: 150, label: "Balanced" },
  { dpi: 300, label: "High quality" },
] as const;

/**
 * True when the UI may offer the secure-worker deep compression flow.
 *
 * Local-dev reports native compression directly in `compress.deep`. Production and
 * staging are different: the web process never runs the processor, so its
 * `/api/worker/status` compression facet remains web-vantage/disabled even when a
 * separate worker daemon is observed and drainable. In that case the job API is
 * still the honest source of truth: it will run on the worker or return a typed
 * failure. Gate on configured storage+queue+drainability so staging can actually
 * use the secure worker instead of trapping users on browser-only lossless repack.
 */
export function canRunDeepCompression(status: WorkerStatus | null | undefined): boolean {
  if (!status) return false;
  if (status.localDevOnly) return status.compress.deep;
  return Boolean(
    status.providers.storage.ready &&
      status.providers.queue.ready &&
      status.daemon.drainable,
  );
}

/**
 * The secure-worker "deep compression" path. It stays honest about the boundary:
 * this analysis runs on-device, but real image downsampling requires a native
 * engine on a worker. The panel asks `/api/worker/status` and only offers the
 * upload-backed run when a worker is genuinely available — otherwise it explains
 * exactly why (not configured, no pipeline, or no native engine installed).
 */
function WorkerDeepPanel({
  pdf,
  analysis,
}: {
  pdf: LoadedPdf;
  analysis: PdfAnalysis;
}) {
  const [status, setStatus] = useState<WorkerStatus | null | undefined>(
    undefined,
  );
  const [dpi, setDpi] = useState<number>(150);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<CompressWorkerResult | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/worker/status", { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? (r.json() as Promise<WorkerStatus>) : null))
      .then((s) => {
        if (active) setStatus(s);
      })
      .catch(() => {
        if (active) setStatus(null);
      });
    return () => {
      active = false;
    };
  }, []);

  const canRunDeep = canRunDeepCompression(status);

  async function run() {
    setBusy(true);
    setOutcome(null);
    const res = await runWorkerCompression({
      filename: pdf.file.name,
      bytes: pdf.bytes,
      profile: "deep",
      targetDpi: dpi,
    });
    setOutcome(res);
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-surface-2 p-4">
      <div className="flex items-start gap-2.5">
        <ServerCog className="mt-0.5 size-4 shrink-0 text-blue-300" aria-hidden />
        <div className="flex flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-slate-200">
              Deep image compression (secure worker)
            </span>
            <WorkerBadge status={status} canRunDeep={canRunDeep} />
          </div>
          <p className="text-sm leading-relaxed text-slate-400">
            Aggressive image downsampling and re-encoding can&apos;t be done
            reliably in the browser, so it runs on an encrypted, auto-deleting
            worker. The analysis above stays 100% on your device.
          </p>
        </div>
      </div>

      {status === undefined ? (
        <p className="inline-flex items-center gap-2 pl-6 text-xs text-slate-500">
          <Spinner className="size-3" />
          Checking whether a secure worker is available…
        </p>
      ) : canRunDeep ? (
        <DeepRunControls
          localDevOnly={status?.localDevOnly ?? false}
          dpi={dpi}
          onDpi={setDpi}
          busy={busy}
          outcome={outcome}
          onRun={run}
          filename={pdf.file.name}
          originalBytes={analysis.originalBytes}
        />
      ) : (
        <p className="pl-6 text-xs leading-relaxed text-slate-500">
          {status?.detail ??
            "The secure worker isn't enabled in this environment, so deep compression isn't available here."}
        </p>
      )}
    </div>
  );
}

/** Small status pill: honest about disabled / local-dev / not-enabled. */
function WorkerBadge({
  status,
  canRunDeep,
}: {
  status: WorkerStatus | null | undefined;
  canRunDeep: boolean;
}) {
  if (status === undefined) return null;
  if (status?.mode === "local-dev") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-200">
        <span className="size-1.5 rounded-full bg-amber-400" aria-hidden />
        Local-dev worker
      </span>
    );
  }
  if (canRunDeep) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-200">
        <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden />
        Secure worker
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] font-medium text-slate-400">
      <span className="size-1.5 rounded-full bg-slate-500" aria-hidden />
      Not enabled
    </span>
  );
}

function DeepRunControls({
  localDevOnly,
  dpi,
  onDpi,
  busy,
  outcome,
  onRun,
  filename,
  originalBytes,
}: {
  localDevOnly: boolean;
  dpi: number;
  onDpi: (dpi: number) => void;
  busy: boolean;
  outcome: CompressWorkerResult | null;
  onRun: () => void;
  filename: string;
  originalBytes: number;
}) {
  const savedBytes =
    outcome?.ok === true
      ? Math.max(0, originalBytes - outcome.output.byteLength)
      : 0;
  /**
   * The "nothing to gain" outcome is a COMPLETED run that produces no emerald
   * card and no download — so neither structural guard can see it, and it was
   * the one completion surface in the codebase that three independent design
   * passes all missed. It is announced here by hand.
   *
   * Unlike `ResultPanel`, this panel stays mounted across runs, which is why the
   * hook is keyed on a condition rather than on mount.
   */
  const noGain = useOutcomeFocus<HTMLParagraphElement>(
    outcome?.ok === true && savedBytes === 0,
    "Compression finished. The worker could not shrink this file further without losing quality — the original is already efficient.",
  );

  return (
    <div className="flex flex-col gap-3 pl-6">
      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-amber-200/90">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {localDevOnly
          ? "This runs on your local-dev worker — the file is sent to the in-process worker on this machine, not to any third party."
          : "Running this uploads your file to the secure worker."}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Quality
        </span>
        {DEEP_QUALITY.map((q) => (
          <ChipButton
            key={q.dpi}
            onClick={() => onDpi(q.dpi)}
            active={dpi === q.dpi}
            disabled={busy}
            title={`${q.dpi} DPI`}
          >
            {q.label}
          </ChipButton>
        ))}
      </div>

      <button
        type="button"
        onClick={onRun}
        disabled={busy}
        aria-busy={busy}
        className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-blue-400/40 bg-blue-500/15 px-6 py-2.5 text-sm font-semibold text-blue-100 transition hover:bg-blue-500/25 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:self-start"
      >
        {busy ? (
          <>
            <Spinner />
            Compressing on the worker…
          </>
        ) : (
          <>
            <ServerCog className="size-4" aria-hidden />
            Compress images on the worker
          </>
        )}
      </button>

      {outcome?.ok === false && <ErrorNote message={outcome.message} />}

      {outcome?.ok === true &&
        (savedBytes > 0 ? (
          <ResultCard
            announce={`Compression finished. The worker shrank this file by ${formatBytes(savedBytes)} — ${formatBytes(outcome.output.byteLength)} final.`}
          >
            <p className="text-sm text-emerald-200">
              The worker shrank this file by {formatBytes(savedBytes)} (
              {pct(savedBytes / Math.max(1, originalBytes))}%) —{" "}
              {formatBytes(outcome.output.byteLength)} final.
            </p>
            <button
              type="button"
              onClick={() =>
                downloadBytes(
                  outcome.output,
                  // Prefer the worker's safe artifact filename; fall back to a
                  // locally-derived name only if the server didn't provide one.
                  outcome.artifact.filename ||
                    outputName(filename, "compressed"),
                )
              }
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-violet-500 via-indigo-500 to-blue-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition hover:brightness-110 sm:w-auto sm:self-start"
            >
              <Download className="size-4" aria-hidden />
              Download compressed PDF
            </button>
          </ResultCard>
        ) : (
          <p
            {...noGain}
            role="group"
            aria-label="Compression finished with no size reduction"
            className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-sm text-slate-400 outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
          >
            The worker couldn&apos;t shrink this file further without losing
            quality — the original is already efficient.
          </p>
        ))}
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

/** Per-file rejection list for the compress intake (non-PDF / too large). */
function RejectionsNote({
  rejections,
  onDismiss,
}: {
  rejections: Rejection[];
  onDismiss: () => void;
}) {
  if (rejections.length === 0) return null;
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex items-center gap-2 font-medium">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {rejections.length} file{rejections.length === 1 ? "" : "s"} couldn&apos;t
          be added
        </span>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-md px-2 py-0.5 text-xs text-amber-200/80 transition hover:bg-amber-500/15 hover:text-amber-100"
        >
          Dismiss
        </button>
      </div>
      <ul className="flex flex-col gap-1 pl-6 text-xs text-amber-200/90">
        {rejections.map((r, i) => (
          <li key={`${r.name}-${i}`} className="list-disc">
            <span className="font-medium text-amber-100">{r.name}</span> — {r.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
