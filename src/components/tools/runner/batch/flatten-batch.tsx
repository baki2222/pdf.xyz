"use client";

import { SETTINGS_BATCH_TOOLS } from "@/lib/batch/tools";
import { flattenDownloadName, flattenPdf } from "@/lib/pdf/flatten";
import type { SinglePdfBatch } from "../single-pdf-runner";
import {
  SettingsBatchRunner,
  type BatchFileOutput,
} from "./settings-batch-runner";
import type { OpenedPdf } from "./open-for-batch";

/** A file with no form, said on its row: it was re-saved, nothing flattened. */
export const FLATTEN_BATCH_NO_FORM =
  "No fillable form fields, so nothing was flattened; saved as -resaved";

/**
 * Flatten one file: the single-file panel's own engine and download name
 * (`flattenDownloadName`: "-flattened" only when a field was flattened). A
 * dynamic XFA form is refused by the engine, in its words, on its row.
 */
export async function flattenOneFile({
  file,
  bytes,
}: OpenedPdf): Promise<BatchFileOutput> {
  const result = await flattenPdf(bytes);
  const plural = (n: number) => (n === 1 ? "" : "s");
  const left = result.skipped.length;
  return {
    name: flattenDownloadName(file.name, result),
    bytes: result.bytes,
    detail: !result.hadForm
      ? "Re-saved"
      : result.flattenedFields === result.totalFields
        ? `${result.flattenedFields} form field${plural(result.flattenedFields)} flattened`
        : `Flattened ${result.flattenedFields} of ${result.totalFields} form field${plural(result.totalFields)}`,
    ...(!result.hadForm
      ? { note: FLATTEN_BATCH_NO_FORM }
      : left > 0
        ? {
            note: `${left} field${plural(left)} left as-is, still interactive: open it on its own for the list`,
          }
        : {}),
  };
}

const process = (opened: OpenedPdf) => flattenOneFile(opened);

/** Flatten PDF's batch: no settings; each file's form is flattened in turn. */
export function FlattenBatch(props: SinglePdfBatch) {
  return (
    <SettingsBatchRunner
      {...props}
      toolName="Flatten PDF"
      verb="Flatten"
      runningLabel="Flattening…"
      zipName={SETTINGS_BATCH_TOOLS["flatten-pdf"].zipName}
      appliesNote="Each file's fillable form fields are drawn into its pages; comments, layers and signature fields stay as they are."
      process={process}
    />
  );
}
