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
import {
  OPTION_SCHEMAS,
  recallOptions,
  rememberOptions,
} from "@/lib/intent/option-memory";
import { formatBytes } from "@/lib/utils";
import {
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  outputFile,
  useAsyncRun,
} from "./runner-kit";
import { RunBar } from "./run-bar";
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

export function PageNumbersEditor({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  // The last preset, position and start chosen here (option memory). A
  // custom format is typed text and is never kept.
  const [kept] = useState(() => recallOptions("page-numbers"));
  const [format, setFormat] = useState<string>(
    kept.format ?? DEFAULT_PAGE_NUMBER_FORMAT,
  );
  const [position, setPosition] = useState<StampPosition>(
    kept.position ?? "bottom-center",
  );
  const [startPage, setStartPage] = useState(() =>
    Math.min(kept.startPage ?? 1, Math.max(1, pdf.pageCount)),
  );
  const [startAt, setStartAt] = useState(kept.startAt ?? 1);
  const [fontSize, setFontSize] = useState(11);
  const { busy, error, result, run, reset } = useAsyncRun<Uint8Array>();

  const numberedCount = Math.max(0, pdf.pageCount - (startPage - 1));
  const preview = useMemo(() => {
    const total = startAt + numberedCount - 1;
    return previewPageNumber(
      format || DEFAULT_PAGE_NUMBER_FORMAT,
      startAt,
      total,
    );
  }, [format, startAt, numberedCount]);

  const onRun = () => {
    // A preset is kept; anything typed is not.
    const preset = OPTION_SCHEMAS["page-numbers"].format.values.find(
      (value) => value === format,
    );
    rememberOptions("page-numbers", {
      position,
      startPage,
      startAt,
      ...(preset ? { format: preset } : {}),
    });
    return run(() =>
      addPageNumbers(pdf.bytes, {
        format,
        position,
        startPage,
        startAt,
        fontSize,
      }),
    );
  };

  if (result) {
    return (
      <ResultPanel
        title="Page numbers added"
        summary={`${numberedCount} page${numberedCount === 1 ? "" : "s"} numbered · ${formatBytes(result.byteLength)}`}
        onReset={onReset}
        output={outputFile(result, numberedOutputName(pdf.file.name))}
        onAdjust={reset}
        expectedPages={pdf.pageCount}
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
          <span className="border-line bg-wash text-muted rounded-tag border px-2.5 py-1 text-xs">
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

      <RunBar>
        <div className="flex justify-end">
          <RunButton onClick={onRun} busy={busy} busyLabel="Numbering…">
            <ListOrdered className="size-4" aria-hidden />
            Add page numbers
          </RunButton>
        </div>
      </RunBar>
    </div>
  );
}
