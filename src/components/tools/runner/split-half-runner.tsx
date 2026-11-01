"use client";

import { useState } from "react";
import { Download, SquareSplitHorizontal } from "lucide-react";
import {
  SPLIT_DIRECTIONS,
  SPLIT_HALF_RUN_LABEL,
  SPLIT_ORDERS,
  splitHalfOutputName,
  splitPagesInHalf,
  type SplitDirection,
  type SplitHalfResult,
  type SplitOrder,
} from "@/lib/pdf/split-half";
import { SPLIT_HALF_KEEPS_CONTENT } from "@/lib/pdf/crop-disclosure";
import { parsePageList } from "@/lib/pdf/ranges";
import { downloadBytes } from "@/lib/pdf/browser";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatBytes } from "@/lib/utils";
import {
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  errorMessage,
  outputFile,
  useAsyncRun,
} from "./runner-kit";
import { RunBar } from "./run-bar";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import {
  CheckboxField,
  PrivacyLine,
  SegmentedControl,
  TextField,
} from "./stamp-controls";
import { CropDisclosure } from "./crop-disclosure";
import type { LoadedPdf } from "./use-single-pdf";

export function SplitHalfRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · pages split in half locally in your browser"
      handoffSlug="split-pdf-pages-in-half"
      toolName="Split PDF Pages in Half"
    >
      {(pdf, reset) => <SplitHalfEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

export function SplitHalfEditor({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  const [direction, setDirection] = useState<SplitDirection>("left-right");
  const [order, setOrder] = useState<SplitOrder>("left-first");
  const [scope, setScope] = useState<"all" | "range">("all");
  const [rangeInput, setRangeInput] = useState("");
  const [keepFirstWhole, setKeepFirstWhole] = useState(false);
  const [keepLastWhole, setKeepLastWhole] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { busy, error, result, run, reset } = useAsyncRun<SplitHalfResult>();

  const onRun = () => {
    let pages: number[] | undefined;
    if (scope === "range") {
      try {
        pages = parsePageList(rangeInput, pdf.pageCount);
      } catch (err) {
        setFormError(errorMessage(err));
        return;
      }
    }
    setFormError(null);
    void run(() =>
      splitPagesInHalf(pdf.bytes, {
        direction,
        order,
        pages,
        keepFirstWhole,
        keepLastWhole,
      }),
    );
  };

  if (result) {
    const name = splitHalfOutputName(pdf.file.name);
    const all = result.splitPages === result.sourcePages;
    return (
      <ResultPanel
        title="Pages split in half"
        summary={`${all ? "All" : `${result.splitPages} of`} ${result.sourcePages} page${result.sourcePages === 1 ? "" : "s"} split · ${result.pageCount} pages · ${formatBytes(result.bytes.byteLength)}`}
        onReset={onReset}
        output={outputFile(result.bytes, name)}
        onAdjust={reset}
        expectedPages={result.pageCount}
      >
        <div className="flex w-full flex-col gap-3">
          <button
            type="button"
            onClick={() => downloadBytes(result.bytes, name)}
            className={cn(
              buttonVariants({ variant: "primary", size: "lg" }),
              "self-start",
            )}
          >
            <Download className="size-4" aria-hidden />
            Download split PDF
          </button>
          <CropDisclosure sentence={SPLIT_HALF_KEEPS_CONTENT} />
        </div>
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection title="Direction">
        <div className="flex flex-col gap-2">
          <SegmentedControl
            label="Direction"
            value={direction}
            onChange={setDirection}
            options={SPLIT_DIRECTIONS.map((d) => ({
              value: d.id,
              label: d.label,
            }))}
          />
          <p className="text-muted text-xs">
            {SPLIT_DIRECTIONS.find((d) => d.id === direction)!.hint}
          </p>
        </div>
      </RunnerSection>

      {direction === "left-right" && (
        <RunnerSection title="Page order">
          <div className="flex flex-col gap-2">
            <SegmentedControl
              label="Page order"
              value={order}
              onChange={setOrder}
              options={SPLIT_ORDERS.map((o) => ({
                value: o.id,
                label: o.label,
              }))}
            />
            <p className="text-muted text-xs">
              Right page first suits books read right to left.
            </p>
          </div>
        </RunnerSection>
      )}

      <RunnerSection title="Pages">
        <div className="flex flex-col gap-4">
          <SegmentedControl
            label="Page scope"
            value={scope}
            onChange={setScope}
            options={[
              { value: "all", label: "All pages" },
              { value: "range", label: "Selected pages" },
            ]}
          />
          {scope === "range" && (
            <TextField
              label="Pages"
              value={rangeInput}
              onChange={(value) => {
                setRangeInput(value);
                setFormError(null);
              }}
              placeholder="e.g. 2-9"
            />
          )}
          <div className="flex flex-col gap-3">
            <CheckboxField
              label="Keep the first page whole"
              checked={keepFirstWhole}
              onChange={setKeepFirstWhole}
              hint="For a front cover scanned on its own."
            />
            <CheckboxField
              label="Keep the last page whole"
              checked={keepLastWhole}
              onChange={setKeepLastWhole}
              hint="For a back cover scanned on its own."
            />
          </div>
        </div>
      </RunnerSection>

      <PrivacyLine>
        Pages are split on your device — the PDF never leaves your browser.
      </PrivacyLine>

      {formError && <ErrorNote message={formError} />}
      {error && <ErrorNote message={error} />}

      <RunBar>
        <div className="flex justify-end">
          <RunButton onClick={onRun} busy={busy} busyLabel="Splitting…">
            <SquareSplitHorizontal className="size-4" aria-hidden />
            {SPLIT_HALF_RUN_LABEL}
          </RunButton>
        </div>
      </RunBar>
    </div>
  );
}
