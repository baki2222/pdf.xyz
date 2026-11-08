"use client";

import { useCallback, useMemo, type ReactNode } from "react";
import { Info } from "lucide-react";
import { withNote, type BatchItem, type NotedResult } from "@/lib/batch";
import {
  BATCH_LIMITS,
  capBatchFiles,
  type BatchRejection,
} from "@/lib/batch/limits";
import { IMAGE_BATCH_FOLDERS } from "@/lib/batch/tools";
import { classifyPdfAccess, LOCKED_PDF_COPY } from "@/lib/pdf/encryption";
import { PdfEngineError } from "@/lib/pdf/engine";
import { partitionPdfFiles } from "@/lib/pdf/files";
import { formatBytes } from "@/lib/utils";
import type { Arrival } from "../handoff-notice";
import { useBatchRunner, type BatchUnit } from "../use-batch-runner";
import { BatchView } from "./batch-view";
import { openForBatch, type OpenedPdf } from "./open-for-batch";
import { batchHalt } from "./halt";

/** One image a tool made of a file. */
export interface BatchImage {
  name: string;
  bytes: Uint8Array;
  /** Its media type: "image/jpeg", "image/png". */
  type: string;
}

/** What an images tool hands back for one file. */
export interface ImagesFileOutput {
  /** Every image it made, in order. None is a finished file, not a failure. */
  images: BatchImage[];
  /** The ZIP the row's own download saves: the single-file panel's name. */
  zipName: string;
  /** The row's detail line once it is done ("12 pages · Print"). */
  detail: string;
  /** A sentence that is not a failure ("No images found in this PDF"). */
  note?: string;
}

/**
 * A finished row: its images as Blobs (made the moment the file finishes,
 * so the encoded bytes are let go before the next file starts), the folder
 * they go in, and the facts its line and the receipt read.
 */
export interface ImagesBatchRow {
  folder: string;
  zipName: string;
  files: { name: string; blob: Blob }[];
  inputBytes: number;
  detail: string;
}

export interface ImagesBatchRunnerProps {
  files: File[];
  onReset: () => void;
  onSingle?: (file: File) => void;
  arrival?: Arrival | null;
  /** The tool's name, as its page names it ("PDF to JPG"). */
  toolName: string;
  /** The Run button's verb: "Convert" gives "Convert 3 PDFs". */
  verb: string;
  runningLabel: string;
  /** The archive "Download all" saves (`IMAGE_BATCH_TOOLS`). */
  zipName: string;
  /** How many files one batch takes (`batchMaxFilesFor`). */
  maxFiles: number;
  /** The archive's compression (`BatchView`). */
  compression?: "STORE" | "DEFLATE";
  settings?: ReactNode;
  runBlocked?: string | null;
  /** One more sentence for the banner. */
  appliesNote?: string;
  /**
   * What a restricted file's row says, whole: a batch leaves it alone, and
   * where the single-file panel takes it instead.
   */
  restrictedRefusal: string;
  /** One file's work, on its bytes. */
  process: (
    opened: OpenedPdf,
    signal: AbortSignal,
  ) => Promise<ImagesFileOutput>;
}

const pdfs = (n: number) => `${n} PDF${n === 1 ? "" : "s"}`;

/** "report.pdf" → "report": the folder a file's images go in. */
export function imagesFolder(fileName: string): string {
  return fileName.replace(/\.pdf$/i, "") || "document";
}

function describeRow(row: ImagesBatchRow): ReactNode {
  const bytes = row.files.reduce((sum, f) => sum + f.blob.size, 0);
  return row.files.length > 0
    ? `${row.detail} · ${formatBytes(bytes)}`
    : row.detail;
}

const rowOutputs = (row: ImagesBatchRow) => row.files;
const rowBundle = (row: ImagesBatchRow) => ({
  folder: row.folder,
  zipName: row.zipName,
});
const rowDownloadLabel = (
  item: BatchItem<ImagesBatchRow>,
  row: ImagesBatchRow,
) =>
  row.files.length === 1
    ? `Download ${row.files[0]!.name}`
    : `Download the ${row.files.length} images of ${item.name} as a ZIP`;

