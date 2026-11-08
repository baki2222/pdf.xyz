"use client";

import { useCallback, useMemo } from "react";
import { Info } from "lucide-react";
import { withNote, type NotedResult } from "@/lib/batch";
import {
  BATCH_LIMITS,
  capBatchFiles,
  type BatchRejection,
} from "@/lib/batch/limits";
import { batchMaxFilesFor, TEXT_BATCH_TOOLS } from "@/lib/batch/tools";
import { textPdfOutputName, textToPdf } from "@/lib/pdf/text-to-pdf";
import { decodeTextFile, describeDecoding } from "@/lib/text/decode-text-file";
import { MAX_SOURCE_BYTES, MAX_SOURCE_MB } from "@/lib/tools/limits";
import { formatBytes } from "@/lib/utils";
import type { Arrival } from "../handoff-notice";
import { isLikelyTextFile } from "../text-to-pdf-runner";
import { useBatchRunner, type BatchUnit } from "../use-batch-runner";
import { BatchView } from "./batch-view";
import { batchHalt } from "./halt";

/** What Text to PDF's batch is handed when two or more text files arrive. */
export interface TextBatchProps {
  files: File[];
  onReset: () => void;
  /** A Remove left one file: it opens in the editor, as a pick would. */
  onSingle: (file: File) => void;
  arrival: Arrival | null;
}

/** A finished row: its PDF as a Blob, and the facts its line reads. */
export interface TextBatchRow {
  name: string;
  blob: Blob;
  inputBytes: number;
  characters: number;
}

/**
 * The files Text to PDF's batch does not take, each with the editor's own
 * sentence for it: not plain text, or past the size it converts.
 */
export function partitionTextFiles(files: readonly File[]): {
  accepted: File[];
  rejected: BatchRejection<File>[];
} {
  const accepted: File[] = [];
  const rejected: BatchRejection<File>[] = [];
  for (const file of files) {
    if (!isLikelyTextFile(file))
      rejected.push({
        file,
        reason: "It isn't a plain text file — choose a .txt file.",
      });
    else if (file.size > MAX_SOURCE_BYTES)
      rejected.push({
        file,
        reason: `It is too large for in-browser conversion (max ${MAX_SOURCE_MB} MB).`,
      });
    else accepted.push(file);
  }
  return { accepted, rejected };
}

const files_ = (n: number) => `${n} text file${n === 1 ? "" : "s"}`;
const rowOutputs = (row: TextBatchRow) => [{ name: row.name, blob: row.blob }];

/**
 * Text to PDF's batch (batch plan P2): each text file becomes its own PDF,
 * in turn, in this browser, with nothing uploaded — read as the editor
 * reads a picked file (`decodeTextFile`, form feeds kept, a note when the
 * encoding was a guess) and laid out by the same `textToPdf`. Files that
 * are not plain text, or past the size the editor converts, are listed with
 * the editor's reason; past the batch's count or total, with the cap's.
 * To make ONE PDF of several texts, the result goes on to Merge PDF.
 */
export function TextToPdfBatch({
  files,
  onReset,
  onSingle,
  arrival,
}: TextBatchProps) {
  const { accepted, rejected } = useMemo(() => {
    const text = partitionTextFiles(files);
    const capped = capBatchFiles(text.accepted, {
      maxFiles: batchMaxFilesFor("text-to-pdf"),
      maxTotalBytes: BATCH_LIMITS.clientMaxTotalBytes,
    });
    return {
      accepted: capped.accepted,
      rejected: [...text.rejected, ...capped.rejected],
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
    async (file: File): Promise<TextBatchRow | NotedResult<TextBatchRow>> => {
      const decoded = await decodeTextFile(file, { keepFormFeeds: true });
      const name = file.name || "text.txt";
      const bytes = await textToPdf(decoded.text, {
        title: name.replace(/\.[^/.]+$/, ""),
      });
      const row: TextBatchRow = {
        name: textPdfOutputName(name),
        blob: new Blob([bytes as BlobPart], { type: "application/pdf" }),
        inputBytes: file.size,
        characters: decoded.text.length,
      };
      const note = describeDecoding(decoded);
      return note ? withNote(row, note) : row;
    },
    [],
  );

  const runner = useBatchRunner<TextBatchRow>(units, run, {
    haltOn: batchHalt,
  });

  return (
    <BatchView<TextBatchRow>
      runner={runner}
      arrivedCount={files.length}
      arrival={arrival}
      rejected={rejected}
      banner={
        <div className="bg-panel border-line rounded-panel flex items-start gap-2.5 border p-4">
          <Info className="text-accent mt-0.5 size-4 shrink-0" aria-hidden />
          <p className="text-muted text-sm leading-relaxed">
            <span className="text-fg">Text to PDF</span> turns each text file
            into its own PDF, in turn, in your browser — nothing is uploaded. To
            make one PDF of them, take the PDFs on to Merge PDF.
          </p>
        </div>
      }
      countLabel={files_}
      runLabel={(n) => `Convert ${files_(n)}`}
      runningLabel="Creating PDF…"
      errorFallback="Couldn’t convert this file"
      progressLabel="Text to PDF batch progress"
      footnote="Files are processed one at a time, on your device."
      outputs={rowOutputs}
      describe={(row) =>
        `${row.characters.toLocaleString()} characters · ${formatBytes(row.blob.size)}`
      }
      downloadLabel={(_item, row) => `Download ${row.name}`}
      doneSentence={(p) =>
        `Batch complete. ${p.done} done, ${p.error} failed${p.skipped > 0 ? `, ${p.skipped} skipped` : ""}.`
      }
      inputBytes={(row) => row.inputBytes}
      zipName={TEXT_BATCH_TOOLS["text-to-pdf"].zipName}
      zipFallback="If it keeps failing, download the files one at a time above."
      onReset={onReset}
      onOneLeft={(id) => {
        const unit = units.find((u) => u.id === id);
        if (unit) onSingle(unit.file);
      }}
    />
  );
}
