"use client";

import { useEffect, useId, useRef, useState } from "react";
/* eslint-disable @next/next/no-img-element -- a rendered page is an ephemeral object URL */
import {
  ChevronLeft,
  ChevronRight,
  Crop,
  Download,
  ScanSearch,
  TriangleAlert,
} from "lucide-react";
import {
  cropPdf,
  croppedOutputName,
  getPageSizes,
  isEmptyMargins,
  MIN_CROP_DIMENSION,
  NO_CROP,
  type CropMargins,
} from "@/lib/pdf/crop";
import { appliedMargins, type AutoCropPlan } from "@/lib/pdf/auto-crop";
import {
  LENGTH_UNITS,
  UNIT_DECIMALS,
  formatLength,
  fromPoints,
  toPoints,
  type LengthUnit,
} from "@/lib/pdf/length-units";
import { parsePageList } from "@/lib/pdf/ranges";
import { downloadBytes } from "@/lib/pdf/browser";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatBytes } from "@/lib/utils";
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
import {
  PrivacyLine,
  RangeField,
  SegmentedControl,
  TextField,
} from "./stamp-controls";
import type { LoadedPdf } from "./use-single-pdf";
import { CropDisclosure } from "./crop-disclosure";
import { usePageImage } from "./use-page-image";

const START_MARGIN = 24;
const MAX_MARGIN = 300;

/** Clamp an inset percentage so the preview rectangle can never invert. */
const clampPct = (value: number) => Math.max(0, Math.min(49, value));

type CropMode = "uniform" | "per-side" | "auto";
type AutoApply = "per-page" | "uniform";

type AutoState =
  | { status: "idle" }
  | { status: "detecting"; done: number; total: number }
  | { status: "done"; plan: AutoCropPlan }
  | { status: "error"; message: string };

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

