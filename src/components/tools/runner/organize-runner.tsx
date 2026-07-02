"use client";

import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  Download,
  FlipVertical2,
  RefreshCw,
  RotateCw,
  Trash2,
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
  reorder,
  useAsyncRun,
} from "./runner-kit";
import { PageTile, TileAction } from "./page-tile";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import { usePdfThumbnails } from "./use-pdf-thumbnails";
import type { LoadedPdf } from "./use-single-pdf";

interface OrganizeItem {
  uid: string;
  sourceIndex: number;
  rotation: Rotation;
}

export function OrganizeRunner() {
  return (
    <SinglePdfRunner hint="One PDF · reorder, rotate, duplicate, or delete pages">
      {(pdf, reset) => <OrganizeEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

function OrganizeEditor({
  pdf,
  onReset,
}: {
  pdf: LoadedPdf;
  onReset: () => void;
}) {
  const initial = useMemo<OrganizeItem[]>(
    () =>
      pdf.rotations.map((rotation, i) => ({
        uid: `s${i}`,
        sourceIndex: i,
        rotation,
      })),
    [pdf],
  );
  const [items, setItems] = useState<OrganizeItem[]>(initial);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const uidRef = useRef(pdf.pageCount);
  const { busy, error, result, run } = useAsyncRun<Uint8Array>();
  const { thumbs, rendered, status } = usePdfThumbnails(pdf.bytes, pdf.pageCount);

  const move = (from: number, to: number) =>
    setItems((prev) => reorder(prev, from, to));

  const rotateItem = (index: number, delta: number) =>
    setItems((prev) =>
      prev.map((item, i) =>
        i === index
          ? { ...item, rotation: normalizeAngle(item.rotation + delta) }
          : item,
      ),
    );

  const duplicateItem = (index: number) =>
    setItems((prev) => {
      const item = prev[index];
      if (!item) return prev;
      const next = prev.slice();
      next.splice(index + 1, 0, { ...item, uid: `d${uidRef.current++}` });
      return next;
    });

  const deleteItem = (index: number) =>
    setItems((prev) =>
      prev.length > 1 ? prev.filter((_, i) => i !== index) : prev,
    );

  const dirty = useMemo(() => {
    if (items.length !== initial.length) return true;
    return items.some(
      (item, i) =>
        item.sourceIndex !== initial[i]?.sourceIndex ||
        item.rotation !== initial[i]?.rotation,
    );
  }, [items, initial]);

  const onRun = () =>
    run(() =>
      organizePages(
        pdf.bytes,
        items.map(({ sourceIndex, rotation }) => ({ sourceIndex, rotation })),
      ),
    );

  if (result) {
    return (
      <ResultPanel
        title="Pages organized"
        summary={`${items.length} page${items.length === 1 ? "" : "s"} in your new order · ${formatBytes(result.byteLength)}`}
        onReset={onReset}
      >
        <button
          type="button"
          onClick={() =>
            downloadBytes(result, outputName(pdf.file.name, "organized"))
          }
          className={buttonVariants({ variant: "primary", size: "lg" })}
        >
          <Download className="size-4" aria-hidden />
          Download organized PDF
        </button>
      </ResultPanel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FileHeader pdf={pdf} />

      <RunnerSection
        title="Arrange pages"
        aside={
          <span className="text-xs text-slate-500">
            Drag tiles to reorder · {items.length} in output
          </span>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <ChipButton onClick={() => setItems((prev) => [...prev].reverse())}>
            <FlipVertical2 className="size-3.5" aria-hidden />
            Reverse
          </ChipButton>
          <ChipButton onClick={() => setItems(initial)} disabled={!dirty}>
            <RefreshCw className="size-3.5" aria-hidden />
            Reset
          </ChipButton>
        </div>
      </RunnerSection>

      <PreviewStatus rendered={rendered} total={pdf.pageCount} status={status} />

      <div className="grid max-h-[58vh] grid-cols-2 gap-3 overflow-auto rounded-2xl border border-white/10 bg-white/[0.015] p-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {items.map((item, i) => (
          <PageTile
            key={item.uid}
            label={`Page ${item.sourceIndex + 1}`}
            rotation={item.rotation}
            thumbnail={thumbs[item.sourceIndex]}
            loading={status === "rendering"}
            cornerBadge={i + 1}
            draggable
            onDragStart={() => setDragIndex(i)}
            onDragOver={(e) => {
              e.preventDefault();
              setOverIndex(i);
            }}
            onDrop={() => {
              if (dragIndex !== null) move(dragIndex, i);
              setDragIndex(null);
              setOverIndex(null);
            }}
            onDragEnd={() => {
              setDragIndex(null);
              setOverIndex(null);
            }}
            dropTarget={overIndex === i && dragIndex !== null && dragIndex !== i}
            dimmed={dragIndex === i}
            actions={
              <>
                <TileAction
                  title="Move left"
                  onClick={() => move(i, i - 1)}
                  disabled={i === 0}
                >
                  <ArrowLeft className="size-3.5" aria-hidden />
                </TileAction>
                <TileAction title="Rotate right" onClick={() => rotateItem(i, 90)}>
                  <RotateCw className="size-3.5" aria-hidden />
                </TileAction>
                <TileAction title="Duplicate" onClick={() => duplicateItem(i)}>
                  <Copy className="size-3.5" aria-hidden />
                </TileAction>
                <TileAction
                  title="Delete"
                  onClick={() => deleteItem(i)}
                  disabled={items.length === 1}
                  danger
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </TileAction>
                <TileAction
                  title="Move right"
                  onClick={() => move(i, i + 1)}
                  disabled={i === items.length - 1}
                >
                  <ArrowRight className="size-3.5" aria-hidden />
                </TileAction>
              </>
            }
          />
        ))}
      </div>

      {error && <ErrorNote message={error} />}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-500">
          Badge shows the new page position; label shows the original page.
        </p>
        <RunButton
          onClick={onRun}
          busy={busy}
          disabled={!dirty}
          busyLabel="Building…"
        >
          <Download className="size-4" aria-hidden />
          Apply &amp; export
        </RunButton>
      </div>
    </div>
  );
}
