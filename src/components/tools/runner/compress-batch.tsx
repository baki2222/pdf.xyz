"use client";

import { useCallback, useMemo } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Clock,
  Download,
  FileArchive,
  Info,
  Play,
  RefreshCw,
  X,
} from "lucide-react";
import { optimizeLossless } from "@/lib/pdf/analyze";
import {
  downloadBlob,
  downloadBytes,
  readFileBytes,
  zipFiles,
} from "@/lib/pdf/browser";
import { outputName } from "@/lib/pdf/files";
import type { NamedBytes } from "@/lib/pdf/types";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatBytes } from "@/lib/utils";
import type { BatchItem } from "@/lib/batch";
import { HandoffLoadedBadge } from "./handoff-notice";
import { Spinner } from "./runner-kit";
import { useBatchRunner, type BatchUnit } from "./use-batch-runner";

/** Deterministic, on-device result of losslessly repacking one PDF. */
export interface CompressResult {
  outputName: string;
  bytes: Uint8Array;
  originalBytes: number;
  optimizedBytes: number;
  savedBytes: number;
}

/**
 * Batch compress: run the **lossless** structural repack (pdf-lib) over several
 * PDFs, one at a time, entirely in the browser. This is the only deterministic,
 * no-input compression we can honestly do client-side — it never re-encodes
 * images, so we say so plainly and point image-heavy files at the secure worker.
 * Nothing is uploaded.
 */
