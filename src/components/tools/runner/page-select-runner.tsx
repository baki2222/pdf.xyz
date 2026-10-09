"use client";

import { useMemo, useRef, useState } from "react";
import { Download, FileOutput, MousePointerClick, Trash2 } from "lucide-react";
import { deletePages, extractPages } from "@/lib/pdf/engine";
import { parsePageList } from "@/lib/pdf/ranges";
import { downloadBytes } from "@/lib/pdf/browser";
import { outputName } from "@/lib/pdf/files";
import { buttonVariants } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import { getToolBySlug } from "@/lib/tools";
import {
  ChipButton,
  ErrorNote,
  PreviewStatus,
  ResultPanel,
  RunButton,
  RunnerSection,
  errorMessage,
  useAsyncRun,
} from "./runner-kit";
import {
  allIndices,
  invertSelection,
  isAllSelected,
  selectRange,
  toggleIndex,
} from "./selection";
import { PageTile } from "./page-tile";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import { usePdfThumbnails } from "./use-pdf-thumbnails";
import type { LoadedPdf } from "./use-single-pdf";

type Mode = "extract" | "delete";

interface ModeConfig {
  actionIcon: typeof FileOutput;
  actionLabel: (n: number) => string;
  busyLabel: string;
  helper: (selected: number) => string;
  emptyHint: string;
  /** Suffix appended to the source name for the download, e.g. "extracted". */
  outputSuffix: string;
  resultTitle: string;
  resultSummary: (selected: number, total: number) => string;
  /** Delete can't remove every page, so it disables when all are selected. */
  disallowSelectAll: boolean;
}

const CONFIG: Record<Mode, ModeConfig> = {
  extract: {
    actionIcon: FileOutput,
    actionLabel: (n) => `Extract ${n} page${n === 1 ? "" : "s"}`,
    busyLabel: "Extracting…",
    helper: (n) =>
      n === 0
        ? "Select the pages to pull into a new PDF."
        : `${n} page${n === 1 ? "" : "s"} will be exported.`,
    emptyHint: "One PDF · pick the pages to keep",
    outputSuffix: "extracted",
    resultTitle: "Pages extracted",
    resultSummary: (n) =>
      `${n} page${n === 1 ? "" : "s"} exported to a new PDF`,
    disallowSelectAll: false,
  },
  delete: {
    actionIcon: Trash2,
    actionLabel: (n) => `Delete ${n} page${n === 1 ? "" : "s"}`,
    busyLabel: "Deleting…",
    helper: (n) =>
      n === 0
        ? "Select the pages to remove."
        : `${n} page${n === 1 ? "" : "s"} will be removed.`,
    emptyHint: "One PDF · pick the pages to remove",
    outputSuffix: "pages-removed",
    resultTitle: "Pages removed",
    resultSummary: (n, total) =>
      `${n} removed · ${total - n} page${total - n === 1 ? "" : "s"} remaining`,
    disallowSelectAll: true,
  },
};

export function PageSelectRunner({ mode }: { mode: Mode }) {
  const config = CONFIG[mode];
  const handoffSlug = mode === "extract" ? "extract-pages" : "remove-pages";
  // The catalogue's name, not a second spelling of it: this read "Remove
  // Pages" while the catalogue, the H1 and every link say "Delete Pages".
  const toolName = getToolBySlug(handoffSlug)?.name ?? handoffSlug;
  return (
    <SinglePdfRunner
      hint={config.emptyHint}
      handoffSlug={handoffSlug}
      toolName={toolName}
    >
      {(pdf, reset) => (
        <PageSelectEditor pdf={pdf} onReset={reset} config={config} />
      )}
    </SinglePdfRunner>
  );
}

