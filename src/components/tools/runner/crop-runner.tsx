"use client";

import { useEffect, useState } from "react";
import { Crop, Download } from "lucide-react";
import {
  cropPdf,
  croppedOutputName,
  getPageSizes,
  isEmptyMargins,
  MIN_CROP_DIMENSION,
  type CropMargins,
} from "@/lib/pdf/crop";
import { parsePageList } from "@/lib/pdf/ranges";
import { downloadBytes } from "@/lib/pdf/browser";
import { buttonVariants } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import {
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  errorMessage,
  useAsyncRun,
} from "./runner-kit";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import {
  PrivacyLine,
  RangeField,
  SegmentedControl,
  TextField,
} from "./stamp-controls";
import type { LoadedPdf } from "./use-single-pdf";

const START_MARGIN = 24;
const MAX_MARGIN = 300;

const formatPt = (value: number) => `${value} pt`;

/** Clamp an inset percentage so the preview rectangle can never invert. */
const clampPct = (value: number) => Math.max(0, Math.min(49, value));

export function CropRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · cropped locally in your browser"
      handoffSlug="crop-pdf"
      toolName="Crop PDF"
    >
      {(pdf, reset) => <CropEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

function CropEditor({ pdf, onReset }: { pdf: LoadedPdf; onReset: () => void }) {
  const [margins, setMargins] = useState<CropMargins>({
    top: START_MARGIN,
    right: START_MARGIN,
    bottom: START_MARGIN,
    left: START_MARGIN,
  });
  const [uniform, setUniform] = useState(true);
  const [scope, setScope] = useState<"all" | "range">("all");
  const [rangeInput, setRangeInput] = useState("");
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [count, setCount] = useState(pdf.pageCount);
  const [pageSize, setPageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const { busy, error, result, run } = useAsyncRun<Uint8Array>();

  // Read page 1's size for the cosmetic schematic preview. The editor subtree is
  // keyed by file, so this runs once; the alive flag drops a late resolve.
  useEffect(() => {
    let alive = true;
    getPageSizes(pdf.bytes)
      .then((sizes) => {
        if (alive) setPageSize(sizes[0] ?? null);
      })
      .catch(() => {
        // The preview is purely cosmetic — ignore read failures.
      });
    return () => {
      alive = false;
    };
  }, [pdf.bytes]);

  // Live crop rectangle for the preview, as edge insets in % of page 1. Insets
  // are clamped so an over-large margin shrinks the box without inverting it.
  const preview =
    pageSize && pageSize.width > 0 && pageSize.height > 0
      ? {
          width: pageSize.width,
          height: pageSize.height,
          top: clampPct((margins.top / pageSize.height) * 100),
          right: clampPct((margins.right / pageSize.width) * 100),
          bottom: clampPct((margins.bottom / pageSize.height) * 100),
          left: clampPct((margins.left / pageSize.width) * 100),
        }
      : null;

  const onRun = () => {
    let pages: number[] | undefined;
    if (scope === "range") {
      try {
        pages = parsePageList(rangeInput, pdf.pageCount);
      } catch (err) {
        setRangeError(errorMessage(err));
        return;
      }
    }
    setRangeError(null);
    setCount(pages ? pages.length : pdf.pageCount);
    void run(() => cropPdf(pdf.bytes, { margins, pages }));
  };

  if (result) {
    return (
      <ResultPanel
        title="PDF cropped"
        summary={`Cropped ${count} page${count === 1 ? "" : "s"} · ${formatBytes(result.byteLength)}`}
        onReset={onReset}
      >
        <button
          type="button"
          onClick={() => downloadBytes(result, croppedOutputName(pdf.file.name))}
          className={buttonVariants({ variant: "primary", size: "lg" })}
        >
          <Download className="size-4" aria-hidden />
          Download cropped PDF
        </button>
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection
        title="Crop margins"
        aside={
          <span className="text-xs text-slate-500">
            Pages never crop below {MIN_CROP_DIMENSION} pt
          </span>
        }
      >
        <div className="flex flex-col gap-4">
          <SegmentedControl
            label="Crop mode"
            value={uniform ? "uniform" : "per-side"}
            onChange={(value) => setUniform(value === "uniform")}
            options={[
              { value: "uniform", label: "Uniform" },
              { value: "per-side", label: "Per side" },
            ]}
          />
          {uniform ? (
            <RangeField
              label="All sides"
              value={margins.top}
              min={0}
              max={MAX_MARGIN}
              onChange={(value) =>
                setMargins({
                  top: value,
                  right: value,
                  bottom: value,
                  left: value,
                })
              }
              format={formatPt}
            />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2">
              <RangeField
                label="Top"
                value={margins.top}
                min={0}
                max={MAX_MARGIN}
                onChange={(value) => setMargins((m) => ({ ...m, top: value }))}
                format={formatPt}
              />
              <RangeField
                label="Right"
                value={margins.right}
                min={0}
                max={MAX_MARGIN}
                onChange={(value) => setMargins((m) => ({ ...m, right: value }))}
                format={formatPt}
              />
              <RangeField
                label="Bottom"
                value={margins.bottom}
                min={0}
                max={MAX_MARGIN}
                onChange={(value) =>
                  setMargins((m) => ({ ...m, bottom: value }))
                }
                format={formatPt}
              />
              <RangeField
                label="Left"
                value={margins.left}
                min={0}
                max={MAX_MARGIN}
                onChange={(value) => setMargins((m) => ({ ...m, left: value }))}
                format={formatPt}
              />
            </div>
          )}
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
                setRangeError(null);
              }}
              placeholder="e.g. 1-3, 5"
            />
          )}
        </div>
      </RunnerSection>

      {rangeError && <ErrorNote message={rangeError} />}

      <RunnerSection title="Crop preview">
        <div className="flex justify-center rounded-2xl border border-white/10 bg-black/20 p-5">
          {preview ? (
            <div
              className="relative w-full max-w-[200px] overflow-hidden rounded-lg bg-white/90 shadow-sm ring-1 ring-black/10"
              style={{ aspectRatio: `${preview.width} / ${preview.height}` }}
            >
              <span
                aria-hidden
                className="absolute rounded-[3px] border border-dashed border-violet-500 bg-violet-500/25"
                style={{
                  top: `${preview.top}%`,
                  right: `${preview.right}%`,
                  bottom: `${preview.bottom}%`,
                  left: `${preview.left}%`,
                }}
              />
            </div>
          ) : (
            <div className="aspect-[3/4] w-full max-w-[200px] animate-pulse rounded-lg bg-white/10" />
          )}
        </div>
      </RunnerSection>

      <PrivacyLine>
        Cropping happens on your device — your PDF never leaves the browser.
      </PrivacyLine>

      {error && <ErrorNote message={error} />}

      <div className="flex justify-end">
        <RunButton
          onClick={onRun}
          busy={busy}
          disabled={isEmptyMargins(margins)}
          busyLabel="Cropping…"
        >
          <Crop className="size-4" aria-hidden />
          Crop PDF
        </RunButton>
      </div>
    </div>
  );
}
