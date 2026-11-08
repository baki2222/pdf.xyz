"use client";

import { useCallback, useMemo, type ReactNode } from "react";
import { Info } from "lucide-react";
import { withNote, type NotedResult } from "@/lib/batch";
import { capBatchFiles, type BatchRejection } from "@/lib/batch/limits";
import { partitionPdfFiles } from "@/lib/pdf/files";
import { formatBytes } from "@/lib/utils";
import type { Arrival } from "../handoff-notice";
import { useBatchRunner, type BatchUnit } from "../use-batch-runner";
import { BatchView } from "./batch-view";
import { explainLocked, openForBatch, type OpenedPdf } from "./open-for-batch";

/** What a tool's work hands back for one file. */
export interface BatchFileOutput {
  /** The saved file's name: the single-file panel's own download name. */
  name: string;
  bytes: Uint8Array;
  /** The row's detail line once it is done ("3 pages rotated"). */
  detail: string;
  /** A sentence that is not a failure ("No form fields to flatten"). */
  note?: string;
}

/**
 * A finished row as the batch keeps it: its file as a Blob, and the facts
 * its line and the receipt read. The input's bytes are let go as the row
 * settles, so the batch holds one decoded input at a time.
 */
export interface SettingsBatchRow {
  name: string;
  blob: Blob;
  inputBytes: number;
  signatureCount: number;
  detail: string;
}

/**
 * Said when the browser runs out of memory on a file: the files after it
 * would fail the same way, so the batch stops there and keeps every
 * finished row (`haltOn`).
 */
export const BATCH_OUT_OF_MEMORY =
  "This browser ran out of memory on that file, so the batch stopped there. The finished files are kept; close other tabs, or run the rest in a smaller batch.";

export function batchHalt(error: unknown): string | null {
  return error instanceof RangeError ? BATCH_OUT_OF_MEMORY : null;
}

export interface SettingsBatchRunnerProps {
  files: File[];
  onReset: () => void;
  /** A Remove left one file: it goes back to the tool's single-file panel. */
  onSingle?: (file: File) => void;
  /** Set when the files were handed over from another page. */
  arrival?: Arrival | null;
  /** The tool's name, as its page names it ("Rotate PDF"). */
  toolName: string;
  /** The Run button's verb: "Rotate" gives "Rotate 3 PDFs". */
  verb: string;
  /** A running row: "Rotating…". */
  runningLabel: string;
  /** The archive "Download all" saves (`SETTINGS_BATCH_TOOLS`). */
  zipName: string;
  /** The tool's own settings, shown above the list before Run. */
  settings?: ReactNode;
  /** Why Run cannot be pressed yet, or null when it can. */
  runBlocked?: string | null;
  /** One more sentence for the banner ("Numbering restarts in each file."). */
  appliesNote?: string;
  /** Said after the lock note on a restricted file, when the tool has more. */
  restrictedNote?: string;
  /** One file's work, on its bytes. */
  process: (opened: OpenedPdf, signal: AbortSignal) => Promise<BatchFileOutput>;
}

const pdfs = (n: number) => `${n} PDF${n === 1 ? "" : "s"}`;

/** A finished row's line: what came of it, and a signed file's warning. */
function describeRow(row: SettingsBatchRow): ReactNode {
  const size = `${row.detail} · ${formatBytes(row.blob.size)}`;
  if (row.signatureCount === 0) return size;
  return (
    <>
      {size} ·{" "}
      <span className="text-warn">
        {row.signatureCount} digital signature
        {row.signatureCount === 1 ? "" : "s"} will show as invalid
      </span>
    </>
  );
}

const rowOutputs = (row: SettingsBatchRow) => [
  { name: row.name, blob: row.blob, signatureCount: row.signatureCount },
];

/**
 * The batch for a tool with one setting for every file (batch plan P1):
 * Rotate, Flatten, Add Page Numbers, Add Watermark, Split Pages in Half. The
 * files are read one at a time, in this browser, through the tool's own
 * engine; nothing is uploaded. Every file the batch cannot take — not a PDF,
 * past the count or the total — is listed with its reason, never dropped.
 *
 * A file is read as the single-file panel reads it (`openForBatch`), and an
 * encrypted one fails its own row in that panel's words (`explainLocked`): a
 * batch never opens a file that needs a password, and never lifts an
 * author's restrictions.
 */
