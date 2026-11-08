"use client";

import { useCallback, useState } from "react";
import { BatchSkip } from "@/lib/batch";
import {
  PAGE_NUMBER_BATCH_RESTARTS,
  SETTINGS_BATCH_TOOLS,
} from "@/lib/batch/tools";
import { OPTION_SCHEMAS } from "@/lib/intent/option-memory";
import { getPageRotations } from "@/lib/pdf/engine";
import {
  addPageNumbers,
  DEFAULT_PAGE_NUMBER_FORMAT,
  numberedOutputName,
  numberingPlan,
  type PageNumberOptions,
} from "@/lib/pdf/page-numbers";
import type { StampPosition } from "@/lib/pdf/stamp";
import type { SinglePdfBatch } from "../single-pdf-runner";
import {
  CheckboxField,
  NumberField,
  PositionPicker,
  SegmentedControl,
} from "../stamp-controls";
import {
  SettingsBatchRunner,
  type BatchFileOutput,
} from "./settings-batch-runner";
import type { OpenedPdf } from "./open-for-batch";

/**
 * The batch's formats: the single-file editor's presets, the list option
 * memory keeps (`OPTION_SCHEMAS`), labelled as the editor labels them —
 * {n} as 1 and {total} as N ("Page 1 of N"). A typed template and the Bates
 * style stay in the single-file editor: a Bates run carries its numbers on
 * from one file to the next, and a batch restarts them in each file.
 */
export const PAGE_NUMBER_BATCH_FORMATS = OPTION_SCHEMAS[
  "page-numbers"
].format.values.map((value) => ({
  value,
  label: value.replace("{n}", "1").replace("{total}", "N"),
}));

/** What a file whose settings number none of its pages is told. */
export const PAGE_NUMBER_BATCH_NONE =
  "No page gets a number with these settings";

/**
 * The options every file of a batch is numbered with. Font size, margin,
 * font and colour are left to the engine's defaults, which are the
 * single-file editor's starting values (`settings-batch-behaviour.dom.test.tsx`
 * draws a number both ways and compares where it lands).
 */
export type PageNumberBatchOptions = Required<
  Pick<
    PageNumberOptions,
    "format" | "position" | "startAt" | "skipCover" | "facing"
  >
>;

/** Number one file, from its own first page; the count restarts per file. */
export async function numberOneFile(
  { file, bytes }: OpenedPdf,
  options: PageNumberBatchOptions,
): Promise<BatchFileOutput> {
  const pageCount = (await getPageRotations(bytes)).length;
  const numbered = numberingPlan(pageCount, options).stamps.length;
  if (numbered === 0) throw new BatchSkip(PAGE_NUMBER_BATCH_NONE);
  return {
    name: numberedOutputName(file.name),
    bytes: await addPageNumbers(bytes, options),
    detail: `${numbered} page${numbered === 1 ? "" : "s"} numbered`,
  };
}

/** Add Page Numbers' batch: one format and position for every file. */
export function PageNumbersBatch(props: SinglePdfBatch) {
  const [format, setFormat] = useState<string>(DEFAULT_PAGE_NUMBER_FORMAT);
  const [position, setPosition] = useState<StampPosition>("bottom-center");
  const [startAt, setStartAt] = useState(1);
  const [skipCover, setSkipCover] = useState(false);
  const [facing, setFacing] = useState(false);
  const process = useCallback(
    (opened: OpenedPdf) =>
      numberOneFile(opened, { format, position, startAt, skipCover, facing }),
    [format, position, startAt, skipCover, facing],
  );
  return (
    <SettingsBatchRunner
      {...props}
      toolName="Add Page Numbers"
      verb="Number"
      runningLabel="Numbering…"
      zipName={SETTINGS_BATCH_TOOLS["page-numbers"].zipName}
      appliesNote={PAGE_NUMBER_BATCH_RESTARTS}
      process={process}
      settings={
        <>
          <SegmentedControl
            label="Number format preset"
            value={format}
            onChange={setFormat}
            options={PAGE_NUMBER_BATCH_FORMATS}
          />
          <div className="flex flex-wrap items-start gap-6">
            <PositionPicker value={position} onChange={setPosition} />
            <div className="flex min-w-52 flex-1 flex-col gap-3">
              <div className="max-w-52">
                <NumberField
                  label="First number"
                  value={startAt}
                  min={0}
                  max={99999}
                  onChange={setStartAt}
                />
              </div>
              <CheckboxField
                label="Leave the cover unnumbered"
                checked={skipCover}
                onChange={setSkipCover}
                hint="Each file's page 1 is counted but gets no number."
              />
              <CheckboxField
                label="Facing pages"
                checked={facing}
                onChange={setFacing}
                hint="Swaps left and right on even pages, for printing as a book."
              />
            </div>
          </div>
        </>
      }
    />
  );
}
