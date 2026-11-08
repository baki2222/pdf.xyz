"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Clock,
  Download,
  FileArchive,
  MinusCircle,
  Play,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import type { BatchItem, BatchItemStatus, BatchProgress } from "@/lib/batch";
import { announcesSettle } from "@/lib/batch/announce";
import type { BatchRejection } from "@/lib/batch/limits";
import { downloadBlob } from "@/lib/pdf/browser";
import type { NamedBlob } from "@/lib/pdf/types";
import { buttonVariants } from "@/components/ui/button";
import { NAME_WRAP } from "@/components/ui/name-wrap";
import { cn } from "@/lib/utils";
import { HandoffLoadedBadge, type Arrival } from "../handoff-notice";
import {
  ErrorNote,
  RunEnding,
  Spinner,
  outputFile,
  warmEnding,
} from "../runner-kit";
import { holdRunnerStage } from "../stage-hold";
import type { BatchRunner } from "../use-batch-runner";
import { useZipDownload } from "../use-zip-download";

/**
 * Rendered on the batch view (`data-chunk`), so `lazy-chunks.test.ts` can find
 * the chunk this module ships in and hold it off every page's first load: a
 * tool page pays for the batch only once two or more files arrive.
 */
export const BATCH_VIEW_LOADED = "pdfxyz:lazy:batch-view";

/** One file a finished row hands back. */
export interface BatchOutputFile extends NamedBlob {
  /** Digital signatures this output invalidates (it is held back until opted in). */
  signatureCount?: number;
}

export interface BatchViewProps<R> {
  runner: BatchRunner<R>;
  /** How many files arrived (before any cap), for the hand-off badge. */
  arrivedCount: number;
  /** Set when the files were handed over from another page. */
  arrival?: Arrival | null;
  /** Files the batch did not take, each with its reason: never dropped silently. */
  rejected?: readonly BatchRejection<File>[];
  /** What THIS batch will do, and where. */
  banner: ReactNode;
  /** The tool's own settings, shown while nothing has run. */
  settings?: ReactNode;
  /** "2 PDFs" — the count with its noun. */
  countLabel: (count: number) => string;
  /** The Run button: "Compress 2 PDFs". */
  runLabel: (count: number) => string;
  /** A running row: "Compressing…". */
  runningLabel: string;
  /** A failed row with no message of its own. */
  errorFallback: string;
  /** The progress bar's name. */
  progressLabel: string;
  /** Under the list: where the files are processed. */
  footnote: string;
  /** What a finished row hands back. */
  outputs: (result: R) => BatchOutputFile[];
  /** A finished row's detail line. */
  describe: (result: R) => ReactNode;
  /** A row's download button name: "Download compressed report.pdf". */
  downloadLabel: (item: BatchItem<R>, result: R) => string;
  /** Spoken when the batch finishes. */
  doneSentence: (progress: BatchProgress) => string;
  /** Beside the count once settled ("−2 MB total"), when there is one. */
  settledSummary?: ReactNode;
  /** The input bytes behind a finished row, for the receipt. */
  inputBytes: (result: R) => number;
  /** The ZIP's file name. */
  zipName: string;
  /** What this tool offers when the ZIP cannot be built. */
  zipFallback: string;
  /** "Choose different files" / "New files". */
  onReset: () => void;
}

const TERMINAL: ReadonlySet<BatchItemStatus> = new Set([
  "done",
  "error",
  "skipped",
  "canceled",
]);

/** The row's state as a word for the live region (never colour alone). */
const SPOKEN: Partial<Record<BatchItemStatus, string>> = {
  done: "done",
  error: "failed",
  skipped: "skipped",
};

/**
 * The generic batch view, lifted out of Compress's batch (batch plan P0b):
 * the progress bar, the rows, the live region, the controls, the opt-in for
 * signed files, "Download all (N)" and the run's ending. A tool brings its
 * runner (`useBatchRunner`), its words, and how to read its result.
 */
