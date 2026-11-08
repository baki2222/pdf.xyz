"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { Info, ServerCog } from "lucide-react";
import { optimizeLossless, type LosslessResult } from "@/lib/pdf/analyze";
import {
  classifyPdfAccess,
  LOCKED_PDF_COPY,
  type PdfAccess,
} from "@/lib/pdf/encryption";
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
  BATCH_RESTRICTED_NOTE,
} from "@/lib/pdf/compress-batch-copy";
import { capBatchFiles } from "@/lib/batch/limits";
import { reportToolFailed } from "@/lib/telemetry/tool-outcome";
import { useWorkerStatus } from "../use-worker-status";
import { canRunDeepCompression, qualityChipTitle } from "./compress-deep-gate";
import { readFileBytes } from "@/lib/pdf/browser";
import { outputName } from "@/lib/pdf/files";
import { formatBytes } from "@/lib/utils";
import type { Arrival } from "./handoff-notice";
import { ChipButton, failureCode } from "./runner-kit";
import { BatchView } from "./batch/batch-view";
import { useBatchRunner, type BatchUnit } from "./use-batch-runner";

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
 * A batch row's refusal of a locked file, in the single-file path's words. A
 * restricted file is pointed at the single-file panel, the one place that
 * warns before our server writes a copy without the owner's restrictions.
 */
