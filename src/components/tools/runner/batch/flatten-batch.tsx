"use client";

import { useCallback, useState } from "react";
import { SETTINGS_BATCH_TOOLS } from "@/lib/batch/tools";
import {
  flattenDownloadName,
  flattenPdf,
  type FlattenOptions,
} from "@/lib/pdf/flatten";
import type { SinglePdfBatch } from "../single-pdf-runner";
import { CheckboxField } from "../stamp-controls";
import { FLATTEN_MARKUP_HINT, markupCount } from "../flatten-markup-copy";
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
 * (`flattenDownloadName`: "-flattened" only when something was flattened). A
 * dynamic XFA form is refused by the engine, in its words, on its row.
 */
export async function flattenOneFile(
  { file, bytes }: OpenedPdf,
  options: FlattenOptions = {},
): Promise<BatchFileOutput> {
  const result = await flattenPdf(bytes, options);
  const plural = (n: number) => (n === 1 ? "" : "s");
  const left = result.skipped.length + result.annotationsLeft.length;
  const markup =
    result.flattenedAnnotations > 0
      ? ` · ${markupCount(result.flattenedAnnotations)}`
      : "";
  const nothing = !result.hadForm && result.flattenedAnnotations === 0;
  return {
    name: flattenDownloadName(file.name, result),
    bytes: result.bytes,
    detail: nothing
      ? "Re-saved"
      : !result.hadForm
        ? `${markupCount(result.flattenedAnnotations)} flattened`
        : result.flattenedFields === result.totalFields
          ? `${result.flattenedFields} form field${plural(result.flattenedFields)} flattened${markup}`
          : `Flattened ${result.flattenedFields} of ${result.totalFields} form field${plural(result.totalFields)}${markup}`,
    ...(nothing
      ? { note: FLATTEN_BATCH_NO_FORM }
      : left > 0
        ? {
            note: `${left} item${plural(left)} left as-is: open it on its own for the list`,
          }
        : {}),
  };
}

/** Flatten PDF's batch: one choice, comments and markup or fields only. */
export function FlattenBatch(props: SinglePdfBatch) {
  const [markup, setMarkup] = useState(false);
  const process = useCallback(
    (opened: OpenedPdf) => flattenOneFile(opened, { annotations: markup }),
    [markup],
  );
  return (
    <SettingsBatchRunner
      {...props}
      toolName="Flatten PDF"
      verb="Flatten"
      runningLabel="Flattening…"
      zipName={SETTINGS_BATCH_TOOLS["flatten-pdf"].zipName}
      appliesNote={
        markup
          ? "Each file's fillable form fields, comments and markup are drawn into its pages; links, layers and signature fields stay as they are."
          : "Each file's fillable form fields are drawn into its pages; comments, layers and signature fields stay as they are."
      }
      process={process}
      settings={
        <CheckboxField
          label="Also flatten comments and markup"
          checked={markup}
          onChange={setMarkup}
          hint={FLATTEN_MARKUP_HINT}
        />
      }
    />
  );
}