export function BatchView<R>({
  runner,
  arrivedCount,
  arrival = null,
  rejected = [],
  banner,
  settings,
  countLabel,
  runLabel,
  runningLabel,
  errorFallback,
  progressLabel,
  footnote,
  outputs: outputsOf,
  describe,
  downloadLabel,
  doneSentence,
  settledSummary,
  inputBytes: inputBytesOf,
  zipName,
  zipFallback,
  onReset,
}: BatchViewProps<R>) {
  const {
    state,
    progress,
    start,
    cancel,
    reset,
    retryFailed,
    remove,
    haltReason,
    running,
  } = runner;
  const settled = state.phase === "done" || state.phase === "canceled";
  const count = state.items.length;

  // The stage is held from the press (`../stage-hold`): the rows and the
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

  const doneItems = state.items.filter(
    (item): item is BatchItem<R> & { result: R } =>
      item.status === "done" && item.result !== undefined,
  );
  const signaturesOf = (result: R) =>
    outputsOf(result).reduce((sum, f) => sum + (f.signatureCount ?? 0), 0);
  // A signed file's rewrite invalidates its signatures, so it is left out of
  // every download until the person opts it in, having been told why.
  const [includeSigned, setIncludeSigned] = useState(false);
  const includeSignedId = useId();
  const signedCount = doneItems.filter(
    (item) => signaturesOf(item.result) > 0,
  ).length;
  const downloadable = doneItems.filter(
    (item) => includeSigned || signaturesOf(item.result) === 0,
  );

  // What the batch made, as the files a download gives — and so what the
  // receipt counts and "Continue with" carries (several PDFs: only to the
  // tool that combines them).
  const files = useMemo(
    () => downloadable.flatMap((item) => outputsOf(item.result)),
    [downloadable, outputsOf],
  );
  const outputs = useMemo(
    () => files.map((file) => outputFile(file.blob, file.name)),
    [files],
  );
  const inputBytes = downloadable.reduce(
    (sum, item) => sum + inputBytesOf(item.result),
    0,
  );

  const { zipping, zipError, downloadZip } = useZipDownload();
  const downloadAll = useCallback(async () => {
    if (files.length === 0) return;
    // STORE: a batch's outputs are already-compressed files, and DEFLATE
    // would only spend a phone's CPU on them.
    await downloadZip(
      files.map(({ name, blob }) => ({ name, blob })),
      zipName,
      { compression: "STORE", fallback: zipFallback },
    );
  }, [files, downloadZip, zipName, zipFallback]);

  // The live region: each file as it settles (`announcesSettle`), and the
  // batch's end. "Adjusting state while rendering" keeps the previous
  // statuses without an effect: one sentence per change, no double render.
  const statusKey = state.items.map((i) => `${i.id}:${i.status}`).join("|");
  const [seen, setSeen] = useState(() => ({
    key: statusKey,
    statuses: new Map(state.items.map((i) => [i.id, i.status])),
    spoken: "",
  }));
  if (seen.key !== statusKey) {
    let spoken = seen.spoken;
    let settledSoFar = state.items.filter(
      (i) =>
        TERMINAL.has(i.status) &&
        i.status !== "canceled" &&
        TERMINAL.has(seen.statuses.get(i.id) ?? "queued"),
    ).length;
    for (const item of state.items) {
      const before = seen.statuses.get(item.id) ?? "queued";
      const word = SPOKEN[item.status];
      if (!word || TERMINAL.has(before)) continue;
      settledSoFar += 1;
      if (announcesSettle(settledSoFar, count, item.status === "error")) {
        spoken = `${item.name}: ${word}. ${settledSoFar} of ${count} files processed.`;
      }
    }
    setSeen({
      key: statusKey,
      statuses: new Map(state.items.map((i) => [i.id, i.status])),
      spoken,
    });
  }
  const announcement =
    state.phase === "done"
      ? doneSentence(progress)
      : state.phase === "canceled"
        ? (haltReason ?? "Batch canceled.")
        : state.phase === "running"
          ? seen.spoken
          : "";

  return (
    <div data-chunk={BATCH_VIEW_LOADED} className="flex flex-col gap-5">
      {arrival && (
        <HandoffLoadedBadge
          origin={arrival.origin}
          count={arrivedCount}
          skipped={arrival.skipped}
        />
      )}

      <RejectedNote rejected={rejected} />

      {banner}

      {state.phase === "idle" && settings}

      {/* Accessible progress */}
      <div className="flex flex-col gap-2">
        <div className="text-muted flex items-center justify-between text-xs">
          <span>
            {state.phase === "idle"
              ? `${countLabel(count)} ready`
              : `${progress.settled} of ${progress.total} done`}
            {progress.error > 0 && (
              <span className="text-warn"> · {progress.error} failed</span>
            )}
            {progress.skipped > 0 && (
              <span className="text-muted"> · {progress.skipped} skipped</span>
            )}
            {progress.canceled > 0 && (
              <span className="text-muted">
                {" "}
                · {progress.canceled} canceled
              </span>
            )}
          </span>
          {settled && settledSummary}
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.pct}
          aria-valuetext={`${progress.settled} of ${progress.total} files processed`}
          aria-label={progressLabel}
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
            runningLabel={runningLabel}
            errorFallback={errorFallback}
            describe={describe}
            outputs={outputsOf}
            downloadLabel={downloadLabel}
            allowDownload={
              includeSigned ||
              item.result === undefined ||
              signaturesOf(item.result) === 0
            }
            onRemove={
              state.phase === "idle" && count > 1 ? () => remove(item.id) : null
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

      {/* Polite announcements for screen readers */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {haltReason && <ErrorNote message={haltReason} />}
      {zipError && <ErrorNote message={zipError} />}

      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted text-xs">{footnote}</p>
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
                {runLabel(count)}
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
              {progress.error > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    settleHold.current = holdRunnerStage();
                    retryFailed();
                  }}
                  className={buttonVariants({
                    variant: "outline",
                    size: "sm",
                  })}
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                  Retry failed ({progress.error})
                </button>
              )}
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