export function CompressBatchRunner({
  files,
  onReset,
  preloaded = false,
  skipped = 0,
}: {
  files: File[];
  onReset: () => void;
  preloaded?: boolean;
  skipped?: number;
}) {
  const units = useMemo<BatchUnit[]>(
    () =>
      files.map((file, i) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${i}`,
        name: file.name,
        file,
      })),
    [files],
  );

  const process = useCallback(async (file: File): Promise<CompressResult> => {
    const bytes = await readFileBytes(file);
    const optimized = await optimizeLossless(bytes);
    return {
      outputName: outputName(file.name, "optimized"),
      bytes: optimized,
      originalBytes: bytes.byteLength,
      optimizedBytes: optimized.byteLength,
      savedBytes: Math.max(0, bytes.byteLength - optimized.byteLength),
    };
  }, []);

  const { state, progress, start, cancel, reset, running } = useBatchRunner<CompressResult>(
    units,
    process,
  );

  const settled = state.phase === "done" || state.phase === "canceled";
  const totalSaved = state.items.reduce(
    (sum, item) => sum + (item.result?.savedBytes ?? 0),
    0,
  );
  const doneItems = state.items.filter(
    (item): item is BatchItem<CompressResult> & { result: CompressResult } =>
      item.status === "done" && !!item.result,
  );

  const downloadAll = useCallback(async () => {
    const named: NamedBytes[] = doneItems.map((item) => ({
      name: item.result.outputName,
      bytes: item.result.bytes,
    }));
    if (named.length === 0) return;
    const blob = await zipFiles(named);
    downloadBlob(blob, "pdfxyz-compressed.zip");
  }, [doneItems]);

  return (
    <div className="flex flex-col gap-5">
      {preloaded && <HandoffLoadedBadge count={files.length} skipped={skipped} />}

      {/* Honest scope banner: lossless-only, on-device. */}
      <div className="flex items-start gap-2.5 rounded-2xl border border-white/10 bg-surface-2 p-4">
        <Info className="mt-0.5 size-4 shrink-0 text-violet-300" aria-hidden />
        <p className="text-sm leading-relaxed text-slate-400">
          Batch <span className="text-slate-200">lossless compression</span> repacks
          each PDF&apos;s structure in your browser — no quality loss, nothing
          uploaded. It doesn&apos;t re-encode images; image-heavy files need the
          secure worker (open a single file to see that path).
        </p>
      </div>

      {/* Accessible progress */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>
            {state.phase === "idle"
              ? `${files.length} PDF${files.length === 1 ? "" : "s"} ready`
              : `${progress.settled} of ${progress.total} done`}
            {progress.error > 0 && (
              <span className="text-amber-300"> · {progress.error} failed</span>
            )}
            {progress.canceled > 0 && (
              <span className="text-slate-500"> · {progress.canceled} canceled</span>
            )}
          </span>
          {settled && totalSaved > 0 && (
            <span className="font-medium text-emerald-300">
              −{formatBytes(totalSaved)} total
            </span>
          )}
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.pct}
          aria-valuetext={`${progress.settled} of ${progress.total} files processed`}
          aria-label="Batch compression progress"
          className="h-2 w-full overflow-hidden rounded-full bg-white/5"
        >
          <span
            className={cn(
              "block h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-500 transition-[width] duration-300",
              state.phase === "canceled" && "from-slate-500 to-slate-600",
            )}
            style={{ width: `${progress.pct}%` }}
          />
        </div>
      </div>

      {/* Per-item results */}
      <ul className="flex flex-col gap-2" aria-label="Files in this batch">
        {state.items.map((item) => (
          <BatchRow key={item.id} item={item} />
        ))}
      </ul>

      {/* Polite completion announcement for screen readers */}
      <p role="status" aria-live="polite" className="sr-only">
        {state.phase === "done" &&
          `Batch complete. ${progress.done} compressed, ${progress.error} failed.`}
        {state.phase === "canceled" && "Batch canceled."}
      </p>

      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-500">
          Files are processed one at a time, on your device.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {state.phase === "idle" && (
            <>
              <button
                type="button"
                onClick={onReset}
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                Choose different files
              </button>
              <button
                type="button"
                onClick={start}
                className={buttonVariants({ variant: "primary", size: "sm" })}
              >
                <Play className="size-4" aria-hidden />
                Compress {files.length} PDF{files.length === 1 ? "" : "s"}
              </button>
            </>
          )}

          {running && (
            <button
              type="button"
              onClick={cancel}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <X className="size-4" aria-hidden />
              Cancel
            </button>
          )}

          {settled && (
            <>
              <button
                type="button"
                onClick={reset}
                className={buttonVariants({ variant: "ghost", size: "sm" })}
              >
                <RefreshCw className="size-3.5" aria-hidden />
                Run again
              </button>
              <button
                type="button"
                onClick={onReset}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                New files
              </button>
              {doneItems.length > 0 && (
                <button
                  type="button"
                  onClick={downloadAll}
                  className={buttonVariants({ variant: "primary", size: "sm" })}
                >
                  <FileArchive className="size-4" aria-hidden />
                  Download all ({doneItems.length})
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** One row in the batch list: status glyph, name, and per-item result/error. */
function BatchRow({ item }: { item: BatchItem<CompressResult> }) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-white/10 bg-surface-2 px-3 py-2.5">
      <StatusGlyph status={item.status} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-slate-200">{item.name}</span>
        <span className="block text-xs text-slate-500">
          <BatchDetail item={item} />
        </span>
      </span>
      {item.status === "done" && item.result && (
        <button
          type="button"
          onClick={() => downloadBytes(item.result!.bytes, item.result!.outputName)}
          aria-label={`Download compressed ${item.name}`}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white"
        >
          <Download className="size-4" aria-hidden />
        </button>
      )}
    </li>
  );
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function BatchDetail({ item }: { item: BatchItem<CompressResult> }) {
  switch (item.status) {
    case "queued":
      return <>Queued</>;
    case "running":
      return <span className="text-violet-300">Compressing…</span>;
    case "canceled":
      return <>Canceled</>;
    case "error":
      return <span className="text-amber-300">{item.error ?? "Couldn’t compress"}</span>;
    case "done": {
      const r = item.result;
      if (!r) return null;
      return r.savedBytes > 0 ? (
        <span className="text-emerald-300">
          −{formatBytes(r.savedBytes)} ({pct(r.savedBytes, r.originalBytes)}%) ·{" "}
          {formatBytes(r.optimizedBytes)}
        </span>
      ) : (
        <>Already lean — no change</>
      );
    }
    default:
      return null;
  }
}

function StatusGlyph({ status }: { status: BatchItem<CompressResult>["status"] }) {
  const base = "grid size-8 shrink-0 place-items-center rounded-lg";
  switch (status) {
    case "running":
      return (
        <span className={cn(base, "bg-violet-500/15 text-violet-300")}>
          <Spinner className="size-4" />
        </span>
      );
    case "done":
      return (
        <span className={cn(base, "bg-emerald-500/15 text-emerald-300")}>
          <CheckCircle2 className="size-4" aria-hidden />
        </span>
      );
    case "error":
      return (
        <span className={cn(base, "bg-amber-500/15 text-amber-300")}>
          <AlertTriangle className="size-4" aria-hidden />
        </span>
      );
    case "canceled":
      return (
        <span className={cn(base, "bg-white/5 text-slate-500")}>
          <CircleSlash className="size-4" aria-hidden />
        </span>
      );
    default:
      return (
        <span className={cn(base, "bg-white/5 text-slate-500")}>
          <Clock className="size-4" aria-hidden />
        </span>
      );
  }
}
