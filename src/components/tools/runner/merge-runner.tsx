"use client";

// Cover thumbnails are pre-rendered PNG blobs (object URLs); see page-tile.tsx.
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Download,
  FileText,
  GripVertical,
  Layers,
  Plus,
  X,
} from "lucide-react";
import { getPageCount, mergePdfs } from "@/lib/pdf/engine";
import { downloadBytes, readFileBytes } from "@/lib/pdf/browser";
import { mergedOutputName, partitionPdfFiles } from "@/lib/pdf/files";
import { renderFirstPage } from "@/lib/pdf/render";
import type { Thumbnail } from "@/lib/pdf/render-utils";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatBytes } from "@/lib/utils";
import {
  Dropzone,
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  Spinner,
  errorMessage,
  reorder,
  useAnnouncer,
  useAsyncRun,
} from "./runner-kit";
import {
  HandoffLoadedBadge,
  HandoffLoading,
  HandoffProblem,
} from "./handoff-notice";
import { useToolHandoff } from "./use-tool-handoff";

interface MergeItem {
  id: string;
  name: string;
  size: number;
  bytes: Uint8Array;
  pageCount: number;
  /** First-page preview; `null` until (or unless) it renders. */
  cover: Thumbnail | null;
}

/** A file we couldn't add, with the specific reason (validation or parse). */
interface Rejection {
  name: string;
  reason: string;
}

