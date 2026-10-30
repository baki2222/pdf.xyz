"use client";

import { useId, useState } from "react";
import { Download, Scaling } from "lucide-react";
import {
  MAX_RESIZE_SIDE_PT,
  MIN_RESIZE_SIDE_PT,
  RESIZE_MODES,
  RESIZE_ORIENTATIONS,
  RESIZE_SIZES,
  resizeOutputName,
  resizePdf,
  type ResizeMode,
  type ResizeOrientation,
  type ResizeResult,
  type ResizeSizeId,
} from "@/lib/pdf/resize";
import {
  LENGTH_UNITS,
  fromPoints,
  toPoints,
  type LengthUnit,
} from "@/lib/pdf/length-units";
import { parsePageList } from "@/lib/pdf/ranges";
import { downloadBytes } from "@/lib/pdf/browser";
import { buttonVariants } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import {
  ChipButton,
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
import { PrivacyLine, SegmentedControl, TextField } from "./stamp-controls";
import type { LoadedPdf } from "./use-single-pdf";

/** The run button's label — exported so the page's steps quote it. */
export const RESIZE_RUN_LABEL = "Resize PDF";

/** The custom size's chip label. */
export const CUSTOM_SIZE_LABEL = "Custom";

export function ResizeRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · pages resized locally in your browser"
      handoffSlug="resize-pdf"
      toolName="Resize PDF"
    >
      {(pdf, reset) => <ResizeEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

const A4 = RESIZE_SIZES[0]!.size;

export function ResizeEditor({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  const [sizeId, setSizeId] = useState<ResizeSizeId>("a4");
  const [unit, setUnit] = useState<LengthUnit>("mm");
  // The custom size, in points, so changing the unit never changes it.
  const [custom, setCustom] = useState({ width: A4.width, height: A4.height });
  const [orientation, setOrientation] = useState<ResizeOrientation>("match");
  const [mode, setMode] = useState<ResizeMode>("fit");
  const [scope, setScope] = useState<"all" | "range">("all");
  const [rangeInput, setRangeInput] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const { busy, error, result, run, reset } = useAsyncRun<ResizeResult>();

  const target =
    sizeId === "custom"
      ? custom
      : RESIZE_SIZES.find((s) => s.id === sizeId)!.size;

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
      resizePdf(pdf.bytes, {
        width: target.width,
        height: target.height,
        orientation,
        mode,
        pages,
      }),
    );
  };

  if (result) {
    const name = resizeOutputName(pdf.file.name);
    const all = result.resizedPages === result.pageCount;
    return (
      <ResultPanel
        title="PDF resized"
        summary={`${all ? "All" : `${result.resizedPages} of`} ${result.pageCount} page${result.pageCount === 1 ? "" : "s"} resized · ${formatBytes(result.bytes.byteLength)}`}
        onReset={onReset}
        output={outputFile(result.bytes, name)}
        onAdjust={reset}
        expectedPages={pdf.pageCount}
      >
        <button
          type="button"
          onClick={() => downloadBytes(result.bytes, name)}
          className={buttonVariants({ variant: "primary", size: "lg" })}
        >
          <Download className="size-4" aria-hidden />
          Download resized PDF
        </button>
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection title="New page size">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {RESIZE_SIZES.map((size) => (
              <ChipButton
                key={size.id}
                onClick={() => setSizeId(size.id)}
                disabled={busy}
                active={size.id === sizeId}
                title={`${fromPoints(size.size.width, "mm")} × ${fromPoints(size.size.height, "mm")} mm`}
              >
                {size.label}
              </ChipButton>
            ))}
            <ChipButton
              onClick={() => setSizeId("custom")}
              disabled={busy}
              active={sizeId === "custom"}
            >
              {CUSTOM_SIZE_LABEL}
            </ChipButton>
          </div>
          {sizeId === "custom" && (
            <div className="flex flex-col gap-3">
              <SegmentedControl
                label="Unit"
                value={unit}
                onChange={setUnit}
                options={LENGTH_UNITS.map((u) => ({ value: u, label: u }))}
              />
              <div className="grid grid-cols-2 gap-3">
                <LengthInput
                  label="Width"
                  points={custom.width}
                  unit={unit}
                  onChange={(width) => setCustom((c) => ({ ...c, width }))}
                />
                <LengthInput
                  label="Height"
                  points={custom.height}
                  unit={unit}
                  onChange={(height) => setCustom((c) => ({ ...c, height }))}
                />
              </div>
              <p className="text-muted text-xs">
                Each side between {fromPoints(MIN_RESIZE_SIDE_PT, unit)} and{" "}
                {fromPoints(MAX_RESIZE_SIDE_PT, unit).toLocaleString("en-US")}{" "}
                {unit}.
              </p>
            </div>
          )}
        </div>
      </RunnerSection>

      <RunnerSection title="Orientation">
        <SegmentedControl
          label="Orientation"
          value={orientation}
          onChange={setOrientation}
          options={RESIZE_ORIENTATIONS.map((o) => ({
            value: o.id,
            label: o.label,
          }))}
        />
      </RunnerSection>

      <RunnerSection title="How to resize">
        <div className="flex flex-col gap-2">
          <SegmentedControl
            label="Resize mode"
            value={mode}
            onChange={setMode}
            options={RESIZE_MODES.map((m) => ({ value: m.id, label: m.label }))}
          />
          <p className="text-muted text-xs">
            {RESIZE_MODES.find((m) => m.id === mode)!.hint}
            {mode === "canvas" &&
              " On a smaller page, what falls outside is hidden, not deleted."}
          </p>
        </div>
      </RunnerSection>

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
              placeholder="e.g. 1-3, 5"
            />
          )}
        </div>
      </RunnerSection>

      <PrivacyLine>
        Pages are resized on your device — the PDF never leaves your browser.
      </PrivacyLine>

      {formError && <ErrorNote message={formError} />}
      {error && <ErrorNote message={error} />}

      <RunBar>
        <div className="flex justify-end">
          <RunButton onClick={onRun} busy={busy} busyLabel="Resizing…">
            <Scaling className="size-4" aria-hidden />
            {RESIZE_RUN_LABEL}
          </RunButton>
        </div>
      </RunBar>
    </div>
  );
}

function LengthInput({
  label,
  points,
  unit,
  onChange,
}: {
  label: string;
  points: number;
  unit: LengthUnit;
  onChange: (points: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-muted text-xs font-medium">
        {label} ({unit})
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={fromPoints(points, unit)}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(toPoints(next, unit));
        }}
        className="border-line text-fg focus:border-accent/40 focus:ring-accent/50 bg-canvas rounded-ctl w-full min-w-0 border px-3.5 py-2.5 text-sm transition outline-none focus:ring-2"
      />
    </div>
  );
}
