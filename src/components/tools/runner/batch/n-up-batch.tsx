"use client";

import { useCallback, useState } from "react";
import { SETTINGS_BATCH_TOOLS } from "@/lib/batch/tools";
import {
  DEFAULT_N_UP_OPTIONS,
  N_UP_COUNTS,
  N_UP_SHEETS,
  nUpOutputName,
  nUpPdf,
  type NUpCount,
  type NUpSheetId,
} from "@/lib/pdf/n-up";
import { regionalChoice, useRegionalPaper } from "../../use-regional-paper";
import type { SinglePdfBatch } from "../single-pdf-runner";
import { BatchChoice } from "./batch-choice";
import {
  SettingsBatchRunner,
  type BatchFileOutput,
} from "./settings-batch-runner";
import type { OpenedPdf } from "./open-for-batch";

/** The options every file of a batch is laid out with. */
export interface NUpBatchOptions {
  perSheet: NUpCount;
  sheet: NUpSheetId;
}

/**
 * Lay out one file's pages on sheets, through the single-file engine: the
 * count and sheet chosen, every other option the editor's default.
 */
export async function nUpOneFile(
  { file, bytes }: OpenedPdf,
  options: NUpBatchOptions,
): Promise<BatchFileOutput> {
  const result = await nUpPdf(bytes, { ...DEFAULT_N_UP_OPTIONS, ...options });
  return {
    name: nUpOutputName(file.name, options.perSheet),
    bytes: result.bytes,
    detail: `${result.sourcePages} page${result.sourcePages === 1 ? "" : "s"} on ${result.sheets} sheet${result.sheets === 1 ? "" : "s"}`,
  };
}

const COUNT_CHOICES = N_UP_COUNTS.map((count) => ({
  value: String(count),
  label: `${count} per sheet`,
}));

/** Multiple Pages per Sheet's batch: one count and sheet for every file. */
export function NUpBatch(props: SinglePdfBatch) {
  const [perSheet, setPerSheet] = useState<string>(
    String(DEFAULT_N_UP_OPTIONS.perSheet),
  );
  // A4, or US Letter where the browser's language names a Letter country,
  // as the single-file editor starts (regional-paper.test.ts).
  const regional = useRegionalPaper();
  const [chosenSheet, setSheet] = useState<NUpSheetId | null>(null);
  const sheet = chosenSheet ?? regionalChoice(N_UP_SHEETS, regional);
  const process = useCallback(
    (opened: OpenedPdf) =>
      nUpOneFile(opened, { perSheet: Number(perSheet) as NUpCount, sheet }),
    [perSheet, sheet],
  );
  return (
    <SettingsBatchRunner
      {...props}
      toolName="Multiple Pages per Sheet"
      verb="Lay out"
      runningLabel="Laying out…"
      zipName={SETTINGS_BATCH_TOOLS["n-up-pdf"].zipName}
      appliesNote="Every file is laid out with the count and sheet you choose; orientation is Auto, pages run across then down, with a small margin and no borders. For other options, open one file on its own."
      process={process}
      settings={
        <>
          <BatchChoice
            label="Pages per sheet"
            value={perSheet}
            onChange={setPerSheet}
            options={COUNT_CHOICES}
          />
          <BatchChoice
            label="Sheet size"
            value={sheet}
            onChange={setSheet}
            options={N_UP_SHEETS.map((s) => ({ value: s.id, label: s.label }))}
          />
        </>
      }
    />
  );
}
