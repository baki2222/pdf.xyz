"use client";

// Cover thumbnails are pre-rendered PNG blobs (object URLs); see page-tile.tsx.
/* eslint-disable @next/next/no-img-element */

import { RunReason } from "@/components/tools/runner/run-reason";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
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
import { baseName, mergedOutputName, partitionPdfFiles } from "@/lib/pdf/files";
import {
  MERGE_MODE_LABEL,
  MERGE_MODES,
  MERGE_SORT_LABEL,
  MERGE_SORTS,
  sortMergeItems,
  type MergeMode,
  type MergeSort,
} from "@/lib/pdf/merge-order";
import { parsePageList } from "@/lib/pdf/ranges";
import { causeOf, remedyFor, type RemedyInput } from "@/lib/pdf/remedies";
import { naturalOrder, orderNote } from "@/lib/intent/defaults";
import type { Thumbnail } from "@/lib/pdf/render-utils";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatBytes } from "@/lib/utils";
import { NAME_WRAP } from "@/components/ui/name-wrap";
import {
  Dropzone,
  ErrorNote,
  ResultPanel,
  RunButton,
  RunnerSection,
  Spinner,
  errorMessage,
  outputFile,
  reorder,
  useAnnouncer,
  useAsyncRun,
} from "./runner-kit";
import { OrderNote } from "./order-note";
import { RunBar } from "./run-bar";
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
  /** Where it came in the drop: "Keep drop order" sorts by this. */
  seq: number;
  /** The pages to take, as typed ("1-3, 5"); empty takes every page. */
  range: string;
  /** Alternate pages only: take this file's pages last first. */
  reverse: boolean;
}

/** An item's page selection, read: the 0-based pages, or why it can't be. */
function selectionOf(
  item: MergeItem,
):
  | { pages: number[] | undefined; error: null }
  | { pages: null; error: string } {
  if (item.range.trim() === "") return { pages: undefined, error: null };
  try {
    return { pages: parsePageList(item.range, item.pageCount), error: null };
  } catch (err) {
    return { pages: null, error: errorMessage(err) };
  }
}

/** A file we couldn't add, with the specific reason (validation or parse). */
interface Rejection {
  name: string;
  reason: string;
  /** What the refusal says about why, for its fix (an encrypted file). */
  cause?: RemedyInput;
}

