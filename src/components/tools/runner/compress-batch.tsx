"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
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
  ServerCog,
  X,
} from "lucide-react";
import { optimizeLossless, type LosslessResult } from "@/lib/pdf/analyze";
import { classifyPdfAccess, LOCKED_PDF_COPY } from "@/lib/pdf/encryption";
import { PdfEngineError, loadPdf } from "@/lib/pdf/engine";
import { loadPdfLib } from "@/lib/pdf/pdf-lib";
import { countSignatures } from "@/lib/pdf/signed";
import { DEEP_COMPRESSION_PRESETS } from "@/lib/pdf/offered-kinds";
import { DEEP_COMPRESSION_GRAYSCALE_HINT } from "@/lib/pdf/compress-grayscale";
import { runWorkerCompression } from "@/lib/workers/client";
import {
  BATCH_DEEP_LABEL,
  BATCH_LOSSLESS_LABEL,
  BATCH_MODE_HEADING,
} from "@/lib/pdf/compress-batch-copy";
import { useWorkerStatus } from "../use-worker-status";
import { canRunDeepCompression, qualityChipTitle } from "./compress-deep-gate";
import { downloadBytes, readFileBytes } from "@/lib/pdf/browser";
import { outputName } from "@/lib/pdf/files";
import type { NamedBytes } from "@/lib/pdf/types";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatBytes } from "@/lib/utils";
import type { BatchItem } from "@/lib/batch";
import { HandoffLoadedBadge, type Arrival } from "./handoff-notice";
import {
  ChipButton,
  ErrorNote,
  RunEnding,
  Spinner,
  outputFile,
  warmEnding,
} from "./runner-kit";
import { holdRunnerStage } from "./stage-hold";
import { useBatchRunner, type BatchUnit } from "./use-batch-runner";
import { useZipDownload } from "./use-zip-download";

/** Deterministic, on-device result of losslessly repacking one PDF. */
export interface CompressResult {
  outputName: string;
  bytes: Uint8Array;
  originalBytes: number;
  optimizedBytes: number;
  savedBytes: number;
  /**
   * True when `bytes` are the input exactly as it came in: the repack was not
   * smaller, so there is nothing better to hand back.
   */
  unchanged: boolean;
  /**
   * Digital signatures the delivered bytes invalidate: every one in the input
   * when the repack is delivered, none when the original is.
   */
  signatureCount: number;
  /**
   * The deep path only: the input could not be read in the browser (an
   * encrypted file), so its signatures were not counted.
   */
  signaturesUnchecked?: boolean;
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
          `${LOCKED_PDF_COPY.restricted} Compress it on its own to use our secure server.`,
          { kind: "encrypted" },
        );
      }
      if (access.kind !== "unencrypted") {
        throw new PdfEngineError(LOCKED_PDF_COPY[access.kind], {
          kind: "encrypted",
        });
      }
    }
    throw err;
  }
}

/**
 * One batch row's work: read, repack, and say what came of it.
 *
 * A repack that is not smaller is never delivered. pdf-lib rewrites the
 * Producer/Creator/dates and the cross-reference, so a small, already-compact
 * file can come back LARGER. Until 2026-11-06 (audit #20) the batch shipped it
 * anyway, as "-optimized.pdf", under a row that said "no change"; the
 * single-file path has always offered the original instead, and so does this.
 */
export async function compressBatchFile(file: File): Promise<CompressResult> {
  const bytes = await readFileBytes(file);
  const { bytes: optimized, signatureCount } = await repackOrExplain(bytes);
  if (optimized.byteLength >= bytes.byteLength) {
    return {
      outputName: file.name,
      bytes,
      originalBytes: bytes.byteLength,
      optimizedBytes: bytes.byteLength,
      savedBytes: 0,
      unchanged: true,
      // The file's own bytes: its signatures are exactly as they were.
      signatureCount: 0,
    };
  }
  return {
    outputName: outputName(file.name, "optimized"),
    bytes: optimized,
    originalBytes: bytes.byteLength,
    optimizedBytes: optimized.byteLength,
    savedBytes: bytes.byteLength - optimized.byteLength,
    unchanged: false,
    signatureCount,
  };
}

/** One setting for every file of a deep batch (audit compress-pdf#5). */
export interface BatchDeepOptions {
  targetDpi: number;
  grayscale: boolean;
}

/** Signatures in `bytes`, or `null` when the browser cannot read the file. */
async function signaturesIn(bytes: Uint8Array): Promise<number | null> {
  try {
    const lib = await loadPdfLib();
    return countSignatures(lib, await loadPdf(bytes));
  } catch {
    return null;
  }
}

/**
 * One batch row on our secure server (audit compress-pdf#5): the same job
 * the single-file panel runs, one file at a time. As there, a file that did
 * not get smaller comes back as it came in, except on a Grayscale run,
 * whose gray file is a different document and always ships.
 */
