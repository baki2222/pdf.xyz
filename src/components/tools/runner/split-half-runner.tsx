"use client";

/* eslint-disable @next/next/no-img-element -- a rendered page is an ephemeral object URL */
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Download, SquareSplitHorizontal } from "lucide-react";
import {
  SPLIT_DIRECTIONS,
  SPLIT_HALF_RUN_LABEL,
  SPLIT_ORDER_CHOICES,
  SPLIT_POSITION,
  clampSplitPosition,
  orderHint,
  pagesToSplit,
  splitHalfOutputName,
  splitPagesInHalf,
  type SplitDirection,
  type SplitHalfResult,
  type SplitOrder,
} from "@/lib/pdf/split-half";
import { getPageSizes } from "@/lib/pdf/crop";
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
import {
  FileHeader,
  SinglePdfRunner,
  type SinglePdfBatch,
} from "./single-pdf-runner";
import {
  CheckboxField,
  PrivacyLine,
  RangeField,
  SegmentedControl,
  TextField,
} from "./stamp-controls";
import { CropDisclosure } from "./crop-disclosure";
import { usePageImage } from "./use-page-image";
import type { LoadedPdf } from "./use-single-pdf";

/**
 * The first page to be split, drawn with the cut on it as a dashed line
 * (audit split-pdf-pages-in-half#1): the line is a slider, so it can be
 * dragged on the page, or focused and moved with the arrow keys, one
 * percent a press, ten with Shift.
 */
function CutPreview({
  bytes,
  page,
  size,
  direction,
  position,
  onChange,
}: {
  bytes: Uint8Array;
  page: number;
  size: { width: number; height: number };
  direction: SplitDirection;
  position: number;
  onChange: (position: number) => void;
}) {
  const image = usePageImage(bytes, page);
  const sheetRef = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  const across = direction === "left-right";
  const set = (value: number) =>
    onChange(clampSplitPosition(Math.round(value)));
  const fromPointer = (event: React.PointerEvent) => {
    const rect = sheetRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    set(
      across
        ? ((event.clientX - rect.left) / rect.width) * 100
        : ((event.clientY - rect.top) / rect.height) * 100,
    );
  };
  return (
    <div className="border-line bg-canvas rounded-panel flex flex-col items-center gap-3 border p-5">
      <div
        ref={sheetRef}
        data-split-sheet=""
        className="rounded-sheet relative w-full max-w-[200px] overflow-hidden bg-white/90 shadow-sm ring-1 ring-black/10"
        style={{ aspectRatio: `${size.width} / ${size.height}` }}
      >
        {image && (
          <img
            src={image.url}
            alt={image.note ?? ""}
            className="absolute inset-0 size-full object-fill"
          />
        )}
        <span
          aria-hidden
          className="border-accent/40 rounded-ctl absolute border border-dashed"
          style={
            across
              ? { left: `${position}%`, top: 0, bottom: 0, width: 0 }
              : { top: `${position}%`, left: 0, right: 0, height: 0 }
          }
        />
        <span
          role="slider"
          tabIndex={0}
          aria-label="Cut line"
          aria-orientation={across ? "horizontal" : "vertical"}
          aria-valuemin={SPLIT_POSITION.min}
          aria-valuemax={SPLIT_POSITION.max}
          aria-valuenow={position}
          aria-valuetext={`${position}% from the ${across ? "left" : "top"}`}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture?.(event.pointerId);
            drag.current = true;
          }}
          onPointerMove={(event) => {
            if (drag.current) fromPointer(event);
          }}
          onPointerUp={() => {
            drag.current = false;
          }}
          onPointerCancel={() => {
            drag.current = false;
          }}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 10 : 1;
            const by: Record<string, number> = {
              ArrowLeft: -step,
              ArrowUp: -step,
              ArrowRight: step,
              ArrowDown: step,
            };
            let next: number | null = null;
            if (event.key in by) next = position + by[event.key]!;
            else if (event.key === "Home") next = SPLIT_POSITION.min;
            else if (event.key === "End") next = SPLIT_POSITION.max;
            if (next === null) return;
            event.preventDefault();
            set(next);
          }}
          className={cn(
            "tap focus-visible:ring-accent/50 rounded-tag absolute z-10 grid size-6 -translate-x-1/2 -translate-y-1/2 touch-none place-items-center outline-none focus-visible:ring-2",
            across ? "cursor-ew-resize" : "cursor-ns-resize",
          )}
          style={
            across
              ? { left: `${position}%`, top: "50%" }
              : { top: `${position}%`, left: "50%" }
          }
        >
          <span
            aria-hidden
            className={cn(
              "bg-accent rounded-tag ring-canvas shadow-sm ring-2",
              across ? "h-5 w-1.5" : "h-1.5 w-5",
            )}
          />
        </span>
      </div>
      <p className="text-muted max-w-xs text-center text-xs">
        Page {page + 1}, the first to be split. Drag the line, or focus it and
        use the arrow keys.
      </p>
    </div>
  );
}

