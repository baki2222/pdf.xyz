"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BetweenVerticalEnd,
  BetweenVerticalStart,
  Copy,
  Download,
  FlipVertical2,
  RefreshCw,
  Redo2,
  RotateCw,
  Trash2,
  Undo2,
} from "lucide-react";
import { organizePages } from "@/lib/pdf/engine";
import { getUprightPageSizes } from "@/lib/pdf/crop";
import { downloadBytes } from "@/lib/pdf/browser";
import { outputName } from "@/lib/pdf/files";
import { buttonVariants } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";
import {
  ChipButton,
  ErrorNote,
  PreviewStatus,
  ResultPanel,
  RunButton,
  RunnerSection,
  outputFile,
  useAnnouncer,
  useAsyncRun,
} from "./runner-kit";
import { RunBar } from "./run-bar";
import { useUnsavedGuard } from "./use-unsaved-guard";
import { PageTile, TileAction } from "./page-tile";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import { usePdfThumbnails } from "./use-pdf-thumbnails";
import {
  canRedo,
  canUndo,
  initHistory,
  isDirty,
  organizeReducer,
  sourcePageCount,
  type OrganizeItem,
  type PageSize,
} from "./organize-history";
import type { LoadedPdf } from "./use-single-pdf";

/** How a tile and its announcements name an entry: "Page 3", "Blank page". */
function nameOf(item: OrganizeItem, capital = true): string {
  if (item.blank) return capital ? "Blank page" : "blank page";
  return `${capital ? "Page" : "page"} ${item.sourceIndex + 1}`;
}

