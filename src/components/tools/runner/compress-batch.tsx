"use client";

import { useCallback, useId, useMemo, useState } from "react";
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
import { optimizeLossless, type LosslessResult } from "@/lib/pdf/analyze";
import { classifyPdfAccess, LOCKED_PDF_COPY } from "@/lib/pdf/encryption";
import { PdfEngineError } from "@/lib/pdf/engine";
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
  /** Digital signatures in the input; the repacked bytes invalidate every one. */
  signatureCount: number;
}

/**
 * The repack, with an encrypted file's refusal told apart by what a reader can
 * open — the same classification, and the same words, as the single-file path.
 */
async function repackOrExplain(bytes: Uint8Array): Promise<LosslessResult> {
  try {
    return await optimizeLossless(bytes);
  } catch (err) {
    if (err instanceof PdfEngineError && err.kind === "encrypted") {
      const access = await classifyPdfAccess(bytes);
      if (access.kind === "restricted") {
        throw new PdfEngineError(
          `${LOCKED_PDF_COPY.restricted} Compress it on its own to use the secure worker.`,
          "encrypted",
        );
      }
      if (access.kind !== "unencrypted") {
        throw new PdfEngineError(LOCKED_PDF_COPY[access.kind], "encrypted");
      }
    }
    throw err;
  }
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
    const { bytes: optimized, signatureCount } = await repackOrExplain(bytes);
    return {
      outputName: outputName(file.name, "optimized"),
      bytes: optimized,
      originalBytes: bytes.byteLength,
      optimizedBytes: optimized.byteLength,
      savedBytes: Math.max(0, bytes.byteLength - optimized.byteLength),
      signatureCount,
    };
  }, []);

  const { state, progress, start, cancel, reset, running } =
    useBatchRunner<CompressResult>(units, process);

  const settled = state.phase === "done" || state.phase === "canceled";
  const totalSaved = state.items.reduce(
    (sum, item) => sum + (item.result?.savedBytes ?? 0),
    0,
  );
  const doneItems = state.items.filter(
    (item): item is BatchItem<CompressResult> & { result: CompressResult } =>
      item.status === "done" && !!item.result,
  );
  // A signed file's repack invalidates its signatures, so it is left out of
  // every download until the person opts it in, having been told why.
  const [includeSigned, setIncludeSigned] = useState(false);
  const includeSignedId = useId();
  const signedCount = doneItems.filter(
    (item) => item.result.signatureCount > 0,
  ).length;
  const downloadable = doneItems.filter(
    (item) => includeSigned || item.result.signatureCount === 0,
  );

  const downloadAll = useCallback(async () => {
    const named: NamedBytes[] = downloadable.map((item) => ({
      name: item.result.outputName,
      bytes: item.result.bytes,
    }));
    if (named.length === 0) return;
    const blob = await zipFiles(named);
    downloadBlob(blob, "pdfxyz-compressed.zip");
  }, [downloadable]);

  return (
    <div className="flex flex-col gap-5">
      {preloaded && (
        <HandoffLoadedBadge count={files.length} skipped={skipped} />
      )}

      {/* Honest scope banner: lossless-only, on-device. */}
      <div className="bg-panel border-line flex items-start gap-2.5 rounded-[4px] border p-4">
        <Info className="text-accent mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="text-muted text-sm leading-relaxed">
          Batch <span className="text-fg">lossless compression</span> repacks
          each PDF&apos;s structure in your browser — every page looks the same,
          and nothing is uploaded. A digitally signed file is flagged, because
          any rewrite makes its signatures show as invalid. It doesn&apos;t
          re-encode images; image-heavy files need the secure worker (open a
          single file to see that path).
        </p>
      </div>

      {/* Accessible progress */}
      <div className="flex flex-col gap-2">
        <div className="text-muted flex items-center justify-between text-xs">
          <span>
            {state.phase === "idle"
              ? `${files.length} PDF${files.length === 1 ? "" : "s"} ready`
              : `${progress.settled} of ${progress.total} done`}
            {progress.error > 0 && (
              <span className="text-warn"> · {progress.error} failed</span>
            )}
            {progress.canceled > 0 && (
              <span className="text-muted">
                {" "}
                · {progress.canceled} canceled
              </span>
            )}
          </span>
          {settled && totalSaved > 0 && (
            <span className="text-ok font-medium">
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
          className="bg-wash h-2 w-full overflow-hidden rounded-full"
        >
          <span
            className={cn(
              "bg-accent block h-full rounded-full transition-[width] duration-300",
              state.phase === "canceled" && "bg-faint",
            )}
            style={{ width: `${progress.pct}%` }}
          />
        </div>
      </div>

      {/* Per-item results */}
      <ul className="flex flex-col gap-2" aria-label="Files in this batch">
        {state.items.map((item) => (
          <BatchRow
            key={item.id}
            item={item}
            allowDownload={
              includeSigned || (item.result?.signatureCount ?? 0) === 0
            }
          />
        ))}
      </ul>

      {settled && signedCount > 0 && (
        <label
          htmlFor={includeSignedId}
          className="border-warn/40 bg-warn/10 text-warn flex items-start gap-2 rounded-[4px] border px-4 py-3 text-sm"
        >
          <input
            id={includeSignedId}
            type="checkbox"
            checked={includeSigned}
            onChange={(e) => setIncludeSigned(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Include {signedCount} signed file{signedCount === 1 ? "" : "s"} in
            the download — {signedCount === 1 ? "its" : "their"} digital
            signatures will show as invalid.
          </span>
        </label>
      )}

      {/* Polite completion announcement for screen readers */}
      <p role="status" aria-live="polite" className="sr-only">
        {state.phase === "done" &&
          `Batch complete. ${progress.done} compressed, ${progress.error} failed.`}
        {state.phase === "canceled" && "Batch canceled."}
      </p>

      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted text-xs">
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
              {downloadable.length > 0 && (
                <button
                  type="button"
                  onClick={downloadAll}
                  className={buttonVariants({ variant: "primary", size: "sm" })}
                >
                  <FileArchive className="size-4" aria-hidden />
                  Download all ({downloadable.length})
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
function BatchRow({
  item,
  allowDownload,
}: {
  item: BatchItem<CompressResult>;
  /** False for a signed file the person has not opted into downloading. */
  allowDownload: boolean;
}) {
  return (
    <li className="bg-panel border-line flex items-center gap-3 rounded-[3px] border px-3 py-2.5">
      <StatusGlyph status={item.status} />
      <span className="min-w-0 flex-1">
        <span className="text-fg block truncate text-sm">{item.name}</span>
        <span className="text-muted block text-xs">
          <BatchDetail item={item} />
        </span>
      </span>
      {item.status === "done" && item.result && allowDownload && (
        <button
          type="button"
          onClick={() =>
            downloadBytes(item.result!.bytes, item.result!.outputName)
          }
          aria-label={`Download compressed ${item.name}`}
          className="text-muted hover:bg-wash hover:text-fg grid size-8 shrink-0 place-items-center rounded-lg transition"
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
      return <span className="text-accent">Compressing…</span>;
    case "canceled":
      return <>Canceled</>;
    case "error":
      return (
        <span className="text-warn">{item.error ?? "Couldn’t compress"}</span>
      );
    case "done": {
      const r = item.result;
      if (!r) return null;
      const size =
        r.savedBytes > 0 ? (
          <span className="text-ok">
            {`−${formatBytes(r.savedBytes)} (${pct(r.savedBytes, r.originalBytes)}%) · ${formatBytes(r.optimizedBytes)}`}
          </span>
        ) : (
          <>Already lean — no change</>
        );
      if (r.signatureCount === 0) return size;
      return (
        <>
          {size} ·{" "}
          <span className="text-warn">
            {r.signatureCount} digital signature
            {r.signatureCount === 1 ? "" : "s"} will show as invalid
          </span>
        </>
      );
    }
    default:
      return null;
  }
}

function StatusGlyph({
  status,
}: {
  status: BatchItem<CompressResult>["status"];
}) {
  const base = "grid size-8 shrink-0 place-items-center rounded-lg";
  switch (status) {
    case "running":
      return (
        <span className={cn(base, "bg-accent/10 text-accent")}>
          <Spinner className="size-4" />
        </span>
      );
    case "done":
      return (
        <span className={cn(base, "bg-ok/10 text-ok")}>
          <CheckCircle2 className="size-4" aria-hidden />
        </span>
      );
    case "error":
      return (
        <span className={cn(base, "bg-warn/10 text-warn")}>
          <AlertTriangle className="size-4" aria-hidden />
        </span>
      );
    case "canceled":
      return (
        <span className={cn(base, "bg-wash text-muted")}>
          <CircleSlash className="size-4" aria-hidden />
        </span>
      );
    default:
      return (
        <span className={cn(base, "bg-wash text-muted")}>
          <Clock className="size-4" aria-hidden />
        </span>
      );
  }
}
