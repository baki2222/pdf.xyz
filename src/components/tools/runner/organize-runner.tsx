"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
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
  useAnnouncer,
  useAsyncRun,
} from "./runner-kit";
import { PageTile, TileAction } from "./page-tile";
import { FileHeader, SinglePdfRunner } from "./single-pdf-runner";
import { usePdfThumbnails } from "./use-pdf-thumbnails";
import {
  canRedo,
  canUndo,
  initHistory,
  isDirty,
  organizeReducer,
  type OrganizeItem,
} from "./organize-history";
import type { LoadedPdf } from "./use-single-pdf";

export function OrganizeRunner() {
  return (
    <SinglePdfRunner hint="One PDF · reorder, rotate, duplicate, or delete pages">
      {(pdf, reset) => <OrganizeEditor pdf={pdf} onReset={reset} />}
    </SinglePdfRunner>
  );
}

function OrganizeEditor({ pdf, onReset }: { pdf: LoadedPdf; onReset: () => void }) {
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
  const { busy, error, result, run } = useAsyncRun<Uint8Array>();
  const { announce, node: announcer } = useAnnouncer();
  const { thumbs, rendered, status, capped, eagerCount, requestPage } =
    usePdfThumbnails(pdf.bytes, pdf.pageCount);

  const dirty = isDirty(items, initial);
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
    const src = items[from]?.sourceIndex ?? 0;
    dispatch({ type: "move", from, to });
    announce(`Moved page ${src + 1} to position ${to + 1} of ${items.length}.`);
  };

  const rotateItem = (index: number) =>
    dispatch({ type: "rotate", index, delta: 90 });

  const duplicateItem = (index: number) => {
    dispatch({ type: "duplicate", index, uid: `d${uidRef.current++}` });
    announce(`Duplicated page ${(items[index]?.sourceIndex ?? 0) + 1}.`);
  };

  const deleteItem = (index: number) => {
    if (items.length <= 1) return;
    dispatch({ type: "delete", index });
    announce(`Deleted page ${(items[index]?.sourceIndex ?? 0) + 1}.`);
  };

  const onHandleKeyDown =
    (item: OrganizeItem, i: number) => (e: React.KeyboardEvent) => {
      const n = items.length;
      const src = item.sourceIndex + 1;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (grabbedUid === item.uid) {
          setGrabbedUid(null);
          announce(`Dropped page ${src} at position ${i + 1} of ${n}.`);
        } else {
          setGrabbedUid(item.uid);
          announce(`Grabbed page ${src}. Use arrow keys to move, Enter to drop.`);
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
          announce(`Moved page ${src} to position ${target + 1} of ${n}.`);
        }
      } else {
        const to = i + delta;
        if (to >= 0 && to < n) {
          dispatch({ type: "moveUidBy", uid: item.uid, delta });
          announce(`Moved page ${src} to position ${to + 1} of ${n}.`);
        }
      }
    };

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
      {announcer}
      <FileHeader pdf={pdf} />

      <RunnerSection
        title="Arrange pages"
        aside={
          <span className="text-xs text-slate-500">
            {items.length} page{items.length === 1 ? "" : "s"} in output
          </span>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <ChipButton onClick={doUndo} disabled={!undoable} title="Undo (Ctrl/⌘+Z)">
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
          <span className="mx-1 h-4 w-px bg-white/10" aria-hidden />
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
        className="grid max-h-[58vh] list-none grid-cols-2 gap-3 overflow-auto rounded-2xl border border-white/10 bg-white/[0.015] p-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
      >
        {items.map((item, i) => (
          <PageTile
            key={item.uid}
            label={`Page ${item.sourceIndex + 1}`}
            ariaLabel={`Page ${item.sourceIndex + 1}, position ${i + 1} of ${items.length}`}
            rotation={item.rotation}
            thumbnail={thumbs[item.sourceIndex]}
            loading={status === "rendering"}
            onEnterView={
              capped ? () => requestPage(item.sourceIndex) : undefined
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
            dropTarget={overIndex === i && dragIndex !== null && dragIndex !== i}
            dimmed={dragIndex === i}
            dragHandle={{
              grabbed: grabbedUid === item.uid,
              label:
                grabbedUid === item.uid
                  ? `Page ${item.sourceIndex + 1}, position ${i + 1} of ${items.length}. Grabbed — arrow keys move, Enter drops, Escape cancels.`
                  : `Reorder page ${item.sourceIndex + 1}, position ${i + 1} of ${items.length}. Press Enter or Space to grab.`,
              onToggle: () =>
                setGrabbedUid((g) => (g === item.uid ? null : item.uid)),
              onKeyDown: onHandleKeyDown(item, i),
            }}
            actions={
              <>
                <TileAction
                  title={`Move page ${item.sourceIndex + 1} left`}
                  onClick={() => move(i, i - 1)}
                  disabled={i === 0}
                >
                  <ArrowLeft className="size-3.5" aria-hidden />
                </TileAction>
                <TileAction
                  title={`Rotate page ${item.sourceIndex + 1} right`}
                  onClick={() => rotateItem(i)}
                >
                  <RotateCw className="size-3.5" aria-hidden />
                </TileAction>
                <TileAction
                  title={`Duplicate page ${item.sourceIndex + 1}`}
                  onClick={() => duplicateItem(i)}
                >
                  <Copy className="size-3.5" aria-hidden />
                </TileAction>
                <TileAction
                  title={`Delete page ${item.sourceIndex + 1}`}
                  onClick={() => deleteItem(i)}
                  disabled={items.length === 1}
                  danger
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </TileAction>
                <TileAction
                  title={`Move page ${item.sourceIndex + 1} right`}
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

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-500">
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
    </div>
  );
}
