"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Boxes,
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
} from "@/lib/pdf/analyze";
import { downloadBytes } from "@/lib/pdf/browser";
import { LOCKED_PDF_COPY } from "@/lib/pdf/encryption";
import { outputName, partitionPdfFiles } from "@/lib/pdf/files";
import {
  runWorkerCompression,
  type CompressWorkerResult,
} from "@/lib/workers/client";
import type { WorkerStatus } from "@/lib/workers/status";
import { cn, formatBytes } from "@/lib/utils";
import {
  ChipButton,
  DownloadCta,
  Dropzone,
  ErrorNote,
  ResultCard,
  Spinner,
  WorkerRunButton,
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
import { useSinglePdf, type LoadedPdf, type LockedPdf } from "./use-single-pdf";
import { useToolHandoff } from "./use-tool-handoff";

/** Where a PDF that needs a password gets unlocked; pinned to the catalog by the runner test. */
export const UNLOCK_TOOL_HREF = "/tools/unlock-pdf";

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
    setRejections(
      rejected.map((r) => ({ name: r.file.name, reason: r.reason })),
    );
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
      <RejectionsNote
        rejections={rejections}
        onDismiss={() => setRejections([])}
      />
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
  // Opted in: Compress has a path that does not need pdf-lib to rewrite the
  // file (the secure worker), so an encrypted file is classified rather than
  // refused wholesale.
  const { pdf, locked, loading, error, open } = useSinglePdf({
    classifyLocked: true,
  });

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
          className="text-muted hover:text-fg self-start text-xs font-medium transition"
        >
          Try another file
        </button>
      </div>
    );
  }

  if (locked && !loading) {
    return (
      <div className="flex flex-col gap-4">
        {preloaded && <HandoffLoadedBadge count={1} skipped={skipped} />}
        <CompressLocked locked={locked} onReset={onReset} />
      </div>
    );
  }

  if (!pdf || loading) {
    return preloaded ? (
      <HandoffLoading />
    ) : (
      <div className="border-line bg-wash text-muted flex items-center justify-center gap-2 rounded-[4px] border px-6 py-12 text-sm">
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

/**
 * An encrypted PDF the in-browser engine cannot rewrite, told apart by what a
 * reader can open.
 *
 * Until 2026-09-27 every one of these read "This PDF is password-protected"
 * and dead-ended, including the owner-password-only files that open in every
 * viewer with no prompt. Those are RESTRICTED: the lossless repack still cannot
 * rewrite them (pdf-lib does not decrypt), but the secure worker opens them the
 * way a viewer does, so that path stays mounted. Only a file that really needs
 * a password to open is sent to Unlock — Unlock asks for that password, which
 * is exactly why it is no help to a file that has none.
 */
function CompressLocked({
  locked,
  onReset,
}: {
  locked: LockedPdf;
  onReset: () => void;
}) {
  const { access, file } = locked;
  const tryAnother = (
    <button
      type="button"
      onClick={onReset}
      className="text-muted hover:text-fg self-start text-xs font-medium transition"
    >
      Try another file
    </button>
  );

  if (access.kind !== "restricted") {
    return (
      <div className="flex flex-col gap-4">
        <ErrorNote message={LOCKED_PDF_COPY[access.kind]} />
        {access.kind === "password-required" && (
          <Link
            href={UNLOCK_TOOL_HREF}
            className="text-accent self-start text-sm font-medium underline underline-offset-2"
          >
            Unlock PDF with its password
          </Link>
        )}
        {tryAnother}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={{ file, pageCount: access.pageCount }} />
      <div
        role="status"
        aria-label="This PDF has permission restrictions"
        className="border-info/40 bg-info/10 flex items-start gap-3 rounded-[4px] border p-5"
      >
        <span className="bg-wash text-info grid size-10 shrink-0 place-items-center rounded-[4px]">
          <Lock className="size-5" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h3 className="text-fg text-base font-semibold">
            This PDF has permission restrictions
          </h3>
          <p className="text-muted/90 text-sm">
            {LOCKED_PDF_COPY.restricted} You can still send it to the secure
            worker below, which opens files the way a PDF viewer does. Its
            compressed copy is a new file, and the owner&apos;s restrictions may
            not carry over to it.
          </p>
        </div>
      </div>
      <WorkerDeepPanel
        file={file}
        bytes={locked.bytes}
        originalBytes={file.size}
        signatureCount={null}
        signaturesConfirmed
      />
      {tryAnother}
    </div>
  );
}

const HEADLINES: Record<
  OptimizeRecommendation,
  { title: string; tone: string; icon: typeof Sparkles }
> = {
  "lossless-helps": {
    title: "Lossless cleanup shrank this file",
    tone: "border-ok/40 bg-ok/10 text-ok",
    icon: Sparkles,
  },
  "needs-worker": {
    title: "This PDF is image-heavy",
    tone: "border-info/40 bg-info/10 text-info",
    icon: ImageIcon,
  },
  "already-lean": {
    title: "This PDF is already lean",
    tone: "border-line-strong bg-wash text-muted",
    icon: Gauge,
  },
};

function pct(ratio: number): number {
  return Math.round(ratio * 100);
}

/**
 * The headline, qualified for a signed file. "Lossless" is true of every page
 * a reader sees and false of the file a signature validator reads, so a signed
 * file's repack is called what it is: visually lossless.
 */
function headlineTitle(
  recommendation: OptimizeRecommendation,
  signatureCount: number,
): string {
  if (signatureCount > 0 && recommendation === "lossless-helps") {
    return "Visually lossless cleanup shrank this file";
  }
  return HEADLINES[recommendation].title;
}

function signatureNoun(count: number): string {
  return count === 1 ? "digital signature" : "digital signatures";
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
  // Keyed by file (see CompressSingle), so a new file always starts unconfirmed.
  const [signaturesConfirmed, setSignaturesConfirmed] = useState(false);

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
    ? headlineTitle(
        summarizeAnalysis(result.analysis).recommendation,
        result.analysis.signatureCount,
      )
    : "";
  const analysisOutcome = useOutcomeFocus(
    Boolean(result),
    `Analysis complete. ${analysisHeadline}.`,
  );

  if (busy) {
    return (
      <div className="flex flex-col gap-5">
        <FileHeader pdf={pdf} />
        <div className="border-line bg-wash text-muted flex items-center justify-center gap-2 rounded-[4px] border px-6 py-12 text-sm">
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
          className="text-muted hover:text-fg self-start text-xs font-medium transition"
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
  const title = headlineTitle(summary.recommendation, analysis.signatureCount);
  const signed = analysis.signatureCount > 0;
  const canDownload = summary.savedBytes > 0;

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <div
        {...analysisOutcome}
        role="group"
        aria-label={`Analysis complete. ${title}.`}
        className={cn(
          "focus-visible:ring-ok/50 flex items-start gap-3 rounded-[4px] border p-5 outline-none focus-visible:ring-2",
          headline.tone,
        )}
      >
        <span className="bg-wash grid size-10 shrink-0 place-items-center rounded-[4px]">
          <HeadlineIcon className="size-5" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h3 className="text-fg text-base font-semibold">{title}</h3>
          <p className="text-muted/90 text-sm">
            {summary.recommendation === "lossless-helps" &&
              (signed
                ? `Repacking this PDF saved ${formatBytes(summary.savedBytes)} (${pct(summary.savedRatio)}%) without changing how any page looks.`
                : `Repacking this PDF losslessly saved ${formatBytes(summary.savedBytes)} (${pct(summary.savedRatio)}%) — no quality lost.`)}
            {summary.recommendation === "needs-worker" &&
              `About ${pct(summary.imageShare)}% of this file is images. Real size wins come from downsampling them, which runs on the secure worker below.`}
            {summary.recommendation === "already-lean" &&
              "There's little structural overhead to remove, and images aren't the bulk of the file. Deeper compression would trade away quality."}
          </p>
        </div>
      </div>

      {signed && (
        <SignatureWarning
          count={analysis.signatureCount}
          confirmed={signaturesConfirmed}
          onConfirm={setSignaturesConfirmed}
        />
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          icon={FileText}
          label="Current size"
          value={formatBytes(analysis.originalBytes)}
        />
        <StatTile
          icon={Boxes}
          label="Pages"
          value={String(analysis.pageCount)}
        />
        <StatTile
          icon={ImageIcon}
          label="Images"
          value={String(analysis.imageCount)}
          hint={
            analysis.imageCount > 0
              ? `${pct(summary.imageShare)}% of file`
              : "none found"
          }
        />
        <StatTile
          icon={Gauge}
          label={signed ? "Visually lossless" : "Lossless result"}
          value={
            summary.savedBytes > 0
              ? `−${formatBytes(summary.savedBytes)}`
              : "No change"
          }
          hint={
            summary.savedBytes > 0
              ? `${pct(summary.savedRatio)}% smaller`
              : undefined
          }
        />
      </div>

      {canDownload && (!signed || signaturesConfirmed) && (
        <DownloadCta
          size="lg"
          onClick={() =>
            downloadBytes(
              result.optimized,
              outputName(pdf.file.name, "optimized"),
            )
          }
        >
          Download optimized PDF ({formatBytes(analysis.optimizedBytes)})
        </DownloadCta>
      )}

      <WorkerDeepPanel
        file={pdf.file}
        bytes={pdf.bytes}
        originalBytes={analysis.originalBytes}
        signatureCount={analysis.signatureCount}
        signaturesConfirmed={!signed || signaturesConfirmed}
      />

      <button
        type="button"
        onClick={onReset}
        className="text-muted hover:text-fg inline-flex items-center gap-1.5 self-start text-xs font-medium transition"
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
export function canRunDeepCompression(
  status: WorkerStatus | null | undefined,
): boolean {
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
  file,
  bytes,
  originalBytes,
  signatureCount,
  signaturesConfirmed,
}: {
  file: File;
  bytes: Uint8Array;
  originalBytes: number;
  /**
   * Signatures the worker's rewrite will invalidate; `null` when they could not
   * be counted (an encrypted file, which pdf-lib cannot read). The worker
   * re-serialises the file too, so the same warning applies to its output.
   */
  signatureCount: number | null;
  /** False while a known-signed file's warning is unconfirmed: the run waits. */
  signaturesConfirmed: boolean;
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
    try {
      const res = await runWorkerCompression({
        filename: file.name,
        bytes,
        profile: "deep",
        targetDpi: dpi,
      });
      setOutcome(res);
    } catch {
      // A rejected fetch — offline, DNS failure, a reset connection, CORS. There
      // is no response to read, so there is nothing honest to say beyond this.
      setOutcome({
        ok: false,
        message:
          "Lost the connection before the job finished. Check your network and try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-panel border-line flex flex-col gap-3 rounded-[4px] border p-4">
      <div className="flex items-start gap-2.5">
        <ServerCog className="text-info mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="flex flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-fg text-sm font-medium">
              Deep image compression (secure worker)
            </span>
            <WorkerBadge status={status} canRunDeep={canRunDeep} />
          </div>
          <p className="text-muted text-sm leading-relaxed">
            Aggressive image downsampling and re-encoding can&apos;t be done
            reliably in the browser, so it runs on an encrypted, auto-deleting
            worker. The analysis above stays 100% on your device.
          </p>
          {signatureCount === null && (
            <p className="text-warn text-xs leading-relaxed">
              We can&apos;t check an encrypted file for digital signatures in
              your browser. If this one is signed, the compressed copy&apos;s
              signatures will show as invalid.
            </p>
          )}
        </div>
      </div>

      {status === undefined ? (
        <p className="text-muted inline-flex items-center gap-2 pl-6 text-xs">
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
          filename={file.name}
          originalBytes={originalBytes}
          blockedBySignatures={!signaturesConfirmed}
        />
      ) : (
        <p className="text-muted pl-6 text-xs leading-relaxed">
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
      <span className="border-warn/40 bg-warn/10 text-warn inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium">
        <span className="bg-warn size-1.5 rounded-full" aria-hidden />
        Local-dev worker
      </span>
    );
  }
  if (canRunDeep) {
    return (
      <span className="border-ok/40 bg-ok/10 text-ok inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium">
        <span className="bg-ok size-1.5 rounded-full" aria-hidden />
        Secure worker
      </span>
    );
  }
  return (
    <span className="border-line bg-wash text-muted inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium">
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
  blockedBySignatures,
}: {
  localDevOnly: boolean;
  dpi: number;
  onDpi: (dpi: number) => void;
  busy: boolean;
  outcome: CompressWorkerResult | null;
  onRun: () => void;
  filename: string;
  originalBytes: number;
  blockedBySignatures: boolean;
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
      <p className="text-warn flex items-start gap-1.5 text-xs leading-relaxed">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {localDevOnly
          ? "This runs on your local-dev worker — the file is sent to the in-process worker on this machine, not to any third party."
          : "Running this uploads your file to the secure worker."}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted text-[11px] font-medium tracking-wide uppercase">
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

      <WorkerRunButton
        onClick={onRun}
        busy={busy}
        disabled={blockedBySignatures}
        busyLabel="Compressing on the worker…"
        icon={ServerCog}
      >
        Compress images on the worker
      </WorkerRunButton>
      {blockedBySignatures && (
        <p className="text-muted text-xs">
          Confirm the digital-signature warning above to run this.
        </p>
      )}

      {outcome?.ok === false && <ErrorNote message={outcome.message} />}

      {outcome?.ok === true &&
        (savedBytes > 0 ? (
          <ResultCard
            announce={`Compression finished. The worker shrank this file by ${formatBytes(savedBytes)} — ${formatBytes(outcome.output.byteLength)} final.`}
          >
            <p className="text-ok text-sm">
              The worker shrank this file by {formatBytes(savedBytes)} (
              {pct(savedBytes / Math.max(1, originalBytes))}%) —{" "}
              {formatBytes(outcome.output.byteLength)} final.
            </p>
            {/* The percentage above is computed from two byte counts. It is a
                COMPRESSION figure only when the worker proved the output still
                holds the input's pages; when the input could not be counted it
                is a size difference between two files whose relationship was
                never established, and saying so is cheaper than being wrong. */}
            {outcome.job?.results?.compression?.pageCheck === "unverified" && (
              <p
                role="status"
                className="border-warn/40 bg-warn/10 text-warn flex items-start gap-2 rounded-[4px] border px-4 py-3 text-sm"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  <strong className="font-semibold">
                    This file could not be checked page-for-page.
                  </strong>{" "}
                  The size went down; we could not confirm the result still has
                  every page the original did. Open it before deleting your
                  copy.
                </span>
              </p>
            )}
            <DownloadCta
              onClick={() =>
                downloadBytes(
                  outcome.output,
                  // Prefer the worker's safe artifact filename; fall back to a
                  // locally-derived name only if the server didn't provide one.
                  outcome.artifact.filename ||
                    outputName(filename, "compressed"),
                )
              }
            >
              Download compressed PDF
            </DownloadCta>
          </ResultCard>
        ) : (
          <p
            {...noGain}
            role="group"
            aria-label="Compression finished with no size reduction"
            className="border-line bg-wash text-muted focus-visible:ring-ok/50 rounded-[4px] border p-4 text-sm outline-none focus-visible:ring-2"
          >
            The worker couldn&apos;t shrink this file further without losing
            quality — the original is already efficient.
          </p>
        ))}
    </div>
  );
}

/**
 * The warning a signed file gets before either output is one click away.
 *
 * A signature covers exact byte ranges of the file, so ANY rewrite — the
 * lossless repack here, or Ghostscript on the worker — makes every signature
 * report "the document has been altered", however identical the pages look.
 * The confirmation is the gate: the download and the worker run both wait on
 * it (see CompressEditor).
 */
function SignatureWarning({
  count,
  confirmed,
  onConfirm,
}: {
  count: number;
  confirmed: boolean;
  onConfirm: (confirmed: boolean) => void;
}) {
  const id = useId();
  const noun = signatureNoun(count);
  return (
    <div
      role="group"
      aria-label={`This PDF has ${count} ${noun}`}
      className="border-warn/40 bg-warn/10 text-warn flex flex-col gap-3 rounded-[4px] border px-4 py-3 text-sm"
    >
      <p className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          <strong className="font-semibold">
            This PDF has {count} {noun}.
          </strong>{" "}
          A signature covers the file&apos;s exact bytes, so any change to the
          file — this repack included, and the secure worker&apos;s compression
          too — makes {count === 1 ? "it" : "them"} show as invalid, even though
          every page looks the same. Keep your original if the {noun} matter.
        </span>
      </p>
      <label htmlFor={id} className="text-fg flex items-start gap-2 pl-6">
        <input
          id={id}
          type="checkbox"
          checked={confirmed}
          onChange={(e) => onConfirm(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          Compress anyway — I understand the {noun} will show as invalid
        </span>
      </label>
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
    <div className="border-line bg-wash flex flex-col gap-1 rounded-[4px] border p-3.5">
      <span className="text-muted inline-flex items-center gap-1.5 text-[11px] font-medium tracking-wide uppercase">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </span>
      <span className="text-fg text-lg font-semibold tabular-nums">
        {value}
      </span>
      {hint && <span className="text-muted text-xs">{hint}</span>}
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
      className="border-warn/40 bg-warn/10 text-warn flex flex-col gap-2 rounded-[4px] border px-4 py-3 text-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex items-center gap-2 font-medium">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {rejections.length} file{rejections.length === 1 ? "" : "s"}{" "}
          couldn&apos;t be added
        </span>
        <button
          type="button"
          onClick={onDismiss}
          className="text-warn hover:bg-warn/10 hover:text-warn shrink-0 rounded-md px-2 py-0.5 text-xs transition"
        >
          Dismiss
        </button>
      </div>
      <ul className="text-warn flex flex-col gap-1 pl-6 text-xs">
        {rejections.map((r, i) => (
          <li key={`${r.name}-${i}`} className="list-disc">
            <span className="text-warn font-medium">{r.name}</span> — {r.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