/** "page 2", "pages 2 and 5", "pages 2, 5, 9 and 3 more". */
function pageList(indices: readonly number[]): string {
  const shown = indices.slice(0, 8).map((i) => String(i + 1));
  const more = indices.length - shown.length;
  if (indices.length === 1) return `page ${shown[0]}`;
  if (more > 0) return `pages ${shown.join(", ")} and ${more} more`;
  return `pages ${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

/** A margin slider in points, with the value typed and shown in `unit`. */
function MarginField({
  label,
  value,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  unit: LengthUnit;
  onChange: (points: number) => void;
}) {
  const id = useId();
  const clampPt = (pt: number) => Math.max(0, Math.min(MAX_MARGIN, pt));
  const step = 1 / 10 ** UNIT_DECIMALS[unit];
  return (
    <div className="flex min-w-0 items-end gap-3">
      <div className="min-w-0 flex-1">
        <RangeField
          label={label}
          value={value}
          min={0}
          max={MAX_MARGIN}
          onChange={(pt) => onChange(clampPt(pt))}
          format={(pt) => formatLength(pt, unit)}
        />
      </div>
      <label htmlFor={id} className="sr-only">
        {`${label} in ${unit}`}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        max={fromPoints(MAX_MARGIN, unit)}
        step={step}
        value={fromPoints(value, unit)}
        onChange={(event) =>
          onChange(clampPt(toPoints(Number(event.target.value), unit)))
        }
        className="border-line text-fg focus:border-accent/40 focus:ring-accent/50 bg-canvas rounded-ctl tnum w-20 shrink-0 border px-2 py-1 text-right text-xs transition outline-none focus:ring-2"
      />
    </div>
  );
}

function CropEditor({ pdf, onReset }: { pdf: LoadedPdf; onReset: () => void }) {
  const [margins, setMargins] = useState<CropMargins>({
    top: START_MARGIN,
    right: START_MARGIN,
    bottom: START_MARGIN,
    left: START_MARGIN,
  });
  const [mode, setMode] = useState<CropMode>("uniform");
  const [unit, setUnit] = useState<LengthUnit>("pt");
  const [scope, setScope] = useState<"all" | "range">("all");
  const [rangeInput, setRangeInput] = useState("");
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [count, setCount] = useState(pdf.pageCount);
  const [sizes, setSizes] = useState<{ width: number; height: number }[]>([]);
  const [auto, setAuto] = useState<AutoState>({ status: "idle" });
  const [autoApply, setAutoApply] = useState<AutoApply>("per-page");
  const [previewPage, setPreviewPage] = useState(0);
  const { busy, error, result, run, reset } = useAsyncRun<Uint8Array>();
  const detectAbort = useRef<AbortController | null>(null);

  // Read every page's displayed size for the preview. The editor subtree is
  // keyed by file, so this runs once; the alive flag drops a late resolve.
  useEffect(() => {
    let alive = true;
    getPageSizes(pdf.bytes)
      .then((read) => {
        if (alive) setSizes(read);
      })
      .catch(() => {
        // The preview is purely cosmetic — ignore read failures.
      });
    return () => {
      alive = false;
      detectAbort.current?.abort();
    };
  }, [pdf.bytes]);

  const plan = auto.status === "done" ? auto.plan : null;
  const autoMargins = plan ? appliedMargins(plan, autoApply) : null;

  // The margins the preview draws: the slider values, or in Auto the
  // proposal for the page being reviewed (none for a blank page).
  const shownPage = mode === "auto" ? previewPage : 0;
  const shownMargins: CropMargins | null =
    mode === "auto" ? (autoMargins?.[shownPage] ?? null) : margins;
  const pageSize = sizes[shownPage] ?? null;
  const preview =
    pageSize && pageSize.width > 0 && pageSize.height > 0
      ? {
          width: pageSize.width,
          height: pageSize.height,
          box: shownMargins && {
            top: clampPct((shownMargins.top / pageSize.height) * 100),
            right: clampPct((shownMargins.right / pageSize.width) * 100),
            bottom: clampPct((shownMargins.bottom / pageSize.height) * 100),
            left: clampPct((shownMargins.left / pageSize.width) * 100),
          },
        }
      : null;
  const pageImage = usePageImage(
    pdf.bytes,
    mode === "auto" && plan ? shownPage : null,
  );

  const detect = async () => {
    detectAbort.current?.abort();
    const controller = new AbortController();
    detectAbort.current = controller;
    setAuto({ status: "detecting", done: 0, total: pdf.pageCount });
    try {
      const { detectAutoCrop } = await import("@/lib/pdf/auto-crop-render");
      const found = await detectAutoCrop(pdf.bytes, {
        signal: controller.signal,
        onProgress: ({ done, total }) =>
          setAuto({ status: "detecting", done, total }),
      });
      if (controller.signal.aborted) return;
      setAuto({ status: "done", plan: found });
      const first = found.perPage.findIndex((m) => m !== null);
      setPreviewPage(first >= 0 ? first : 0);
    } catch {
      if (controller.signal.aborted) return;
      setAuto({
        status: "error",
        message:
          "The pages could not be read to find their margins. Set the margins with Uniform or Per side instead.",
      });
    }
  };

  const autoCroppable = (pages: number[] | undefined) =>
    (pages ?? autoMargins?.map((_, i) => i) ?? []).filter(
      (i) => autoMargins?.[i] && !isEmptyMargins(autoMargins[i]!),
    ).length;

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
    if (mode === "auto") {
      if (!autoMargins) return;
      setCount(autoCroppable(pages));
      void run(() =>
        cropPdf(pdf.bytes, { margins: NO_CROP, pages, perPage: autoMargins }),
      );
      return;
    }
    setCount(pages ? pages.length : pdf.pageCount);
    void run(() => cropPdf(pdf.bytes, { margins, pages }));
  };

  if (result) {
    return (
      <ResultPanel
        title="PDF cropped"
        summary={`Cropped ${count} page${count === 1 ? "" : "s"} · ${formatBytes(result.byteLength)}`}
        onReset={onReset}
        output={outputFile(result, croppedOutputName(pdf.file.name))}
        onAdjust={reset}
        expectedPages={pdf.pageCount}
      >
        <div className="flex w-full flex-col gap-3">
          <button
            type="button"
            onClick={() =>
              downloadBytes(result, croppedOutputName(pdf.file.name))
            }
            className={cn(
              buttonVariants({ variant: "primary", size: "lg" }),
              "self-start",
            )}
          >
            <Download className="size-4" aria-hidden />
            Download cropped PDF
          </button>
          <CropDisclosure />
        </div>
      </ResultPanel>
    );
  }

  const runDisabled =
    mode === "auto"
      ? !plan || autoCroppable(undefined) === 0
      : isEmptyMargins(margins);

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection
        title="Crop margins"
        aside={
          <span className="text-muted text-xs">
            Pages never crop below {MIN_CROP_DIMENSION} pt
          </span>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl
              label="Crop mode"
              value={mode}
              onChange={(value) => {
                setMode(value);
                // "All sides" shows one value, so Uniform must crop with
                // exactly that value on every edge — never with per-side
                // values the person can no longer see. Pinned by
                // crop-runner.test.tsx.
                if (value === "uniform") {
                  setMargins((m) =>
                    m.right === m.top && m.bottom === m.top && m.left === m.top
                      ? m
                      : {
                          top: m.top,
                          right: m.top,
                          bottom: m.top,
                          left: m.top,
                        },
                  );
                }
              }}
              options={[
                { value: "uniform", label: "Uniform" },
                { value: "per-side", label: "Per side" },
                { value: "auto", label: "Auto" },
              ]}
            />
            {mode !== "auto" && (
              <SegmentedControl
                label="Units"
                value={unit}
                onChange={setUnit}
                options={LENGTH_UNITS.map((u) => ({ value: u, label: u }))}
              />
            )}
          </div>
          {mode === "uniform" && (
            <MarginField
              label="All sides"
              value={margins.top}
              unit={unit}
              onChange={(value) =>
                setMargins({
                  top: value,
                  right: value,
                  bottom: value,
                  left: value,
                })
              }
            />
          )}
          {mode === "per-side" && (
            <div className="grid gap-5 sm:grid-cols-2">
              {(["top", "right", "bottom", "left"] as const).map((edge) => (
                <MarginField
                  key={edge}
                  label={edge.charAt(0).toUpperCase() + edge.slice(1)}
                  value={margins[edge]}
                  unit={unit}
                  onChange={(value) =>
                    setMargins((m) => ({ ...m, [edge]: value }))
                  }
                />
              ))}
            </div>
          )}
          {mode === "auto" && (
            <AutoPanel
              auto={auto}
              apply={autoApply}
              onApply={setAutoApply}
              onDetect={() => void detect()}
              pageCount={pdf.pageCount}
            />
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

      <RunnerSection
        title="Crop preview"
        aside={
          mode === "auto" && plan ? (
            <span className="text-muted tnum text-xs">
              Page {shownPage + 1} of {pdf.pageCount}
            </span>
          ) : undefined
        }
      >
        <div className="border-line bg-canvas rounded-panel flex flex-col items-center gap-3 border p-5">
          {preview ? (
            <div
              className="rounded-sheet relative w-full max-w-[200px] overflow-hidden bg-white/90 shadow-sm ring-1 ring-black/10"
              style={{ aspectRatio: `${preview.width} / ${preview.height}` }}
            >
              {pageImage && (
                <img
                  src={pageImage}
                  alt=""
                  className="absolute inset-0 size-full object-fill"
                />
              )}
              {preview.box && (
                <span
                  aria-hidden
                  data-crop-box=""
                  className="border-accent/40 bg-accent/10 rounded-ctl absolute border border-dashed"
                  style={{
                    top: `${preview.box.top}%`,
                    right: `${preview.box.right}%`,
                    bottom: `${preview.box.bottom}%`,
                    left: `${preview.box.left}%`,
                  }}
                />
              )}
            </div>
          ) : (
            // Still, and the preview frame's own shape — not the pulsing box
            // #184 removed from Edit, Annotate and Redact. Held there by
            // e2e/editor-arrival.spec.ts.
            <div className="bg-wash rounded-sheet relative aspect-[3/4] w-full max-w-[200px] overflow-hidden" />
          )}
          {mode === "auto" && plan && (
            <>
              <p className="text-muted text-xs" role="status">
                {plan.blank.includes(shownPage)
                  ? "This page looks blank, so it is left uncropped."
                  : plan.unread.includes(shownPage)
                    ? "This page could not be read, so it is left uncropped."
                    : "The dashed box is what this page keeps."}
              </p>
              <div className="flex items-center gap-2">
                <ChipButton
                  onClick={() => setPreviewPage((p) => Math.max(0, p - 1))}
                  disabled={shownPage === 0}
                >
                  <ChevronLeft className="size-3.5" aria-hidden />
                  Previous page
                </ChipButton>
                <ChipButton
                  onClick={() =>
                    setPreviewPage((p) => Math.min(pdf.pageCount - 1, p + 1))
                  }
                  disabled={shownPage >= pdf.pageCount - 1}
                >
                  Next page
                  <ChevronRight className="size-3.5" aria-hidden />
                </ChipButton>
              </div>
            </>
          )}
        </div>
      </RunnerSection>

      <PrivacyLine>
        Cropping happens on your device — your PDF never leaves the browser.
      </PrivacyLine>

      {error && <ErrorNote message={error} />}

      <RunBar>
        <div className="flex justify-end">
          <RunButton
            onClick={onRun}
            busy={busy}
            disabled={runDisabled}
            busyLabel="Cropping…"
          >
            <Crop className="size-4" aria-hidden />
            Crop PDF
          </RunButton>
        </div>
      </RunBar>
    </div>
  );
}

/** Auto mode's controls: find the margins, then choose how to apply them. */
function AutoPanel({
  auto,
  apply,
  onApply,
  onDetect,
  pageCount,
}: {
  auto: AutoState;
  apply: AutoApply;
  onApply: (value: AutoApply) => void;
  onDetect: () => void;
  pageCount: number;
}) {
  const plan = auto.status === "done" ? auto.plan : null;
  const inked = plan ? plan.perPage.filter((m) => m !== null).length : 0;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted text-xs leading-relaxed">
        Looks at every page for marks — text, lines, images — and proposes a
        crop that keeps them with a small white border. Review each page below
        before you crop.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <ChipButton onClick={onDetect} disabled={auto.status === "detecting"}>
          <ScanSearch className="size-3.5" aria-hidden />
          {plan ? "Find margins again" : "Find white margins"}
        </ChipButton>
        {auto.status === "detecting" && (
          <span className="text-muted tnum text-xs" role="status">
            Reading page {Math.min(auto.done + 1, auto.total)} of {auto.total}…
          </span>
        )}
      </div>
      {auto.status === "error" && <ErrorNote message={auto.message} />}
      {plan && (
        <>
          <p className="text-fg text-xs" role="status">
            {inked === 0
              ? "No marks found on any page, so there is nothing to crop."
              : `Found the content on ${inked} of ${pageCount} page${pageCount === 1 ? "" : "s"}.`}
          </p>
          {(plan.blank.length > 0 || plan.unread.length > 0) && (
            <div
              role="alert"
              className="border-warn/40 bg-warn/10 text-warn rounded-panel flex items-start gap-3 border px-4 py-3 text-xs"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p className="leading-relaxed">
                {plan.blank.length > 0 &&
                  `${pageList(plan.blank).replace(/^p/, "P")} ${plan.blank.length === 1 ? "looks" : "look"} blank and ${plan.blank.length === 1 ? "is" : "are"} left uncropped. `}
                {plan.unread.length > 0 &&
                  `${pageList(plan.unread).replace(/^p/, "P")} could not be read and ${plan.unread.length === 1 ? "is" : "are"} left uncropped.`}
              </p>
            </div>
          )}
          {inked > 1 && (
            <SegmentedControl
              label="Apply auto-crop"
              value={apply}
              onChange={onApply}
              options={[
                { value: "per-page", label: "Each page its own box" },
                { value: "uniform", label: "Same box on every page" },
              ]}
            />
          )}
        </>
      )}
    </div>
  );
}
