"use client";

import { useMemo, useState } from "react";
import {
  Download,
  FlipHorizontal2,
  RefreshCw,
  RotateCcw,
  RotateCw,
} from "lucide-react";
import { normalizeAngle, organizePages } from "@/lib/pdf/engine";
import { downloadBytes } from "@/lib/pdf/browser";
import { outputName } from "@/lib/pdf/files";
import type { Rotation } from "@/lib/pdf/types";
import { buttonVariants } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import {
  ChipButton,
  ErrorNote,
  PreviewStatus,
  ResultPanel,
  RunButton,
  RunnerSection,
  useAsyncRun,
} from "./runner-kit";
import { PageTile, TileAction } from "./page-tile";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import { usePdfThumbnails } from "./use-pdf-thumbnails";
import type { LoadedPdf } from "./use-single-pdf";

export function RotateRunner() {
  return (
    <SinglePdfRunner hint="One PDF · rotate any or all pages">
      {(pdf, reset) => <RotateEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

function RotateEditor({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  const [rotations, setRotations] = useState<Rotation[]>(pdf.rotations);
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(pdf.rotations.map((_, i) => i)),
  );
  const { busy, error, result, run } = useAsyncRun<Uint8Array>();
  const { thumbs, rendered, status } = usePdfThumbnails(pdf.bytes, pdf.pageCount);

  const changedCount = useMemo(
    () =>
      rotations.reduce<number>(
        (n, rot, i) => (rot !== pdf.rotations[i] ? n + 1 : n),
        0,
      ),
    [rotations, pdf],
  );

  const toggle = (index: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const rotateBy = (delta: number, only?: number) => {
    const targets =
      only !== undefined
        ? new Set([only])
        : selected.size > 0
          ? selected
          : new Set(rotations.map((_, i) => i));
    setRotations((prev) =>
      prev.map((rot, i) => (targets.has(i) ? normalizeAngle(rot + delta) : rot)),
    );
  };

  const onRun = () =>
    run(() =>
      organizePages(
        pdf.bytes,
        rotations.map((rotation, i) => ({ sourceIndex: i, rotation })),
      ),
    );

  if (result) {
    return (
      <ResultPanel
        title="PDF rotated"
        summary={`${changedCount} page${changedCount === 1 ? "" : "s"} rotated · ${formatBytes(result.byteLength)}`}
        onReset={onReset}
      >
        <button
          type="button"
          onClick={() =>
            downloadBytes(result, outputName(pdf.file.name, "rotated"))
          }
          className={buttonVariants({ variant: "primary", size: "lg" })}
        >
          <Download className="size-4" aria-hidden />
          Download rotated PDF
        </button>
      </ResultPanel>
    );
  }

  const scope = selected.size > 0 ? `${selected.size} selected` : "all pages";

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection
        title="Rotate"
        aside={<span className="text-xs text-slate-500">Applies to {scope}</span>}
      >
        <div className="flex flex-wrap items-center gap-2">
          <ChipButton onClick={() => rotateBy(-90)}>
            <RotateCcw className="size-3.5" aria-hidden />
            Left
          </ChipButton>
          <ChipButton onClick={() => rotateBy(90)}>
            <RotateCw className="size-3.5" aria-hidden />
            Right
          </ChipButton>
          <ChipButton onClick={() => rotateBy(180)}>
            <FlipHorizontal2 className="size-3.5" aria-hidden />
            180°
          </ChipButton>
          <span className="mx-1 h-4 w-px bg-white/10" aria-hidden />
          <ChipButton onClick={() => setSelected(new Set(rotations.map((_, i) => i)))}>
            Select all
          </ChipButton>
          <ChipButton
            onClick={() => setSelected(new Set())}
            disabled={selected.size === 0}
          >
            Clear
          </ChipButton>
          <ChipButton
            onClick={() => setRotations(pdf.rotations)}
            disabled={changedCount === 0}
          >
            <RefreshCw className="size-3.5" aria-hidden />
            Reset
          </ChipButton>
        </div>
      </RunnerSection>

      <PreviewStatus rendered={rendered} total={pdf.pageCount} status={status} />

      <div className="grid max-h-[58vh] grid-cols-2 gap-3 overflow-auto rounded-2xl border border-white/10 bg-white/[0.015] p-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
        {rotations.map((rotation, i) => (
          <PageTile
            key={i}
            label={`Page ${i + 1}`}
            rotation={rotation}
            thumbnail={thumbs[i]}
            loading={status === "rendering"}
            selectable
            selected={selected.has(i)}
            onSelect={() => toggle(i)}
            actions={
              <>
                <TileAction
                  title={`Rotate page ${i + 1} left`}
                  onClick={() => rotateBy(-90, i)}
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                </TileAction>
                <TileAction
                  title={`Rotate page ${i + 1} right`}
                  onClick={() => rotateBy(90, i)}
                >
                  <RotateCw className="size-3.5" aria-hidden />
                </TileAction>
              </>
            }
          />
        ))}
      </div>

      {error && <ErrorNote message={error} />}

      <div className="flex justify-end">
        <RunButton
          onClick={onRun}
          busy={busy}
          disabled={changedCount === 0}
          busyLabel="Rotating…"
        >
          <RotateCw className="size-4" aria-hidden />
          Apply rotation
        </RunButton>
      </div>
    </div>
  );
}
