"use client";

import { useMemo, useState } from "react";
import { Download, ListOrdered } from "lucide-react";
import {
  addPageNumbers,
  DEFAULT_PAGE_NUMBER_FORMAT,
  numberedOutputName,
  previewPageNumber,
} from "@/lib/pdf/page-numbers";
import type { StampPosition } from "@/lib/pdf/stamp";
import { downloadBytes } from "@/lib/pdf/browser";
import { buttonVariants } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import {
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  useAsyncRun,
} from "./runner-kit";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import {
  NumberField,
  PositionPicker,
  PrivacyLine,
  RangeField,
  SegmentedControl,
  TextField,
} from "./stamp-controls";
import type { LoadedPdf } from "./use-single-pdf";

/**
 * The offered presets. Exported so the tool page's stated facts can be pinned
 * to them: the facts entry claimed "Three numbering formats" while this list
 * held four and a free-form field sat beside it, and nothing connected the two.
 */
export const FORMAT_PRESETS: { value: string; label: string }[] = [
  { value: "Page {n} of {total}", label: "Page 1 of N" },
  { value: "{n} / {total}", label: "1 / N" },
  { value: "{n}", label: "1" },
  { value: "- {n} -", label: "- 1 -" },
];

export function PageNumbersRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · numbers stamped locally in your browser"
      handoffSlug="page-numbers"
      toolName="Add Page Numbers"
    >
      {(pdf, reset) => <PageNumbersEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

function PageNumbersEditor({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  const [format, setFormat] = useState(DEFAULT_PAGE_NUMBER_FORMAT);
  const [position, setPosition] = useState<StampPosition>("bottom-center");
  const [startPage, setStartPage] = useState(1);
  const [startAt, setStartAt] = useState(1);
  const [fontSize, setFontSize] = useState(11);
  const { busy, error, result, run } = useAsyncRun<Uint8Array>();

  const numberedCount = Math.max(0, pdf.pageCount - (startPage - 1));
  const preview = useMemo(() => {
    const total = startAt + numberedCount - 1;
    return previewPageNumber(
      format || DEFAULT_PAGE_NUMBER_FORMAT,
      startAt,
      total,
    );
  }, [format, startAt, numberedCount]);

  const onRun = () =>
    run(() =>
      addPageNumbers(pdf.bytes, {
        format,
        position,
        startPage,
        startAt,
        fontSize,
      }),
    );

  if (result) {
    return (
      <ResultPanel
        title="Page numbers added"
        summary={`${numberedCount} page${numberedCount === 1 ? "" : "s"} numbered · ${formatBytes(result.byteLength)}`}
        onReset={onReset}
      >
        <button
          type="button"
          onClick={() =>
            downloadBytes(result, numberedOutputName(pdf.file.name))
          }
          className={buttonVariants({ variant: "primary", size: "lg" })}
        >
          <Download className="size-4" aria-hidden />
          Download numbered PDF
        </button>
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection
        title="Format"
        aside={
          <span className="border-line bg-wash text-muted rounded-full border px-2.5 py-1 text-xs">
            Preview: <span className="text-accent">{preview || "—"}</span>
          </span>
        }
      >
        <div className="flex flex-col gap-3">
          <SegmentedControl
            label="Number format preset"
            value={FORMAT_PRESETS.some((p) => p.value === format) ? format : ""}
            options={[
              ...FORMAT_PRESETS,
              ...(FORMAT_PRESETS.some((p) => p.value === format)
                ? []
                : [{ value: "", label: "Custom" }]),
            ]}
            onChange={(value) => value && setFormat(value)}
          />
          <TextField
            label="Custom format ({n} = page, {total} = count)"
            value={format}
            onChange={setFormat}
            placeholder={DEFAULT_PAGE_NUMBER_FORMAT}
          />
        </div>
      </RunnerSection>

      <RunnerSection title="Placement">
        <div className="flex flex-wrap items-start gap-6">
          <PositionPicker value={position} onChange={setPosition} />
          <div className="flex min-w-52 flex-1 flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Start on page"
                value={startPage}
                min={1}
                max={Math.max(1, pdf.pageCount)}
                onChange={setStartPage}
              />
              <NumberField
                label="First number"
                value={startAt}
                min={0}
                max={99999}
                onChange={setStartAt}
              />
            </div>
            <RangeField
              label="Font size"
              value={fontSize}
              min={7}
              max={28}
              onChange={setFontSize}
              format={(v) => `${v} pt`}
            />
          </div>
        </div>
      </RunnerSection>

      <PrivacyLine>
        Numbers are drawn on your device — the PDF never leaves your browser.
      </PrivacyLine>

      {error && <ErrorNote message={error} />}

      <div className="flex justify-end">
        <RunButton onClick={onRun} busy={busy} busyLabel="Numbering…">
          <ListOrdered className="size-4" aria-hidden />
          Add page numbers
        </RunButton>
      </div>
    </div>
  );
}
