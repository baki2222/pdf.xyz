"use client";

import { useCallback, useState } from "react";
import { SETTINGS_BATCH_TOOLS } from "@/lib/batch/tools";
import {
  RESIZE_MODES,
  RESIZE_ORIENTATIONS,
  RESIZE_SIZES,
  resizeOutputName,
  resizePdf,
  type ResizeMode,
  type ResizeOrientation,
} from "@/lib/pdf/resize";
import { regionalChoice, useRegionalPaper } from "../../use-regional-paper";
import type { SinglePdfBatch } from "../single-pdf-runner";
import { SegmentedControl } from "../stamp-controls";
import { BatchChoice } from "./batch-choice";
import {
  SettingsBatchRunner,
  type BatchFileOutput,
} from "./settings-batch-runner";
import type { OpenedPdf } from "./open-for-batch";

type SizeId = (typeof RESIZE_SIZES)[number]["id"];

/** The options every file of a batch is resized with: a named size. */
export interface ResizeBatchOptions {
  size: SizeId;
  orientation: ResizeOrientation;
  mode: ResizeMode;
}

/** Resize every page of one file, through the single-file engine. */
export async function resizeOneFile(
  { file, bytes }: OpenedPdf,
  options: ResizeBatchOptions,
): Promise<BatchFileOutput> {
  const size = RESIZE_SIZES.find((s) => s.id === options.size)!.size;
  const result = await resizePdf(bytes, {
    width: size.width,
    height: size.height,
    orientation: options.orientation,
    mode: options.mode,
  });
  const n = result.resizedPages;
  return {
    name: resizeOutputName(file.name),
    bytes: result.bytes,
    detail: `${n} page${n === 1 ? "" : "s"} resized`,
  };
}

/** Resize PDF's batch: one size, orientation and mode for every file. */
export function ResizeBatch(props: SinglePdfBatch) {
  // A4, or US Letter where the browser's language names a Letter country,
  // as the single-file editor starts (regional-paper.test.ts).
  const regional = useRegionalPaper();
  const [chosenSize, setSize] = useState<SizeId | null>(null);
  const size = chosenSize ?? regionalChoice(RESIZE_SIZES, regional);
  const [orientation, setOrientation] = useState<ResizeOrientation>("match");
  const [mode, setMode] = useState<ResizeMode>("fit");
  const process = useCallback(
    (opened: OpenedPdf) => resizeOneFile(opened, { size, orientation, mode }),
    [size, orientation, mode],
  );
  return (
    <SettingsBatchRunner
      {...props}
      toolName="Resize PDF"
      verb="Resize"
      runningLabel="Resizing…"
      zipName={SETTINGS_BATCH_TOOLS["resize-pdf"].zipName}
      appliesNote="Every page of every file takes the size you choose; for a custom size or only some pages, open one file on its own."
      process={process}
      settings={
        <>
          <BatchChoice
            label="Page size"
            value={size}
            onChange={setSize}
            options={RESIZE_SIZES.map((s) => ({ value: s.id, label: s.label }))}
          />
          <SegmentedControl
            label="Orientation"
            value={orientation}
            onChange={setOrientation}
            options={RESIZE_ORIENTATIONS.map((o) => ({
              value: o.id,
              label: o.label,
            }))}
          />
          <SegmentedControl
            label="Content"
            value={mode}
            onChange={setMode}
            options={RESIZE_MODES.map((m) => ({ value: m.id, label: m.label }))}
          />
        </>
      }
    />
  );
}