/** A row button: 44px on a phone, the old 32px from `sm` up. */
const ROW_BUTTON =
  "text-muted hover:bg-wash hover:text-fg rounded-ctl grid size-11 shrink-0 place-items-center transition sm:size-8";

/** One row in the batch list: status glyph, name, and per-item result/error. */
function BatchRow<R>({
  item,
  runningLabel,
  errorFallback,
  describe,
  outputs,
  downloadLabel,
  allowDownload,
  onRemove,
}: {
  item: BatchItem<R>;
  runningLabel: string;
  errorFallback: string;
  describe: (result: R) => ReactNode;
  outputs: (result: R) => BatchOutputFile[];
  downloadLabel: (item: BatchItem<R>, result: R) => string;
  /** False for a signed file the person has not opted into downloading. */
  allowDownload: boolean;
  /** Present before Run, while more than one file is listed. */
  onRemove: (() => void) | null;
}) {
  const result = item.status === "done" ? item.result : undefined;
  const files = result !== undefined && allowDownload ? outputs(result) : [];
  return (
    <li className="bg-panel border-line rounded-ctl flex items-center gap-3 border px-3 py-2.5">
      <StatusGlyph status={item.status} />
      <span className="min-w-0 flex-1">
        <span className="text-fg block truncate text-sm">{item.name}</span>
        <span className="text-muted block text-xs">
          <BatchDetail
            item={item}
            runningLabel={runningLabel}
            errorFallback={errorFallback}
            describe={describe}
          />
        </span>
      </span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${item.name}`}
          className={ROW_BUTTON}
        >
          <X className="size-4" aria-hidden />
        </button>
      ) : files.length > 0 && result !== undefined ? (
        files.map((file) => (
          <button
            key={file.name}
            type="button"
            onClick={() => downloadBlob(file.blob, file.name)}
            aria-label={downloadLabel(item, result)}
            className={ROW_BUTTON}
          >
            <Download className="size-4" aria-hidden />
          </button>
        ))
      ) : (
        // The button's place, kept: a row that gains or loses its button as
        // it settles must not change height under the reader (44px on a
        // phone is taller than the row's text).
        <span aria-hidden className="size-11 shrink-0 sm:size-8" />
      )}
    </li>
  );
}

function BatchDetail<R>({
  item,
  runningLabel,
  errorFallback,
  describe,
}: {
  item: BatchItem<R>;
  runningLabel: string;
  errorFallback: string;
  describe: (result: R) => ReactNode;
}) {
  switch (item.status) {
    case "queued":
      return <>Queued</>;
    case "running":
      return <span className="text-accent">{runningLabel}</span>;
    case "canceled":
      return <>Canceled</>;
    case "skipped":
      return <>Skipped · {item.reason}</>;
    case "error":
      return <span className="text-warn">{item.error ?? errorFallback}</span>;
    case "done":
      if (item.result === undefined) return null;
      return item.note ? (
        <>
          {describe(item.result)} ·{" "}
          <span className="text-warn">{item.note}</span>
        </>
      ) : (
        <>{describe(item.result)}</>
      );
    default:
      return null;
  }
}

function StatusGlyph({ status }: { status: BatchItemStatus }) {
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
    case "skipped":
      return (
        <span className={cn(base, "bg-wash text-muted")}>
          <MinusCircle className="size-4" aria-hidden />
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

/** Files the batch did not take, each with why: never dropped silently. */
function RejectedNote({
  rejected,
}: {
  rejected: readonly BatchRejection<File>[];
}) {
  const [dismissed, setDismissed] = useState(false);
  if (rejected.length === 0 || dismissed) return null;
  return (
    <div
      role="alert"
      className="border-warn/40 bg-warn/10 text-warn rounded-panel flex flex-col gap-2 border px-4 py-3 text-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex items-center gap-2 font-medium">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {rejected.length} file{rejected.length === 1 ? "" : "s"} not added to
          this batch
        </span>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-warn hover:bg-warn/10 hover:text-warn rounded-ctl min-h-11 shrink-0 px-2 py-0.5 text-xs transition sm:min-h-0"
        >
          Dismiss
        </button>
      </div>
      <ul className="text-warn flex flex-col gap-1 pl-6 text-xs">
        {rejected.map((r, i) => (
          <li
            key={`${r.file.name}-${i}`}
            className={cn("list-disc", NAME_WRAP)}
          >
            <span className="text-warn font-medium">{r.file.name}</span> —{" "}
            {r.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