export async function compressBatchFileDeep(
  file: File,
  options: BatchDeepOptions,
  signal?: AbortSignal,
): Promise<CompressResult> {
  const bytes = await readFileBytes(file);
  const res = await runWorkerCompression(
    {
      filename: file.name,
      bytes,
      profile: "deep",
      targetDpi: options.targetDpi,
      grayscale: options.grayscale,
    },
    signal ? { signal } : {},
  );
  if (!res.ok) throw new Error(res.message);
  const output = res.output;
  if (!options.grayscale && output.byteLength >= bytes.byteLength) {
    return {
      outputName: file.name,
      bytes,
      originalBytes: bytes.byteLength,
      optimizedBytes: bytes.byteLength,
      savedBytes: 0,
      unchanged: true,
      signatureCount: 0,
    };
  }
  const signatures = await signaturesIn(bytes);
  return {
    outputName: res.artifact.filename || outputName(file.name, "compressed"),
    bytes: output,
    originalBytes: bytes.byteLength,
    optimizedBytes: output.byteLength,
    savedBytes: Math.max(0, bytes.byteLength - output.byteLength),
    unchanged: false,
    signatureCount: signatures ?? 0,
    ...(signatures === null ? { signaturesUnchecked: true } : {}),
  };
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
  arrival = null,
}: {
  files: File[];
  onReset: () => void;
  /** Set when the files were handed over from another page. */
  arrival?: Arrival | null;
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

  // Where the batch runs: the lossless repack in this browser (the default),
  // or, opted into, our secure server with one Quality and Grayscale for
  // every file (audit compress-pdf#5). Offered only when a server can take
  // the jobs: the single-file panel's own gate.
  const shared = useWorkerStatus();
  const deepAvailable =
    shared.phase !== "loading" &&
    shared.phase !== "error" &&
    canRunDeepCompression(shared.status);
  const [mode, setMode] = useState<"lossless" | "deep">("lossless");
  const [dpi, setDpi] = useState<number>(150);
  const [grayscale, setGrayscale] = useState(false);
  const deep = mode === "deep" && deepAvailable;
  const modeName = useId();

  const process = useCallback(
    (file: File, signal: AbortSignal): Promise<CompressResult> =>
      deep
        ? compressBatchFileDeep(file, { targetDpi: dpi, grayscale }, signal)
        : compressBatchFile(file),
    [deep, dpi, grayscale],
  );

  const { state, progress, start, cancel, reset, running } =
    useBatchRunner<CompressResult>(units, process);

  const settled = state.phase === "done" || state.phase === "canceled";
  // The stage is held from the press (`./stage-hold`): the rows and the
  // ending the batch draws come long after it. Once it settles, the hold
  // keeps nothing past the bottom of the screen, and the rest goes at the
  // reader's next click or key.
  const settleHold = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!settled) return;
    settleHold.current?.();
    settleHold.current = null;
  }, [settled]);
  // Unmounted mid-batch: the rows it was held for will never be drawn.
  useEffect(() => () => settleHold.current?.(), []);
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

  // What the batch made, as the files a download gives — and so what the
  // receipt counts and "Continue with" carries (several PDFs: only to the
  // tool that combines them).
  const outputs = useMemo(
    () =>
      downloadable.map((item) =>
        outputFile(item.result.bytes, item.result.outputName),
      ),
    [downloadable],
  );
  const inputBytes = downloadable.reduce(
    (sum, item) => sum + item.result.originalBytes,
    0,
  );

  const { zipping, zipError, downloadZip } = useZipDownload();
  const downloadAll = useCallback(async () => {
    const named: NamedBytes[] = downloadable.map((item) => ({
      name: item.result.outputName,
      bytes: item.result.bytes,
    }));
    if (named.length === 0) return;
    await downloadZip(named, "pdfxyz-compressed.zip", {
      // Every file in the ZIP has its own download button above: a signed
      // one only once it is opted in, which is also when it joins the ZIP.
      fallback: "If it keeps failing, download the files one at a time above.",
    });
  }, [downloadable, downloadZip]);

  return (
    <div className="flex flex-col gap-5">
      {arrival && (
        <HandoffLoadedBadge
          origin={arrival.origin}
          count={files.length}
          skipped={arrival.skipped}
        />
      )}

      {/* Honest scope banner: what THIS batch will do, and where. */}
      <div className="bg-panel border-line rounded-panel flex items-start gap-2.5 border p-4">
        {deep ? (
          <ServerCog className="text-info mt-0.5 size-4 shrink-0" aria-hidden />
        ) : (
          <Info className="text-accent mt-0.5 size-4 shrink-0" aria-hidden />
        )}
        <p className="text-muted text-sm leading-relaxed">
          {deep ? (
            <>
              <span className="text-fg">Deep image compression</span>{" "}
              downsamples and re-encodes each PDF&apos;s images on our secure
              server, one file at a time, with the settings below. A file that
              does not get smaller comes back unchanged. A digitally signed file
              is flagged, because any rewrite makes its signatures show as
              invalid.
            </>
          ) : (
            <>
              Batch <span className="text-fg">lossless compression</span>{" "}
              repacks each PDF&apos;s structure in your browser — every page
              looks the same, and nothing is uploaded. A digitally signed file
              is flagged, because any rewrite makes its signatures show as
              invalid. It doesn&apos;t re-encode images
              {deepAvailable
                ? `; for image-heavy files, choose “${BATCH_DEEP_LABEL}” below.`
                : "."}
            </>
          )}
        </p>
      </div>

      {state.phase === "idle" && deepAvailable && (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-muted mb-1 text-[11px] font-medium tracking-wide uppercase">
            {BATCH_MODE_HEADING}
          </legend>
          <label className="text-fg flex min-h-11 items-center gap-2.5 text-sm">
            <input
              type="radio"
              name={modeName}
              checked={mode === "lossless"}
              onChange={() => setMode("lossless")}
              className="accent-accent size-4"
            />
            {BATCH_LOSSLESS_LABEL}
          </label>
          <label className="text-fg flex min-h-11 items-center gap-2.5 text-sm">
            <input
              type="radio"
              name={modeName}
              checked={mode === "deep"}
              onChange={() => setMode("deep")}
              className="accent-accent size-4"
            />
            {BATCH_DEEP_LABEL}
          </label>
          {deep && (
            <div className="flex flex-col gap-3 pl-6">
              <p className="text-warn text-xs leading-relaxed">
                Running this uploads each file to our secure server, one at a
                time.
              </p>
              <div
                role="group"
                aria-label="Quality"
                className="flex flex-wrap items-center gap-2"
              >
                <span className="text-muted text-[11px] font-medium tracking-wide uppercase">
                  Quality
                </span>
                {DEEP_COMPRESSION_PRESETS.map((q) => (
                  <ChipButton
                    key={q.dpi}
                    onClick={() => setDpi(q.dpi)}
                    active={dpi === q.dpi}
                    title={qualityChipTitle(q.dpi)}
                  >
                    {q.label}
                  </ChipButton>
                ))}
              </div>
              <label className="text-muted flex min-h-11 items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={grayscale}
                  onChange={(event) => setGrayscale(event.target.checked)}
                  className="border-line-strong bg-wash accent-accent rounded-ctl mt-0.5 size-4"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-fg font-medium">Grayscale</span>
                  <span className="text-muted text-xs leading-relaxed">
                    {DEEP_COMPRESSION_GRAYSCALE_HINT}
                  </span>
                </span>
              </label>
            </div>
          )}
        </fieldset>
      )}

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
          className="bg-wash rounded-tag h-2 w-full overflow-hidden"
        >
          <span
            className={cn(
              "rounded-tag block h-full transition-[width] duration-300",
              state.phase === "canceled" ? "bg-faint" : "bg-accent",
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
          className="border-warn/40 bg-warn/10 text-warn rounded-panel flex items-start gap-2 border px-4 py-3 text-sm"
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

      {zipError && <ErrorNote message={zipError} />}

      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted text-xs">
          {deep
            ? "Files are uploaded and compressed one at a time, on our secure server."
            : "Files are processed one at a time, on your device."}
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
                onClick={() => {
                  settleHold.current = holdRunnerStage();
                  void warmEnding().catch(() => {});
                  start();
                }}
                className={buttonVariants({ variant: "primary", size: "sm" })}
              >
                <Play className="size-4" aria-hidden />
                Compress {files.length} PDF{files.length === 1 ? "" : "s"}
                {deep ? " on our server" : ""}
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
                  // `aria-disabled`, not `disabled`, so zipping does not blur
                  // the user out of the button they just pressed.
                  onClick={() => {
                    if (!zipping) void downloadAll();
                  }}
                  aria-disabled={zipping || undefined}
                  aria-busy={zipping}
                  className={buttonVariants({ variant: "primary", size: "sm" })}
                >
                  {zipping ? (
                    <Spinner />
                  ) : (
                    <FileArchive className="size-4" aria-hidden />
                  )}
                  {zipping
                    ? "Preparing ZIP…"
                    : `Download all (${downloadable.length})`}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {settled && outputs.length > 0 && (
        <RunEnding
          output={outputs.length === 1 ? outputs[0]! : outputs}
          inputBytes={inputBytes}
          className="border-line border-t pt-5"
        />
      )}
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
    <li className="bg-panel border-line rounded-ctl flex items-center gap-3 border px-3 py-2.5">
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
          aria-label={`Download ${item.result.unchanged ? "unchanged" : "compressed"} ${item.name}`}
          className="text-muted hover:bg-wash hover:text-fg rounded-ctl grid size-8 shrink-0 place-items-center transition"
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
      const size = !r.unchanged ? (
        <span className="text-ok">
          {`−${formatBytes(r.savedBytes)} (${pct(r.savedBytes, r.originalBytes)}%) · ${formatBytes(r.optimizedBytes)}`}
        </span>
      ) : (
        <>Nothing came out smaller — your file, unchanged</>
      );
      if (r.signaturesUnchecked) {
        return (
          <>
            {size} ·{" "}
            <span className="text-warn">
              encrypted, so not checked for digital signatures
            </span>
          </>
        );
      }
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
  const base = "grid size-8 shrink-0 place-items-center rounded-panel";
  switch (status) {
    case "running":
      return (
        <span className={cn(base, "bg-accent/10 text-accent")}>
          <Spinner />
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