function lockedRefusal(
  kind: Exclude<PdfAccess["kind"], "unencrypted">,
): PdfEngineError {
  return new PdfEngineError(
    kind === "restricted"
      ? `${LOCKED_PDF_COPY.restricted} ${BATCH_RESTRICTED_NOTE}`
      : LOCKED_PDF_COPY[kind],
    { kind: "encrypted" },
  );
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
      if (access.kind !== "unencrypted") throw lockedRefusal(access.kind);
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
  // Read the lock BEFORE anything is uploaded (review of cb0eb82e).
  // Ghostscript writes an unencrypted copy, so a restricted file would come
  // back with its author's restrictions gone and no owner password given;
  // the single-file panel shows a warning first, a batch row cannot. A file
  // that needs a password to open cannot be compressed by anyone. Both get
  // the lossless batch's own words, and none of their bytes leave.
  // An "unreadable" file still goes: pdf.js failing to open it is not a lock,
  // and our server may read what the browser cannot.
  const access = await classifyPdfAccess(bytes);
  if (access.kind === "restricted" || access.kind === "password-required") {
    // Reported HERE: a deep row's outcome is otherwise reported only by
    // `runWorkerCompression`, and this refusal never reaches it (the batch
    // runs deep rows with `reportsOutcome: false`, so it is not counted
    // twice). One report per file, either way.
    const refusal = lockedRefusal(access.kind);
    reportToolFailed({ code: failureCode(refusal) });
    throw refusal;
  }
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
 * A finished row as the batch keeps it: the result's facts, and its file as a
 * Blob. The input's bytes are let go as the row settles, so a batch holds one
 * decoded input at a time, never all of them.
 */
type CompressRow = Omit<CompressResult, "bytes"> & { blob: Blob };

function toRow({ bytes, ...facts }: CompressResult): CompressRow {
  return {
    ...facts,
    blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
  };
}

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** A finished row's detail line: what it saved, and what to know about it. */
function describeRow(r: CompressRow) {
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

const rowOutputs = (r: CompressRow) => [
  { name: r.outputName, blob: r.blob, signatureCount: r.signatureCount },
];

const pdfs = (n: number) => `${n} PDF${n === 1 ? "" : "s"}`;

/**
 * Batch compress: run the **lossless** structural repack (pdf-lib) over several
 * PDFs, one at a time, entirely in the browser. This is the only deterministic,
 * no-input compression we can honestly do client-side — it never re-encodes
 * images, so we say so plainly and point image-heavy files at the secure worker.
 * Nothing is uploaded. The rows, controls and downloads are the generic batch
 * view's (`./batch/batch-view`); this module brings Compress's work and words.
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
  // A batch takes up to `BATCH_LIMITS.clientMaxFiles` files and
  // `clientMaxTotalBytes` in all; every file past either is listed with its
  // reason, never dropped silently.
  const { accepted, rejected } = useMemo(() => capBatchFiles(files), [files]);
  const units = useMemo<BatchUnit[]>(
    () =>
      accepted.map((file, i) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${i}`,
        name: file.name,
        file,
      })),
    [accepted],
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
    async (file: File, signal: AbortSignal): Promise<CompressRow> =>
      toRow(
        deep
          ? await compressBatchFileDeep(
              file,
              { targetDpi: dpi, grayscale },
              signal,
            )
          : await compressBatchFile(file),
      ),
    [deep, dpi, grayscale],
  );

  // A deep row runs inside `runWorkerCompression`, which reports its own
  // outcome (`withToolOutcome`); the batch reporting it too counted every
  // server file twice. The lossless repack reports nowhere else.
  const runner = useBatchRunner<CompressRow>(units, process, {
    reportsOutcome: !deep,
  });

  const totalSaved = runner.state.items.reduce(
    (sum, item) => sum + (item.result?.savedBytes ?? 0),
    0,
  );

  const banner = (
    <div className="bg-panel border-line rounded-panel flex items-start gap-2.5 border p-4">
      {deep ? (
        <ServerCog className="text-info mt-0.5 size-4 shrink-0" aria-hidden />
      ) : (
        <Info className="text-accent mt-0.5 size-4 shrink-0" aria-hidden />
      )}
      <p className="text-muted text-sm leading-relaxed">
        {deep ? (
          <>
            <span className="text-fg">Deep image compression</span> downsamples
            and re-encodes each PDF&apos;s images on our secure server, one file
            at a time, with the settings below. A file that does not get smaller
            comes back unchanged. A digitally signed file is flagged, because
            any rewrite makes its signatures show as invalid.
          </>
        ) : (
          <>
            Batch <span className="text-fg">lossless compression</span> repacks
            each PDF&apos;s structure in your browser — every page looks the
            same, and nothing is uploaded. A digitally signed file is flagged,
            because any rewrite makes its signatures show as invalid. It
            doesn&apos;t re-encode images
            {deepAvailable
              ? `; for image-heavy files, choose “${BATCH_DEEP_LABEL}” below.`
              : "."}
          </>
        )}
      </p>
    </div>
  );

  const settings = deepAvailable ? (
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
            Running this uploads each file to our secure server, one at a time.
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
  ) : null;

  return (
    <BatchView<CompressRow>
      runner={runner}
      arrivedCount={files.length}
      arrival={arrival}
      rejected={rejected}
      banner={banner}
      settings={settings}
      countLabel={pdfs}
      runLabel={(n) => `Compress ${pdfs(n)}${deep ? " on our server" : ""}`}
      runningLabel="Compressing…"
      errorFallback="Couldn’t compress"
      progressLabel="Batch compression progress"
      footnote={
        deep
          ? "Files are uploaded and compressed one at a time, on our secure server."
          : "Files are processed one at a time, on your device."
      }
      outputs={rowOutputs}
      describe={describeRow}
      downloadLabel={(item, r) =>
        `Download ${r.unchanged ? "unchanged" : "compressed"} ${item.name}`
      }
      doneSentence={(p) =>
        `Batch complete. ${p.done} compressed, ${p.error} failed.`
      }
      settledSummary={
        totalSaved > 0 ? (
          <span className="text-ok font-medium">
            −{formatBytes(totalSaved)} total
          </span>
        ) : null
      }
      inputBytes={(r) => r.originalBytes}
      zipName="pdfxyz-compressed.zip"
      // Every file in the ZIP has its own download button above: a signed
      // one only once it is opted in, which is also when it joins the ZIP.
      zipFallback="If it keeps failing, download the files one at a time above."
      onReset={onReset}
    />
  );
}