export function MergeRunner() {
  const [items, setItems] = useState<MergeItem[]>([]);
  const [rejections, setRejections] = useState<Rejection[]>([]);
  const [loading, setLoading] = useState(0);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const idRef = useRef(0);
  const mounted = useRef(true);
  // Every cover object URL we create, so we can revoke them on unmount.
  const coverUrls = useRef<Set<string>>(new Set());
  const { busy, error, result, run, reset } = useAsyncRun<Uint8Array>();
  const { announce, node: announcer } = useAnnouncer();
  // Files handed off from the workspace (merge collects many into one).
  const handoff = useToolHandoff("merge-pdf");

  useEffect(() => {
    mounted.current = true;
    const urls = coverUrls.current;
    return () => {
      mounted.current = false;
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const attachCover = useCallback((id: string, bytes: Uint8Array) => {
    renderFirstPage(bytes, { targetWidth: 96 })
      .then((cover) => {
        if (!cover) return;
        if (!mounted.current) {
          URL.revokeObjectURL(cover.url);
          return;
        }
        coverUrls.current.add(cover.url);
        setItems((prev) =>
          prev.map((item) => (item.id === id ? { ...item, cover } : item)),
        );
      })
      .catch(() => {});
  }, []);

  const addFiles = useCallback(
    async (files: File[]) => {
      const { accepted, rejected } = partitionPdfFiles(files);
      // Type/size rejections are known synchronously.
      if (rejected.length > 0) {
        setRejections((prev) => [
          ...prev,
          ...rejected.map((r) => ({ name: r.file.name, reason: r.reason })),
        ]);
      }
      setLoading((n) => n + accepted.length);
      for (const file of accepted) {
        try {
          const bytes = await readFileBytes(file);
          // Parsing here validates the PDF *before* merge: an encrypted or
          // corrupt file throws a typed, user-facing reason we can attribute
          // to this specific file rather than failing the whole merge later.
          const pageCount = await getPageCount(bytes);
          const id = `f${idRef.current++}`;
          setItems((prev) => [
            ...prev,
            { id, name: file.name, size: file.size, bytes, pageCount, cover: null },
          ]);
          attachCover(id, bytes);
        } catch (err) {
          setRejections((prev) => [
            ...prev,
            { name: file.name, reason: errorMessage(err) },
          ]);
        } finally {
          setLoading((n) => n - 1);
        }
      }
    },
    [attachCover],
  );

  // Pre-load PDFs handed off from the workspace exactly once.
  const preloadedRef = useRef(false);
  useEffect(() => {
    if (preloadedRef.current) return;
    if (handoff.status === "ready" && handoff.files.length > 0) {
      preloadedRef.current = true;
      void addFiles(handoff.files);
    }
  }, [handoff.status, handoff.files, addFiles]);

  const revokeCover = (item: MergeItem | undefined) => {
    if (item?.cover) {
      URL.revokeObjectURL(item.cover.url);
      coverUrls.current.delete(item.cover.url);
    }
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || to === from) return;
    const name = items[from]?.name ?? "file";
    setItems((prev) => reorder(prev, from, to));
    announce(`Moved ${name} to position ${to + 1} of ${items.length}.`);
  };
  const removeAt = (index: number) =>
    setItems((prev) => {
      const removed = prev[index];
      revokeCover(removed);
      if (removed) announce(`Removed ${removed.name}.`);
      return prev.filter((_, i) => i !== index);
    });

  const startOver = () => {
    for (const url of coverUrls.current) URL.revokeObjectURL(url);
    coverUrls.current.clear();
    reset();
    setItems([]);
    setRejections([]);
    setDragIndex(null);
    setOverIndex(null);
  };

  const onMerge = () => run(() => mergePdfs(items.map((i) => i.bytes)));

  const totalPages = items.reduce((sum, i) => sum + i.pageCount, 0);

  if (result) {
    return (
      <ResultPanel
        title="PDFs merged"
        summary={`${items.length} files combined into one PDF · ${totalPages} pages · ${formatBytes(result.byteLength)}`}
        onReset={startOver}
      >
        <button
          type="button"
          onClick={() =>
            downloadBytes(result, mergedOutputName(items.map((i) => i.name)))
          }
          className={buttonVariants({ variant: "primary", size: "lg" })}
        >
          <Download className="size-4" aria-hidden />
          Download merged PDF
        </button>
      </ResultPanel>
    );
  }

  const rejectionsPanel = (
    <RejectionsNote
      rejections={rejections}
      onDismiss={() => setRejections([])}
    />
  );

  if (items.length === 0 && loading === 0) {
    // While a hand-off is being claimed, show a bringing-over state instead of
    // flashing the empty picker (files are about to appear).
    if (handoff.status === "loading") {
      return (
        <div className="flex flex-col gap-4">
          {announcer}
          <HandoffLoading />
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-4">
        {announcer}
        <HandoffProblem handoff={handoff} toolName="Merge PDF" />
        <Dropzone
          onFiles={addFiles}
          multiple
          hint="Add two or more PDFs · they stay on your device"
        />
        {rejectionsPanel}
        {error && <ErrorNote message={error} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {announcer}
      {handoff.status === "ready" && (
        <HandoffLoadedBadge count={handoff.files.length} skipped={handoff.skipped} />
      )}
      <RunnerSection
        title={`${items.length} file${items.length === 1 ? "" : "s"} · ${totalPages} pages`}
        aside={
          <span className="text-xs text-slate-400">
            Drag to reorder · top to bottom
          </span>
        }
      >
        <ul
          role="list"
          aria-label="PDFs to merge, in output order — drag a row or use its move buttons to reorder"
          className="flex flex-col gap-2"
        >
          {items.map((item, index) => (
            <li
              key={item.id}
              aria-label={`${item.name}, file ${index + 1} of ${items.length}, ${item.pageCount} page${item.pageCount === 1 ? "" : "s"}`}
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragOver={(e) => {
                e.preventDefault();
                setOverIndex(index);
              }}
              onDrop={() => {
                if (dragIndex !== null) move(dragIndex, index);
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
              className={cn(
                "flex items-center gap-3 rounded-2xl border bg-surface-2 px-3 py-2.5 transition",
                overIndex === index && dragIndex !== null && dragIndex !== index
                  ? "border-violet-400/60 ring-1 ring-violet-400/40"
                  : "border-white/10",
                dragIndex === index && "opacity-50",
              )}
            >
              <GripVertical
                className="size-4 shrink-0 cursor-grab text-slate-400"
                aria-hidden
              />
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white/5 text-xs font-semibold tabular-nums text-slate-400">
                {index + 1}
              </span>
              <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md bg-white/5 ring-1 ring-white/10">
                {item.cover ? (
                  <img
                    src={item.cover.url}
                    alt=""
                    draggable={false}
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <FileText className="size-4 text-violet-300" aria-hidden />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-slate-200">
                  {item.name}
                </span>
                <span className="block text-xs text-slate-400">
                  {item.pageCount} page{item.pageCount === 1 ? "" : "s"} ·{" "}
                  {formatBytes(item.size)}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(index, index - 1)}
                  aria-disabled={index === 0 || undefined}
                  aria-label={`Move ${item.name} up`}
                  className="grid size-7 place-items-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white aria-disabled:cursor-not-allowed aria-disabled:opacity-30"
                >
                  <ArrowUp className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, index + 1)}
                  aria-disabled={index === items.length - 1 || undefined}
                  aria-label={`Move ${item.name} down`}
                  className="grid size-7 place-items-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white aria-disabled:cursor-not-allowed aria-disabled:opacity-30"
                >
                  <ArrowDown className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => removeAt(index)}
                  aria-label={`Remove ${item.name}`}
                  className="grid size-7 place-items-center rounded-lg text-slate-400 transition hover:bg-red-500/15 hover:text-red-200"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </span>
            </li>
          ))}
          {loading > 0 && (
            <li className="flex items-center gap-2 rounded-2xl border border-white/10 bg-surface-2 px-3 py-3 text-sm text-slate-400">
              <Spinner />
              Reading {loading} file{loading === 1 ? "" : "s"}…
            </li>
          )}
        </ul>
      </RunnerSection>

      <Dropzone
        onFiles={addFiles}
        multiple
        compact
        browse={false}
        title="Add more PDFs"
        hint="Drop files or click to browse"
      />

      {rejectionsPanel}
      {error && <ErrorNote message={error} />}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="inline-flex items-center gap-1.5 text-xs text-slate-400">
          <Layers className="size-3.5 text-violet-300" aria-hidden />
          Files are combined in the order shown above.
        </p>
        <RunButton
          onClick={onMerge}
          busy={busy}
          disabled={items.length < 2}
          busyLabel="Merging…"
        >
          <Plus className="size-4" aria-hidden />
          Merge {items.length} PDF{items.length === 1 ? "" : "s"}
        </RunButton>
      </div>
    </div>
  );
}

/** Per-file rejection list: names + specific, honest reasons, dismissible. */
function RejectionsNote({
  rejections,
  onDismiss,
}: {
  rejections: Rejection[];
  onDismiss: () => void;
}) {
  if (rejections.length === 0) return null;
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex items-center gap-2 font-medium">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {rejections.length} file{rejections.length === 1 ? "" : "s"} couldn&apos;t
          be added
        </span>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-md px-2 py-0.5 text-xs text-amber-200/80 transition hover:bg-amber-500/15 hover:text-amber-100"
        >
          Dismiss
        </button>
      </div>
      <ul className="flex flex-col gap-1 pl-6 text-xs text-amber-200/90">
        {rejections.map((r, i) => (
          <li key={`${r.name}-${i}`} className="list-disc">
            <span className="font-medium text-amber-100">{r.name}</span> —{" "}
            {r.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