function PageSelectEditor({
  pdf,
  onReset,
  config,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
  config: ModeConfig;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [rangeInput, setRangeInput] = useState("");
  const [rangeError, setRangeError] = useState<string | null>(null);
  const anchorRef = useRef<number | null>(null);
  const { busy, error, result, run } = useAsyncRun<Uint8Array>();
  const { thumbs, rendered, status, capped, eagerCount, requestPage } =
    usePdfThumbnails(pdf.bytes, pdf.pageCount);

  const selectedList = useMemo(
    () => [...selected].sort((a, b) => a - b),
    [selected],
  );

  // Click / Enter / Space toggles a page; holding Shift selects the range from
  // the last-touched page to this one (mouse or keyboard).
  const onSelectPage = (index: number, shiftKey: boolean) => {
    setSelected((prev) =>
      shiftKey && anchorRef.current !== null
        ? selectRange(prev, anchorRef.current, index, pdf.pageCount)
        : toggleIndex(prev, index),
    );
    anchorRef.current = index;
  };

  const selectAll = () => {
    setSelected(allIndices(pdf.pageCount));
    anchorRef.current = null;
  };
  const clear = () => {
    setSelected(new Set());
    anchorRef.current = null;
  };
  const invert = () =>
    setSelected((prev) => invertSelection(prev, pdf.pageCount));

  const applyRange = () => {
    try {
      setSelected(new Set(parsePageList(rangeInput, pdf.pageCount)));
      setRangeError(null);
      anchorRef.current = null;
    } catch (err) {
      setRangeError(errorMessage(err));
    }
  };

  const onRun = () =>
    run(() =>
      config === CONFIG.extract
        ? extractPages(pdf.bytes, selectedList)
        : deletePages(pdf.bytes, selectedList),
    );

  const allSelected = isAllSelected(selected, pdf.pageCount);
  const disabled =
    selected.size === 0 || (config.disallowSelectAll && allSelected);

  if (result) {
    return (
      <ResultPanel
        title={config.resultTitle}
        summary={`${config.resultSummary(selected.size, pdf.pageCount)} · ${formatBytes(result.byteLength)}`}
        onReset={onReset}
      >
        <button
          type="button"
          onClick={() =>
            downloadBytes(
              result,
              outputName(pdf.file.name, config.outputSuffix),
            )
          }
          className={buttonVariants({ variant: "primary", size: "lg" })}
        >
          <Download className="size-4" aria-hidden />
          Download PDF
        </button>
      </ResultPanel>
    );
  }

  const ActionIcon = config.actionIcon;

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection
        title="Select pages"
        aside={
          <span className="text-muted text-xs">
            {config.helper(selected.size)}
          </span>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <ChipButton onClick={selectAll}>Select all</ChipButton>
          <ChipButton onClick={clear} disabled={selected.size === 0}>
            Clear
          </ChipButton>
          <ChipButton onClick={invert}>Invert</ChipButton>
          <span className="bg-wash mx-1 h-4 w-px" aria-hidden />
          <input
            type="text"
            value={rangeInput}
            onChange={(e) => setRangeInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyRange()}
            placeholder="e.g. 1-3, 5"
            spellCheck={false}
            aria-label="Select pages by range"
            className="bg-canvas/60 border-line text-fg focus:border-accent/40 focus:ring-accent/50 w-36 rounded-full border px-3.5 py-1.5 text-xs transition outline-none focus:ring-2"
          />
          <ChipButton onClick={applyRange}>
            <MousePointerClick className="size-3.5" aria-hidden />
            Select
          </ChipButton>
        </div>
      </RunnerSection>

      {rangeError && <ErrorNote message={rangeError} />}

      <PreviewStatus
        rendered={rendered}
        total={pdf.pageCount}
        status={status}
        capped={capped}
        eager={eagerCount}
      />

      <div
        role="group"
        aria-label={`Pages — select the ones to ${config === CONFIG.extract ? "extract" : "remove"}. Shift-click to select a range.`}
        className="border-line bg-wash grid max-h-[58vh] grid-cols-2 gap-3 overflow-auto rounded-[4px] border p-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8"
      >
        {pdf.rotations.map((rotation, i) => (
          <PageTile
            key={i}
            label={`Page ${i + 1}`}
            ariaLabel={`Page ${i + 1}`}
            rotation={rotation}
            thumbnail={thumbs[i]}
            loading={status === "rendering"}
            onEnterView={capped ? () => requestPage(i) : undefined}
            selectable
            selected={selected.has(i)}
            onSelect={(shiftKey) => onSelectPage(i, shiftKey)}
          />
        ))}
      </div>

      {error && <ErrorNote message={error} />}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {config.disallowSelectAll && allSelected && (
          <p className="text-warn text-xs">
            You can&apos;t delete every page — deselect at least one.
          </p>
        )}
        <div className="sm:ml-auto">
          <RunButton
            onClick={onRun}
            busy={busy}
            disabled={disabled}
            busyLabel={config.busyLabel}
          >
            <ActionIcon className="size-4" aria-hidden />
            {config.actionLabel(selected.size)}
          </RunButton>
        </div>
      </div>
    </div>
  );
}