export function MergeRunner() {
  const [items, setItems] = useState<MergeItem[]>([]);
  const [rejections, setRejections] = useState<Rejection[]>([]);
  const [loading, setLoading] = useState(0);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const idRef = useRef(0);
  const seqRef = useRef(0);
  // The list as last drawn, for a drop to ask whether it is the first.
  const itemsRef = useRef<MergeItem[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  // The reason a natural order was applied, while it still stands.
  const [ordered, setOrdered] = useState<string | null>(null);
  const mounted = useRef(true);
  // Every cover object URL we create, so we can revoke them on unmount.
  const coverUrls = useRef<Set<string>>(new Set());
  const {
    busy,
    error,
    result: merged,
    run,
    reset,
  } = useAsyncRun<{
    bytes: Uint8Array;
    contentsPages: number;
  }>();
  const result = merged?.bytes ?? null;
  const { announce, node: announcer } = useAnnouncer();
  const [fileBookmarks, setFileBookmarks] = useState(false);
  const bookmarksId = useId();
  const [contentsPage, setContentsPage] = useState(false);
  const contentsId = useId();
  // How the pages are ordered: one file after another (the merge it always
  // was), or one page from each file in turn.
  const [mode, setMode] = useState<MergeMode>("append");
  const alternate = mode === "alternate";
  const rangeIdBase = useId();
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
    // The renderer loads with the first file, not with the page.
    import("@/lib/pdf/render")
      .then(({ renderFirstPage }) =>
        renderFirstPage(bytes, { targetWidth: 96 }),
      )
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
      // The first files in are put in the order of the numbers in their
      // names when they are one numbered sequence (smart default, E.9) —
      // decided BEFORE reading, so each row lands in its place and none
      // moves after it is drawn.
      const natural =
        itemsRef.current.length === 0
          ? naturalOrder(accepted.map((file) => file.name))
          : null;
      const seqOf = new Map(accepted.map((f, i) => [f, seqRef.current + i]));
      seqRef.current += accepted.length;
      const queue = natural ? natural.order.map((i) => accepted[i]!) : accepted;
      if (itemsRef.current.length === 0)
        setOrdered(natural ? orderNote(natural.numbers) : null);
      setLoading((n) => n + accepted.length);
      for (const file of queue) {
        try {
          const bytes = await readFileBytes(file);
          // Parsing here validates the PDF *before* merge: an encrypted or
          // corrupt file throws a typed, user-facing reason we can attribute
          // to this specific file rather than failing the whole merge later.
          const pageCount = await getPageCount(bytes);
          const id = `f${idRef.current++}`;
          setItems((prev) => [
            ...prev,
            {
              id,
              name: file.name,
              size: file.size,
              bytes,
              pageCount,
              cover: null,
              seq: seqOf.get(file) ?? 0,
              range: "",
              reverse: false,
            },
          ]);
          attachCover(id, bytes);
        } catch (err) {
          setRejections((prev) => [
            ...prev,
            { name: file.name, reason: errorMessage(err), cause: causeOf(err) },
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
    setOrdered(null);
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
    setOrdered(null);
    setFileBookmarks(false);
    setContentsPage(false);
    setMode("append");
  };

  const keepDropOrder = () => {
    setItems((prev) => [...prev].sort((a, b) => a.seq - b.seq));
    setOrdered(null);
    announce("Kept the order the files were dropped in.");
  };

  const sortBy = (sort: MergeSort) => {
    setItems((prev) => sortMergeItems(prev, sort));
    setOrdered(null);
    announce(`Sorted ${MERGE_SORT_LABEL[sort]}.`);
  };

  const setRange = (id: string, range: string) =>
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, range } : item)),
    );
  const setReverse = (id: string, reverse: boolean) =>
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, reverse } : item)),
    );

  const selections = useMemo(() => items.map(selectionOf), [items]);
  const selectionError = selections.some((s) => s.error !== null);

  const onMerge = () =>
    run(async () => {
      if (alternate) {
        // Loaded with the mode, not with the page: the default merge never
        // pays for it.
        const { mergeAlternating } = await import("@/lib/pdf/merge-alternate");
        const bytes = await mergeAlternating(
          items.map((i) => i.bytes),
          {
            ...(selections.some((s) => s.pages)
              ? { pages: selections.map((s) => s.pages ?? undefined) }
              : {}),
            reverse: items.map((i) => i.reverse),
          },
        );
        return { bytes, contentsPages: 0 };
      }
      let contentsPages = 0;
      const bytes = await mergePdfs(
        items.map((i) => i.bytes),
        {
          // The defaults are passed as nothing at all, so a merge with no
          // option changed is the merge it always was.
          ...(selections.some((s) => s.pages)
            ? { pages: selections.map((s) => s.pages ?? undefined) }
            : {}),
          ...(fileBookmarks
            ? { fileBookmarks: items.map((i) => baseName(i.name)) }
            : {}),
          ...(contentsPage
            ? {
                contentsPage: items.map((i) => baseName(i.name)),
                onContentsPages: (n: number) => {
                  contentsPages = n;
                },
              }
            : {}),
        },
      );
      return { bytes, contentsPages };
    });

  const totalPages = items.reduce(
    (sum, item, i) => sum + (selections[i]?.pages?.length ?? item.pageCount),
    0,
  );

  if (result) {
    return (
      <ResultPanel
        title="PDFs merged"
        summary={`${items.length} files combined into one PDF · ${totalPages + (merged?.contentsPages ?? 0)} pages${merged?.contentsPages ? ` (${merged.contentsPages} contents)` : ""} · ${formatBytes(result.byteLength)}`}
        onReset={startOver}
        output={outputFile(result, mergedOutputName(items.map((i) => i.name)))}
        // The list and its order stay: clearing the result shows them again.
        onAdjust={reset}
        // Every page of every file, in one document — a re-count that
        // differs is said on the receipt.
        expectedPages={totalPages + (merged?.contentsPages ?? 0)}
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
          pageTarget
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
        <HandoffLoadedBadge
          origin={handoff.origin}
          count={handoff.files.length}
          skipped={handoff.skipped}
        />
      )}
      <div
        role="group"
        aria-label="Sort files"
        className="flex flex-wrap items-center gap-2 text-xs"
      >
        <span className="text-muted">Sort</span>
        <span className="border-line bg-wash rounded-ctl inline-flex flex-wrap gap-1 border p-1">
          {MERGE_SORTS.map((sort) => (
            <button
              key={sort}
              type="button"
              onClick={() => sortBy(sort)}
              className="text-muted hover:text-fg hover:bg-panel rounded-tag inline-flex h-11 items-center px-3 font-medium transition"
            >
              {MERGE_SORT_LABEL[sort]}
            </button>
          ))}
        </span>
      </div>
      <div
        role="radiogroup"
        aria-label="Page order"
        className="flex flex-wrap items-center gap-2 text-xs"
      >
        <span className="text-muted">Page order</span>
        <span className="border-line bg-wash rounded-ctl inline-flex flex-wrap gap-1 border p-1">
          {MERGE_MODES.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={mode === option}
              onClick={() => setMode(option)}
              className={cn(
                // 44 px tall: the phone pass measures every radio in the
                // panel, and this one is a thumb's target on a phone.
                "rounded-tag inline-flex h-11 items-center px-3 font-medium transition",
                mode === option
                  ? "bg-panel text-fg"
                  : "text-muted hover:text-fg hover:bg-panel",
              )}
            >
              {MERGE_MODE_LABEL[option]}
            </button>
          ))}
        </span>
        {alternate && (
          <span className="text-muted w-full">
            One page from each file in turn, top file first; a longer
            file&apos;s extra pages go at the end. For a double-sided scan, tick
            Reverse page order on a backs file scanned last page first.
          </span>
        )}
      </div>
      <RunnerSection
        title={`${items.length} file${items.length === 1 ? "" : "s"} · ${totalPages} pages`}
        aside={
          ordered ? (
            <OrderNote note={ordered} onKeep={keepDropOrder} />
          ) : (
            <span className="text-muted text-xs">
              Drag to reorder · top to bottom
            </span>
          )
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
                "bg-panel rounded-panel flex flex-wrap items-center gap-x-3 gap-y-2 border px-3 py-2.5 transition",
                overIndex === index && dragIndex !== null && dragIndex !== index
                  ? "border-accent/40 ring-accent/50 ring-1"
                  : "border-line",
                dragIndex === index && "opacity-50",
              )}
            >
              <GripVertical
                className="text-muted size-4 shrink-0 cursor-grab"
                aria-hidden
              />
              <span className="bg-wash text-muted rounded-tag tnum grid size-6 shrink-0 place-items-center text-xs font-semibold">
                {index + 1}
              </span>
              <span className="bg-wash ring-line rounded-sheet grid size-9 shrink-0 place-items-center overflow-hidden ring-1">
                {item.cover ? (
                  <img
                    src={item.cover.url}
                    alt=""
                    draggable={false}
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <FileText className="text-accent size-4" aria-hidden />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-fg block truncate text-sm">
                  {item.name}
                </span>
                <span className="text-muted block truncate text-xs">
                  {item.pageCount} page{item.pageCount === 1 ? "" : "s"} ·{" "}
                  {formatBytes(item.size)}
                </span>
              </span>
              <span className="tap-line flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(index, index - 1)}
                  aria-disabled={index === 0 || undefined}
                  aria-label={`Move ${item.name} up`}
                  className="text-muted hover:bg-wash hover:text-fg rounded-ctl tap grid size-7 place-items-center transition aria-disabled:cursor-not-allowed aria-disabled:opacity-30"
                >
                  <ArrowUp className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, index + 1)}
                  aria-disabled={index === items.length - 1 || undefined}
                  aria-label={`Move ${item.name} down`}
                  className="text-muted hover:bg-wash hover:text-fg rounded-ctl tap grid size-7 place-items-center transition aria-disabled:cursor-not-allowed aria-disabled:opacity-30"
                >
                  <ArrowDown className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => removeAt(index)}
                  aria-label={`Remove ${item.name}`}
                  className="text-muted hover:bg-err/10 hover:text-err rounded-ctl tap grid size-7 place-items-center transition"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </span>
              <PageSelection
                id={`${rangeIdBase}-${item.id}`}
                item={item}
                error={selections[index]?.error ?? null}
                onChange={(range) => setRange(item.id, range)}
              />
              {alternate && (
                <label className="text-muted flex w-full items-center gap-2 pl-7 text-xs sm:pl-28">
                  <input
                    type="checkbox"
                    checked={item.reverse}
                    onChange={(e) => setReverse(item.id, e.target.checked)}
                    aria-label={`Reverse the page order of ${item.name}`}
                  />
                  Reverse page order
                </label>
              )}
            </li>
          ))}
          {/* The row a file is read into, at a file row's height: a 36 px
              box between the same padding, and the row's two lines held to
              one each (`truncate` above). Shorter, the file row that
              replaces it pushed "Add more PDFs" down — 60 px at 360 wide,
              where the size line wrapped to four — counted after a drop
              (`e2e/editor-arrival.spec.ts`). */}
          {/* It also holds the Pages line every file row ends with (2026-10-25):
              without it the file row arrived 34 px taller and moved both
              option checkboxes below — 0.0115 at 390 x 844, over the 0.01
              bound, once "Add a contents page" doubled the area it moved. */}
          {loading > 0 && (
            <li className="bg-panel border-line text-muted rounded-panel flex flex-wrap items-center gap-x-3 gap-y-2 border px-3 py-2.5 text-sm">
              <span className="grid size-9 shrink-0 place-items-center">
                <Spinner />
              </span>
              Reading {loading} file{loading === 1 ? "" : "s"}…
              {/* On a touch screen the file row's 44 px buttons take a line
                  of their own (`tap-line`): this holds it. Nothing on a
                  mouse, where they sit beside the name. */}
              <span aria-hidden className="tap-line invisible flex">
                <span className="tap block" />
              </span>
              <span
                aria-hidden
                className="invisible flex w-full pl-7 text-xs sm:pl-28"
              >
                <span className="rounded-ctl border px-2.5 py-1">Pages</span>
              </span>
            </li>
          )}
        </ul>
      </RunnerSection>

      <Dropzone
        pageTarget
        busy={busy}
        onFiles={addFiles}
        multiple
        compact
        browse={false}
        title="Add more PDFs"
        hint="Drop files or click to browse"
      />

      {alternate ? (
        <p className="text-muted text-xs">
          With alternating pages a file no longer has one first page, so a
          bookmark for each file and a contents page are not offered. Bookmarks
          already in your files are kept.
        </p>
      ) : (
        <>
          <label
            htmlFor={bookmarksId}
            className="text-fg flex items-start gap-2 text-sm"
          >
            <input
              id={bookmarksId}
              type="checkbox"
              checked={fileBookmarks}
              onChange={(e) => setFileBookmarks(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Add a bookmark for each file
              <span className="text-muted block text-xs">
                Named after the file, opening its first page. Bookmarks already
                in your files are kept either way; with this on, they sit under
                their file&apos;s bookmark.
              </span>
            </span>
          </label>

          <label
            htmlFor={contentsId}
            className="text-fg flex items-start gap-2 text-sm"
          >
            <input
              id={contentsId}
              type="checkbox"
              checked={contentsPage}
              onChange={(e) => setContentsPage(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Add a contents page
              <span className="text-muted block text-xs">
                A first page listing each file by name with the page it starts
                on; click a line to go there. It follows the order and pages
                chosen above.
              </span>
            </span>
          </label>
        </>
      )}

      {rejectionsPanel}
      {error && <ErrorNote message={error} />}

      <RunBar>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted inline-flex items-center gap-1.5 text-xs">
            <Layers className="text-accent size-3.5" aria-hidden />
            {alternate
              ? "Pages alternate between the files shown above."
              : "Files are combined in the order shown above."}
          </p>
          <RunReason
            reason={
              items.length < 2 || selectionError
                ? items.length === 0
                  ? "Add at least two PDFs first."
                  : items.length === 1
                    ? "Add one more PDF first."
                    : selectionError
                      ? "Fix the page range above first."
                      : null
                : null
            }
          >
            {(describedBy) => (
              <RunButton
                onClick={onMerge}
                busy={busy}
                describedBy={describedBy}
                disabled={items.length < 2 || selectionError}
                busyLabel="Merging…"
              >
                <Plus className="size-4" aria-hidden />
                Merge {items.length} PDF{items.length === 1 ? "" : "s"}
              </RunButton>
            )}
          </RunReason>
        </div>
      </RunBar>
    </div>
  );
}

/**
 * One file's page selection, under its row: empty takes every page. The row
 * wraps it onto its own line, so a 375 px screen keeps the name readable.
 */
function PageSelection({
  id,
  item,
  error,
  onChange,
}: {
  id: string;
  item: MergeItem;
  error: string | null;
  onChange: (range: string) => void;
}) {
  return (
    <div className="flex w-full flex-col gap-1 pl-7 sm:pl-28">
      <span className="flex items-center gap-2">
        <label htmlFor={id} className="text-muted shrink-0 text-xs">
          Pages
        </label>
        <input
          id={id}
          type="text"
          value={item.range}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`All (1-${item.pageCount})`}
          spellCheck={false}
          aria-label={`Pages of ${item.name} to merge, e.g. 1-3, 5 — empty for all`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          draggable={false}
          onDragStart={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className={cn(
            "bg-canvas/60 text-fg focus:border-accent/40 focus:ring-accent/50 rounded-ctl min-w-0 flex-1 border px-2.5 py-1 text-xs transition outline-none focus:ring-2 sm:max-w-56",
            error ? "border-err/60" : "border-line",
          )}
        />
      </span>
      {error && (
        <span id={`${id}-error`} className="text-err text-xs">
          {error}
        </span>
      )}
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
      className="border-warn/40 bg-warn/10 text-warn rounded-panel flex flex-col gap-2 border px-4 py-3 text-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex items-center gap-2 font-medium">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {rejections.length} file{rejections.length === 1 ? "" : "s"}{" "}
          couldn&apos;t be added
        </span>
        <button
          type="button"
          onClick={onDismiss}
          className="text-warn hover:bg-warn/10 hover:text-warn rounded-ctl shrink-0 px-2 py-0.5 text-xs transition"
        >
          Dismiss
        </button>
      </div>
      <ul className="text-warn flex flex-col gap-1 pl-6 text-xs">
        {rejections.map((r, i) => {
          // The file's fix, when its refusal names one: Unlock PDF for a
          // locked file — the other files stay in the list meanwhile.
          const remedy = r.cause ? remedyFor(r.cause, "merge-pdf") : null;
          return (
            <li key={`${r.name}-${i}`} className={cn("list-disc", NAME_WRAP)}>
              <span className="text-warn font-medium">{r.name}</span> —{" "}
              {r.reason}
              {remedy && (
                <>
                  {" "}
                  <Link
                    href={remedy.href}
                    className="font-semibold underline underline-offset-2"
                  >
                    {remedy.label}
                  </Link>{" "}
                  {remedy.why}.
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