/**
 * Two or more PDFs: the batch (batch plan P1), its own chunk, fetched only
 * when they arrive — never with a visit to this page.
 */
const SplitHalfBatch = dynamic(
  () => import("./batch/split-half-batch").then((m) => m.SplitHalfBatch),
  {
    loading: () => (
      <div
        aria-hidden
        className="border-line bg-wash rounded-panel h-40 w-full border"
      />
    ),
  },
);
const batch = (props: SinglePdfBatch) => <SplitHalfBatch {...props} />;

export function SplitHalfRunner() {
  return (
    <SinglePdfRunner
      hint="One or more PDFs · pages split in half locally in your browser"
      batch={batch}
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
  const [position, setPosition] = useState<number>(SPLIT_POSITION.middle);
  const [onlyWider, setOnlyWider] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { busy, error, result, run, reset } = useAsyncRun<SplitHalfResult>();

  // Each page's displayed size, for the preview and the shape option. The
  // editor is keyed by file, so this runs once; a late resolve is dropped.
  const [sizes, setSizes] = useState<{ width: number; height: number }[]>([]);
  useEffect(() => {
    let alive = true;
    getPageSizes(pdf.bytes)
      .then((read) => {
        if (alive) setSizes(read);
      })
      .catch(() => {
        // The preview is a help, not the work: the run reads the file again.
      });
    return () => {
      alive = false;
    };
  }, [pdf.bytes]);
  // The first page the settings would split, drawn with the cut on it.
  // Selected pages count once their list reads; until then, every page.
  let listed: number[] | undefined;
  if (scope === "range") {
    try {
      listed = parsePageList(rangeInput, pdf.pageCount);
    } catch {
      listed = undefined;
    }
  }
  const previewPage =
    sizes.length === pdf.pageCount
      ? (pagesToSplit(
          pdf.pageCount,
          {
            pages: listed,
            keepFirstWhole,
            keepLastWhole,
            onlyWider,
            direction,
          },
          sizes,
        )[0] ?? null)
      : null;

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
        position,
        onlyWider,
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

      {/* On both cuts (until 2026-11-08 only left and right had it). */}
      <RunnerSection title="Page order">
        <div className="flex flex-col gap-2">
          <SegmentedControl
            label="Page order"
            value={order}
            onChange={setOrder}
            options={SPLIT_ORDER_CHOICES[direction].map((o) => ({
              value: o.id,
              label: o.label,
            }))}
          />
          <p className="text-muted text-xs">{orderHint(direction, order)}</p>
        </div>
      </RunnerSection>

      <RunnerSection title="Where to cut">
        <div className="flex flex-col gap-4">
          <RangeField
            label="Cut position"
            value={position}
            min={SPLIT_POSITION.min}
            max={SPLIT_POSITION.max}
            onChange={(value) => setPosition(clampSplitPosition(value))}
            format={(value) =>
              `${value}% from the ${direction === "left-right" ? "left" : "top"}`
            }
          />
          {previewPage !== null && sizes[previewPage] && (
            <CutPreview
              bytes={pdf.bytes}
              page={previewPage}
              size={sizes[previewPage]!}
              direction={direction}
              position={position}
              onChange={setPosition}
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
            {/* Two literal labels, one per cut, so the page's "tick …" names a
                box that is rendered (tick-label-claims.test.ts); the runner
                test holds them to ONLY_WIDER_LABELS. */}
            {direction === "left-right" ? (
              <CheckboxField
                label="Only split pages wider than tall"
                checked={onlyWider}
                onChange={setOnlyWider}
                hint="Single pages among the spreads stay whole."
              />
            ) : (
              <CheckboxField
                label="Only split pages taller than wide"
                checked={onlyWider}
                onChange={setOnlyWider}
                hint="Single pages among the spreads stay whole."
              />
            )}
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