/**
 * The batch for a tool that makes MANY images of each PDF (batch plan P2):
 * PDF to JPG, PDF to PNG, Extract Images. Each file is read in turn, in
 * this browser, through the tool's own engine; nothing is uploaded. In
 * "Download all"'s ZIP each file's images sit in a folder named after it,
 * two files of one name in two folders (`BatchView`'s `bundle`); a row's own
 * button saves its images as the single-file panel's ZIP.
 *
 * An encrypted file is refused BEFORE its engine runs, by what a reader
 * makes of it: pdf.js draws a restricted file without asking, and a batch
 * never lifts an author's restrictions nor opens a file that needs a
 * password. The single-file panel is where such a file is taken, and the
 * row says so (`restrictedRefusal`).
 *
 * Out of memory (a `RangeError`) stops the batch and keeps the finished rows
 * (`batchHalt`); the per-page pixel and DPI ceilings bind each page as they
 * do for one file on its own.
 */
export function ImagesBatchRunner({
  files,
  onReset,
  onSingle,
  arrival = null,
  toolName,
  verb,
  runningLabel,
  zipName,
  maxFiles,
  compression = "STORE",
  settings,
  runBlocked = null,
  appliesNote,
  restrictedRefusal,
  process,
}: ImagesBatchRunnerProps) {
  const { accepted, rejected } = useMemo(() => {
    const pdfOnly = partitionPdfFiles(files);
    const capped = capBatchFiles(pdfOnly.accepted, {
      maxFiles,
      maxTotalBytes: BATCH_LIMITS.clientMaxTotalBytes,
    });
    return {
      accepted: capped.accepted,
      rejected: [
        ...pdfOnly.rejected,
        ...capped.rejected,
      ] as BatchRejection<File>[],
    };
  }, [files, maxFiles]);
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
    ): Promise<ImagesBatchRow | NotedResult<ImagesBatchRow>> => {
      const opened = await openForBatch(file);
      const access = await classifyPdfAccess(opened.bytes);
      if (access.kind !== "unencrypted")
        throw new PdfEngineError(
          access.kind === "restricted"
            ? restrictedRefusal
            : LOCKED_PDF_COPY[access.kind],
          { kind: "encrypted" },
        );
      const out = await process(opened, signal);
      const row: ImagesBatchRow = {
        folder: imagesFolder(file.name),
        zipName: out.zipName,
        files: out.images.map((image) => ({
          name: image.name,
          blob: new Blob([image.bytes as BlobPart], { type: image.type }),
        })),
        inputBytes: opened.bytes.byteLength,
        detail: out.detail,
      };
      return out.note ? withNote(row, out.note) : row;
    },
    [process, restrictedRefusal],
  );

  const runner = useBatchRunner<ImagesBatchRow>(units, run, {
    haltOn: batchHalt,
  });
  const count = runner.state.items.length;

  const banner = (
    <div className="bg-panel border-line rounded-panel flex items-start gap-2.5 border p-4">
      <Info className="text-accent mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="text-muted text-sm leading-relaxed">
        <span className="text-fg">{toolName}</span> works on each PDF in turn,
        in your browser, with the settings below — nothing is uploaded.
        {appliesNote ? ` ${appliesNote}` : ""} {IMAGE_BATCH_FOLDERS}
      </p>
    </div>
  );

  return (
    <BatchView<ImagesBatchRow>
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
      downloadLabel={rowDownloadLabel}
      doneSentence={(p) =>
        `Batch complete. ${p.done} done, ${p.error} failed${p.skipped > 0 ? `, ${p.skipped} skipped` : ""}.`
      }
      inputBytes={(row) => row.inputBytes}
      zipName={zipName}
      zipFallback="If it keeps failing, download each file's images from its row above."
      compression={compression}
      bundle={rowBundle}
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