export function OrganizeRunner() {
  return (
    <SinglePdfRunner
      hint="One PDF · reorder, rotate, duplicate, delete, or add blank pages"
      handoffSlug="organize-pages"
      toolName="Organize Pages"
    >
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

  const [history, dispatch] = useReducer(organizeReducer, initial, initHistory);
  const items = history.present;
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [grabbedUid, setGrabbedUid] = useState<string | null>(null);
  const uidRef = useRef(pdf.pageCount);
  const { busy, error, result, run, reset } = useAsyncRun<Uint8Array>();
  const { announce, node: announcer } = useAnnouncer();
  const { thumbs, rendered, status, capped, eagerCount, requestPage } =
    usePdfThumbnails(pdf.bytes, pdf.pageCount);

  // Every source page's upright size, so an inserted blank can match the tile
  // it goes beside. Read once per file (the editor is keyed by file); the
  // insert buttons wait for it rather than guess a size.
  const [sizes, setSizes] = useState<PageSize[] | null>(null);
  useEffect(() => {
    let alive = true;
    getUprightPageSizes(pdf.bytes)
      .then((read) => {
        if (alive) setSizes(read);
      })
      .catch(() => {
        // Without sizes there is nothing to match, so insert stays disabled.
      });
    return () => {
      alive = false;
    };
  }, [pdf.bytes]);

  const dirty = isDirty(items, initial);
  useUnsavedGuard(dirty && !result, "your new page order");
  const undoable = canUndo(history);
  const redoable = canRedo(history);

  const doUndo = () => {
    if (!undoable) return;
    dispatch({ type: "undo" });
    announce("Undo.");
  };
  const doRedo = () => {
    if (!redoable) return;
    dispatch({ type: "redo" });
    announce("Redo.");
  };

  // Ctrl/⌘+Z to undo, Ctrl/⌘+Shift+Z or Ctrl+Y to redo — while the editor is
  // mounted and focus isn't in a text field (this editor has none, but guard
  // anyway so the shortcut is safe to own globally). `dispatch` is stable; we
  // re-bind on `history` changes so canUndo/canRedo read the current timeline.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        if (canUndo(history)) {
          dispatch({ type: "undo" });
          announce("Undo.");
        }
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        if (canRedo(history)) {
          dispatch({ type: "redo" });
          announce("Redo.");
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [history, announce]);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || to === from) return;
    const item = items[from];
    if (!item) return;
    dispatch({ type: "move", from, to });
    announce(
      `Moved ${nameOf(item, false)} to position ${to + 1} of ${items.length}.`,
    );
  };

  const rotateItem = (index: number) =>
    dispatch({ type: "rotate", index, delta: 90 });

  const duplicateItem = (index: number) => {
    const item = items[index];
    if (!item) return;
    dispatch({ type: "duplicate", index, uid: `d${uidRef.current++}` });
    announce(`Duplicated ${nameOf(item, false)}.`);
  };

  const deleteItem = (index: number) => {
    const item = items[index];
    if (!item || !canDelete(item)) return;
    dispatch({ type: "delete", index });
    announce(`Deleted ${nameOf(item, false)}.`);
  };

  const canDelete = (item: OrganizeItem) =>
    Boolean(item.blank) || sourcePageCount(items) > 1;

  const insertBlank = (index: number, side: "before" | "after") => {
    const item = items[index];
    if (!item || !sizes) return;
    dispatch({
      type: "insertBlank",
      index,
      side,
      uid: `b${uidRef.current++}`,
      sizes,
    });
    announce(`Inserted a blank page ${side} ${nameOf(item, false)}.`);
  };

  const onHandleKeyDown =
    (item: OrganizeItem, i: number) => (e: React.KeyboardEvent) => {
      const n = items.length;
      const src = nameOf(item, false);
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (grabbedUid === item.uid) {
          setGrabbedUid(null);
          announce(`Dropped ${src} at position ${i + 1} of ${n}.`);
        } else {
          setGrabbedUid(item.uid);
          announce(`Grabbed ${src}. Use arrow keys to move, Enter to drop.`);
        }
        return;
      }
      if (e.key === "Escape") {
        if (grabbedUid === item.uid) {
          e.preventDefault();
          setGrabbedUid(null);
          announce("Move cancelled.");
        }
        return;
      }
      if (grabbedUid !== item.uid) return;

      let target = -1;
      let delta = 0;
      switch (e.key) {
        case "ArrowLeft":
        case "ArrowUp":
          delta = -1;
          break;
        case "ArrowRight":
        case "ArrowDown":
          delta = 1;
          break;
        case "Home":
          target = 0;
          break;
        case "End":
          target = n - 1;
          break;
        default:
          return;
      }
      e.preventDefault();
      if (target >= 0) {
        if (target !== i) {
          dispatch({ type: "moveUidTo", uid: item.uid, index: target });
          announce(`Moved ${src} to position ${target + 1} of ${n}.`);
        }
      } else {
        const to = i + delta;
        if (to >= 0 && to < n) {
          dispatch({ type: "moveUidBy", uid: item.uid, delta });
          announce(`Moved ${src} to position ${to + 1} of ${n}.`);
        }
      }
    };

  const onRun = () =>
    run(() =>
      organizePages(
        pdf.bytes,
        items.map(({ sourceIndex, rotation, blank }) =>
          blank ? { sourceIndex, rotation, blank } : { sourceIndex, rotation },
        ),
      ),
    );

  if (result) {
    return (
      <ResultPanel
        title="Pages organized"
        summary={`${items.length} page${items.length === 1 ? "" : "s"} in your new order · ${formatBytes(result.byteLength)}`}
        onReset={onReset}
        output={outputFile(result, outputName(pdf.file.name, "organized"))}
        onAdjust={reset}
        expectedPages={items.length}
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
      {announcer}
      <FileHeader pdf={pdf} />

      <RunnerSection
        title="Arrange pages"
        aside={
          <span className="text-muted text-xs">
            {items.length} page{items.length === 1 ? "" : "s"} in output
          </span>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <ChipButton
            onClick={doUndo}
            disabled={!undoable}
            title="Undo (Ctrl/⌘+Z)"
          >
            <Undo2 className="size-3.5" aria-hidden />
            Undo
          </ChipButton>
          <ChipButton
            onClick={doRedo}
            disabled={!redoable}
            title="Redo (Ctrl/⌘+Shift+Z)"
          >
            <Redo2 className="size-3.5" aria-hidden />
            Redo
          </ChipButton>
          <span className="bg-wash mx-1 h-4 w-px" aria-hidden />
          <ChipButton
            onClick={() => {
              dispatch({ type: "reverse" });
              announce("Reversed page order.");
            }}
          >
            <FlipVertical2 className="size-3.5" aria-hidden />
            Reverse
          </ChipButton>
          <ChipButton
            onClick={() => {
              dispatch({ type: "reset", items: initial });
              setGrabbedUid(null);
              announce("Reset to the original order.");
            }}
            disabled={!dirty}
          >
            <RefreshCw className="size-3.5" aria-hidden />
            Reset
          </ChipButton>
        </div>
      </RunnerSection>

      <PreviewStatus
        rendered={rendered}
        total={pdf.pageCount}
        status={status}
        capped={capped}
        eager={eagerCount}
      />

      <ul
        role="list"
        aria-label="Pages — drag a tile, use its move buttons, or grab its handle and use the arrow keys to reorder"
        className="border-line bg-wash rounded-panel grid max-h-[58vh] list-none grid-cols-2 gap-3 overflow-auto border p-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
      >
        {items.map((item, i) => (
          <PageTile
            key={item.uid}
            label={nameOf(item)}
            ariaLabel={`${nameOf(item)}, position ${i + 1} of ${items.length}`}
            rotation={item.rotation}
            thumbnail={item.blank ? undefined : thumbs[item.sourceIndex]}
            blankSheet={item.blank}
            loading={status === "rendering"}
            onEnterView={
              capped && !item.blank
                ? () => requestPage(item.sourceIndex)
                : undefined
            }
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
            dropTarget={
              overIndex === i && dragIndex !== null && dragIndex !== i
            }
            dimmed={dragIndex === i}
            dragHandle={{
              grabbed: grabbedUid === item.uid,
              label:
                grabbedUid === item.uid
                  ? `${nameOf(item)}, position ${i + 1} of ${items.length}. Grabbed — arrow keys move, Enter drops, Escape cancels.`
                  : `Reorder ${nameOf(item, false)}, position ${i + 1} of ${items.length}. Press Enter or Space to grab.`,
              onToggle: () =>
                setGrabbedUid((g) => (g === item.uid ? null : item.uid)),
              onKeyDown: onHandleKeyDown(item, i),
            }}
            actions={
              <>
                <TileAction
                  title={`Move ${nameOf(item, false)} left`}
                  onClick={() => move(i, i - 1)}
                  disabled={i === 0}
                >
                  <ArrowLeft className="size-3.5" aria-hidden />
                </TileAction>
                <TileAction
                  title={`Rotate ${nameOf(item, false)} right`}
                  onClick={() => rotateItem(i)}
                >
                  <RotateCw className="size-3.5" aria-hidden />
                </TileAction>
                <TileAction
                  title={`Duplicate ${nameOf(item, false)}`}
                  onClick={() => duplicateItem(i)}
                >
                  <Copy className="size-3.5" aria-hidden />
                </TileAction>
                <TileAction
                  title={`Delete ${nameOf(item, false)}`}
                  onClick={() => deleteItem(i)}
                  disabled={!canDelete(item)}
                  danger
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </TileAction>
                <TileAction
                  title={`Insert blank page before ${nameOf(item, false)}`}
                  onClick={() => insertBlank(i, "before")}
                  disabled={!sizes}
                >
                  <BetweenVerticalStart className="size-3.5" aria-hidden />
                </TileAction>
                <TileAction
                  title={`Insert blank page after ${nameOf(item, false)}`}
                  onClick={() => insertBlank(i, "after")}
                  disabled={!sizes}
                >
                  <BetweenVerticalEnd className="size-3.5" aria-hidden />
                </TileAction>
                <TileAction
                  title={`Move ${nameOf(item, false)} right`}
                  onClick={() => move(i, i + 1)}
                  disabled={i === items.length - 1}
                >
                  <ArrowRight className="size-3.5" aria-hidden />
                </TileAction>
              </>
            }
          />
        ))}
      </ul>

      {error && <ErrorNote message={error} />}

      <RunBar>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted text-xs">
            Badge shows the new position; label shows the original page. Grab a
            tile&apos;s handle and use arrow keys, or press Ctrl/⌘+Z to undo.
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
      </RunBar>
    </div>
  );
}