export function SettingsBatchRunner({
  files,
  onReset,
  onSingle,
  arrival = null,
  toolName,
  verb,
  runningLabel,
  zipName,
  settings,
  runBlocked = null,
  appliesNote,
  restrictedNote,
  process,
}: SettingsBatchRunnerProps) {
  const { accepted, rejected } = useMemo(() => {
    const pdfOnly = partitionPdfFiles(files);
    const capped = capBatchFiles(pdfOnly.accepted);
    return {
      accepted: capped.accepted,
      rejected: [
        ...pdfOnly.rejected,
        ...capped.rejected,
      ] as BatchRejection<File>[],
    };
  }, [files]);
  const units = useMemo<BatchUnit[]>(
    () =>
      accepted.map((file, i) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${i}`,
        name: file.name,
        file,
      })),
    [accepted],
  );

  const run = useCallback(
    async (
      file: File,
      signal: AbortSignal,
    ): Promise<SettingsBatchRow | NotedResult<SettingsBatchRow>> => {
      const opened = await openForBatch(file);
      const out = await explainLocked(
        opened.bytes,
        () => process(opened, signal),
        restrictedNote,
      );
      const row: SettingsBatchRow = {
        name: out.name,
        blob: new Blob([out.bytes as BlobPart], { type: "application/pdf" }),
        inputBytes: opened.bytes.byteLength,
        signatureCount: opened.signatures,
        detail: out.detail,
      };
      return out.note ? withNote(row, out.note) : row;
    },
    [process, restrictedNote],
  );

  const runner = useBatchRunner<SettingsBatchRow>(units, run, {
    haltOn: batchHalt,
  });
  const count = runner.state.items.length;

  const banner = (
    <div className="bg-panel border-line rounded-panel flex items-start gap-2.5 border p-4">
      <Info className="text-accent mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="text-muted text-sm leading-relaxed">
        <span className="text-fg">{toolName}</span> works on each PDF in turn,
        in your browser, with the settings below — nothing is uploaded.
        {appliesNote ? ` ${appliesNote}` : ""} A digitally signed file is
        flagged, because any rewrite makes its signatures show as invalid.
      </p>
    </div>
  );

  return (
    <BatchView<SettingsBatchRow>
      runner={runner}
      arrivedCount={files.length}
      arrival={arrival}
      rejected={rejected}
      banner={banner}
      settings={
        settings ? (
          <fieldset className="flex flex-col gap-4">
            <legend className="text-muted mb-1 text-[11px] font-medium tracking-wide uppercase">
              Applied to all {pdfs(count)}
            </legend>
            {settings}
          </fieldset>
        ) : undefined
      }
      runBlocked={runBlocked}
      countLabel={pdfs}
      runLabel={(n) => `${verb} ${pdfs(n)}`}
      runningLabel={runningLabel}
      errorFallback={`Couldn’t ${verb.toLowerCase()} this file`}
      progressLabel={`${toolName} batch progress`}
      footnote="Files are processed one at a time, on your device."
      outputs={rowOutputs}
      describe={describeRow}
      // The saved file's own name ("Download invoice-rotated.pdf"): a word
      // like "flattened" would be false of a file that had no form.
      downloadLabel={(_item, row) => `Download ${row.name}`}
      doneSentence={(p) =>
        `Batch complete. ${p.done} done, ${p.error} failed${p.skipped > 0 ? `, ${p.skipped} skipped` : ""}.`
      }
      inputBytes={(row) => row.inputBytes}
      zipName={zipName}
      zipFallback="If it keeps failing, download the files one at a time above."
      onReset={onReset}
      {...(onSingle
        ? {
            onOneLeft: (id: string) => {
              const unit = units.find((u) => u.id === id);
              if (unit) onSingle(unit.file);
            },
          }
        : {})}
    />
  );
}
