"use client";

import { useCallback, useState } from "react";
import { SETTINGS_BATCH_TOOLS } from "@/lib/batch/tools";
import {
  SPLIT_DIRECTIONS,
  SPLIT_ORDER_CHOICES,
  splitHalfOutputName,
  splitPagesInHalf,
  type SplitHalfOptions,
} from "@/lib/pdf/split-half";
import type { SinglePdfBatch } from "../single-pdf-runner";
import { CheckboxField, SegmentedControl } from "../stamp-controls";
import {
  SettingsBatchRunner,
  type BatchFileOutput,
} from "./settings-batch-runner";
import type { OpenedPdf } from "./open-for-batch";

/** The options every file is split with: every page, no page list. */
export type SplitHalfBatchOptions = Omit<SplitHalfOptions, "pages">;

/** Split every page of one file, but any cover kept whole. */
export async function splitOneFile(
  { file, bytes }: OpenedPdf,
  options: SplitHalfBatchOptions,
): Promise<BatchFileOutput> {
  const result = await splitPagesInHalf(bytes, options);
  const all = result.splitPages === result.sourcePages;
  return {
    name: splitHalfOutputName(file.name),
    bytes: result.bytes,
    detail: `${all ? "All" : `${result.splitPages} of`} ${result.sourcePages} page${result.sourcePages === 1 ? "" : "s"} split · ${result.pageCount} pages`,
  };
}

/** Split PDF Pages in Half's batch: one cut and order for every file. */
export function SplitHalfBatch(props: SinglePdfBatch) {
  const [direction, setDirection] =
    useState<SplitHalfOptions["direction"]>("left-right");
  const [order, setOrder] = useState<SplitHalfOptions["order"]>("left-first");
  const [keepFirstWhole, setKeepFirstWhole] = useState(false);
  const [keepLastWhole, setKeepLastWhole] = useState(false);
  const process = useCallback(
    (opened: OpenedPdf) =>
      splitOneFile(opened, { direction, order, keepFirstWhole, keepLastWhole }),
    [direction, order, keepFirstWhole, keepLastWhole],
  );
  return (
    <SettingsBatchRunner
      {...props}
      toolName="Split PDF Pages in Half"
      verb="Split"
      runningLabel="Splitting…"
      zipName={SETTINGS_BATCH_TOOLS["split-pdf-pages-in-half"].zipName}
      appliesNote="Every page of each file is split; to split only some pages, open one file on its own."
      process={process}
      settings={
        <>
          <SegmentedControl
            label="Direction"
            value={direction}
            onChange={setDirection}
            options={SPLIT_DIRECTIONS.map((d) => ({
              value: d.id,
              label: d.label,
            }))}
          />
          <SegmentedControl
            label="Page order"
            value={order}
            onChange={setOrder}
            options={SPLIT_ORDER_CHOICES[direction].map((o) => ({
              value: o.id,
              label: o.label,
            }))}
          />
          <div className="flex flex-col gap-3">
            <CheckboxField
              label="Keep the first page whole"
              checked={keepFirstWhole}
              onChange={setKeepFirstWhole}
              hint="In each file, for a front cover scanned on its own."
            />
            <CheckboxField
              label="Keep the last page whole"
              checked={keepLastWhole}
              onChange={setKeepLastWhole}
              hint="In each file, for a back cover scanned on its own."
            />
          </div>
        </>
      }
    />
  );
}
