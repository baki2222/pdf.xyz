"use client";

import { useCallback, useState } from "react";
import { SETTINGS_BATCH_TOOLS } from "@/lib/batch/tools";
import {
  cropPdf,
  croppedOutputName,
  getPageSizes,
  MIN_CROP_DIMENSION,
} from "@/lib/pdf/crop";
import type { SinglePdfBatch } from "../single-pdf-runner";
import { NumberField } from "../stamp-controls";
import {
  SettingsBatchRunner,
  type BatchFileOutput,
} from "./settings-batch-runner";
import type { OpenedPdf } from "./open-for-batch";

/** The margin the batch starts at: the single-file editor's own. */
export const CROP_BATCH_START = 24;
/** The most a batch margin can be: a 200-inch page, halved. */
const CROP_BATCH_MAX = 7200;

/**
 * Crop every page of one file by the same margin on every edge, as the
 * single-file editor's Uniform mode does. A file with a page too small for
 * it fails on its own row, in the engine's own words, uncropped.
 */
export async function cropOneFile(
  { file, bytes }: OpenedPdf,
  margin: number,
): Promise<BatchFileOutput> {
  const out = await cropPdf(bytes, {
    margins: { top: margin, right: margin, bottom: margin, left: margin },
  });
  const n = (await getPageSizes(out)).length;
  return {
    name: croppedOutputName(file.name),
    bytes: out,
    detail: `${n} page${n === 1 ? "" : "s"} cropped`,
  };
}

/** Crop PDF's batch: one margin on every edge of every page of every file. */
export function CropBatch(props: SinglePdfBatch) {
  const [margin, setMargin] = useState(CROP_BATCH_START);
  const process = useCallback(
    (opened: OpenedPdf) => cropOneFile(opened, margin),
    [margin],
  );
  return (
    <SettingsBatchRunner
      {...props}
      toolName="Crop PDF"
      verb="Crop"
      runningLabel="Cropping…"
      zipName={SETTINGS_BATCH_TOOLS["crop-pdf"].zipName}
      appliesNote={`Every page of every file loses the same margin on each edge. A file with a page that would be left smaller than ${MIN_CROP_DIMENSION} points fails on its own row; to set each side or each page, open one file on its own.`}
      runBlocked={margin > 0 ? null : "Set a margin above 0 first."}
      process={process}
      settings={
        <div className="max-w-52">
          <NumberField
            label="Margin on every side (pt)"
            value={margin}
            min={0}
            max={CROP_BATCH_MAX}
            onChange={setMargin}
          />
        </div>
      }
    />
  );
}
