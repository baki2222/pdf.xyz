"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  X,
} from "lucide-react";
import type { Thumbnail } from "@/lib/pdf/render-utils";
import { ChipButton } from "./runner-kit";
import { PageTile, TileAction } from "./page-tile";
import { usePdfThumbnails } from "./use-pdf-thumbnails";
import {
  canLeaveOut,
  moveKeyBy,
  moveKeyTo,
  rotateKey,
  setKeptKey,
  type MergePage,
} from "./merge-pages-state";

/**
 * Merge PDF's Arrange pages grid: every page of every file as one sortable
 * list (audit backlog #9, 2026-11-17). Organize Pages' pattern — pointer
 * drag, Move earlier / later buttons for touch, a keyboard grab on each
 * tile's handle — over the one page list the runner holds
 * (`merge-pages-state.ts`). Loaded only once Arrange pages is chosen
 * (`merge-page-grid-lazy.tsx`).
 */

export interface MergeGridFile {
  id: string;
  name: string;
  bytes: Uint8Array;
  pageCount: number;
}

export interface MergePageGridProps {
  pages: readonly MergePage[];
  files: readonly MergeGridFile[];
  /** Change the list; functional, so key repeat never reads a stale list. */
  update: (change: (pages: readonly MergePage[]) => MergePage[]) => void;
  announce: (message: string) => void;
  onReset: () => void;
  /** True when the list already is the file-order seed. */
  resetDisabled: boolean;
}

/**
 * One file's thumbnails, renderless: its pdf.js renderer opens only once a
 * tile of the file has come near the screen (`wanted`), one page at a time,
 * through the existing hook and its budgets. Unmounting it (the file removed,
 * page mode left) revokes every image and destroys the renderer.
 */
function FileThumbs({
  file,
  wanted,
  onThumbs,
}: {
  file: MergeGridFile;
  wanted: readonly number[];
  onThumbs: (id: string, thumbs: (Thumbnail | null)[] | null) => void;
}) {
  const { thumbs, requestPage } = usePdfThumbnails(file.bytes, file.pageCount, {
    eagerLimit: 0,
    enabled: wanted.length > 0,
  });
  // After the hook's own effect, so its request function is armed.
  useEffect(() => {
    for (const page of wanted) requestPage(page);
  }, [wanted, requestPage]);
  useEffect(() => {
    onThumbs(file.id, thumbs);
  }, [file.id, thumbs, onThumbs]);
  useEffect(() => () => onThumbs(file.id, null), [file.id, onThumbs]);
  return null;
}

export function MergePageGrid({
  pages,
  files,
  update,
  announce,
  onReset,
  resetDisabled,
}: MergePageGridProps) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [grabbedKey, setGrabbedKey] = useState<string | null>(null);
  const [wanted, setWanted] = useState<Record<string, number[]>>({});
  const [thumbs, setThumbs] = useState<
    Record<string, (Thumbnail | null)[] | undefined>
  >({});

  const onThumbs = useCallback(
    (id: string, list: (Thumbnail | null)[] | null) =>
      setThumbs((prev) => {
        if (list === null) {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        }
        return prev[id] === list ? prev : { ...prev, [id]: list };
      }),
    [],
  );
  const want = useCallback(
    (id: string, page: number) =>
      setWanted((prev) =>
        prev[id]?.includes(page)
          ? prev
          : { ...prev, [id]: [...(prev[id] ?? []), page] },
      ),
    [],
  );

  const fileOf = new Map(files.map((f) => [f.id, f]));
  const keptCount = pages.filter((p) => p.kept).length;
  /** Merged-PDF page number of each kept page, by key. */
  const merged = new Map<string, number>();
  for (const p of pages) if (p.kept) merged.set(p.key, merged.size + 1);

  const nameOf = (p: MergePage) =>
    `page ${p.pageIndex + 1} of ${fileOf.get(p.fileId)?.name ?? "a file"}`;
  /** Where a page lands in the merged PDF, said after a move. */
  const placeOf = (list: readonly MergePage[], key: string) => {
    let n = 0;
    for (const p of list) {
      if (p.kept) n += 1;
      if (p.key === key) return p.kept ? n : null;
    }
    return null;
  };
  const sayMoved = (page: MergePage, next: readonly MergePage[]) => {
    const at = placeOf(next, page.key);
    announce(
      at === null
        ? `Moved ${nameOf(page)}.`
        : `Moved ${nameOf(page)} to page ${at} of ${keptCount} in the merged PDF.`,
    );
  };

  const moveTo = (page: MergePage, index: number) => {
    const from = pages.findIndex((p) => p.key === page.key);
    if (index < 0 || index >= pages.length || index === from) return;
    const next = moveKeyTo(pages, page.key, index);
    update((list) => moveKeyTo(list, page.key, index));
    sayMoved(page, next);
  };
  const moveBy = (page: MergePage, delta: number) => {
    const from = pages.findIndex((p) => p.key === page.key);
    const to = from + delta;
    if (to < 0 || to >= pages.length) return;
    const next = moveKeyBy(pages, page.key, delta);
    update((list) => moveKeyBy(list, page.key, delta));
    sayMoved(page, next);
  };
  const turn = (page: MergePage, delta: number) => {
    const next = rotateKey(pages, page.key, delta);
    const rotation = next.find((p) => p.key === page.key)?.rotation ?? 0;
    update((list) => rotateKey(list, page.key, delta));
    announce(`Rotated ${nameOf(page)} to ${rotation}°.`);
  };
  const setKept = (page: MergePage, kept: boolean) => {
    if (!kept && !canLeaveOut(pages, page.key)) return;
    update((list) => setKeptKey(list, page.key, kept));
    announce(`${kept ? "Put back" : "Left out"} ${nameOf(page)}.`);
  };

  const onHandleKeyDown = (page: MergePage) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (grabbedKey === page.key) {
        setGrabbedKey(null);
        const at = placeOf(pages, page.key);
        announce(
          at === null
            ? `Dropped ${nameOf(page)}.`
            : `Dropped ${nameOf(page)} at page ${at} of ${keptCount} in the merged PDF.`,
        );
      } else {
        setGrabbedKey(page.key);
        announce(
          `Grabbed ${nameOf(page)}. Use arrow keys to move, Enter to drop.`,
        );
      }
      return;
    }
    if (e.key === "Escape") {
      if (grabbedKey === page.key) {
        e.preventDefault();
        setGrabbedKey(null);
        announce("Move cancelled.");
      }
      return;
    }
    if (grabbedKey !== page.key) return;
    switch (e.key) {
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        moveBy(page, -1);
        return;
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        moveBy(page, 1);
        return;
      case "Home":
        e.preventDefault();
        moveTo(page, 0);
        return;
      case "End":
        e.preventDefault();
        moveTo(page, pages.length - 1);
        return;
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {files.map((file) => (
        <FileThumbs
          key={file.id}
          file={file}
          wanted={wanted[file.id] ?? EMPTY}
          onThumbs={onThumbs}
        />
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <ChipButton
          onClick={() => {
            setGrabbedKey(null);
            onReset();
          }}
          disabled={resetDisabled}
        >
          <RefreshCw className="size-3.5" aria-hidden />
          Reset to file order
        </ChipButton>
      </div>
      <ul
        role="list"
        aria-label="Pages of every file, in merged order: drag a tile, use its move buttons, or grab its handle and use the arrow keys"
        className="border-line bg-wash rounded-panel grid max-h-[58vh] list-none grid-cols-2 gap-3 overflow-auto border p-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
      >
        {pages.map((page, i) => {
          const file = fileOf.get(page.fileId);
          const name = file?.name ?? "";
          const at = merged.get(page.key);
          const label = `Page ${page.pageIndex + 1} of ${name}`;
          const where = at
            ? `${label}, page ${at} of ${keptCount} in the merged PDF`
            : `${label}, left out`;
          const lastKept = page.kept && !canLeaveOut(pages, page.key);
          return (
            <PageTile
              key={page.key}
              style={TILE_STYLE}
              label={
                <>
                  Page {page.pageIndex + 1}
                  <span
                    title={name}
                    className="text-muted block truncate text-center text-[10px] font-normal"
                    style={CAPTION_STYLE}
                  >
                    {name}
                  </span>
                </>
              }
              ariaLabel={where}
              rotation={page.rotation}
              thumbnail={thumbs[page.fileId]?.[page.pageIndex] ?? null}
              onEnterView={() => want(page.fileId, page.pageIndex)}
              cornerBadge={at}
              draggable
              onDragStart={() => setDragKey(page.key)}
              onDragOver={(e) => {
                e.preventDefault();
                setOverKey(page.key);
              }}
              onDrop={() => {
                const dragged = pages.find((p) => p.key === dragKey);
                if (dragged) moveTo(dragged, i);
                setDragKey(null);
                setOverKey(null);
              }}
              onDragEnd={() => {
                setDragKey(null);
                setOverKey(null);
              }}
              dropTarget={
                overKey === page.key && dragKey !== null && dragKey !== page.key
              }
              dimmed={dragKey === page.key || !page.kept}
              dragHandle={{
                grabbed: grabbedKey === page.key,
                label:
                  grabbedKey === page.key
                    ? `${where}. Grabbed: arrow keys move, Enter drops, Escape cancels.`
                    : `Reorder ${nameOf(page)}, ${at ? `page ${at} of ${keptCount} in the merged PDF` : "left out"}. Press Enter or Space to grab.`,
                onToggle: () =>
                  setGrabbedKey((g) => (g === page.key ? null : page.key)),
                onKeyDown: onHandleKeyDown(page),
              }}
              actions={
                <>
                  <TileAction
                    title={`Move ${nameOf(page)} earlier`}
                    onClick={() => moveBy(page, -1)}
                    disabled={i === 0}
                  >
                    <ArrowLeft className="size-3.5" aria-hidden />
                  </TileAction>
                  <TileAction
                    title={`Rotate ${nameOf(page)} left`}
                    onClick={() => turn(page, -90)}
                  >
                    <RotateCcw className="size-3.5" aria-hidden />
                  </TileAction>
                  <TileAction
                    title={`Rotate ${nameOf(page)} right`}
                    onClick={() => turn(page, 90)}
                  >
                    <RotateCw className="size-3.5" aria-hidden />
                  </TileAction>
                  {page.kept ? (
                    <TileAction
                      title={
                        lastKept
                          ? `Keep at least one page of ${name}, or remove the file`
                          : `Leave out ${nameOf(page)}`
                      }
                      onClick={() => setKept(page, false)}
                      disabled={lastKept}
                      danger
                    >
                      <X className="size-3.5" aria-hidden />
                    </TileAction>
                  ) : (
                    <TileAction
                      title={`Put back ${nameOf(page)}`}
                      onClick={() => setKept(page, true)}
                    >
                      <Plus className="size-3.5" aria-hidden />
                    </TileAction>
                  )}
                  <TileAction
                    title={`Move ${nameOf(page)} later`}
                    onClick={() => moveBy(page, 1)}
                    disabled={i === pages.length - 1}
                  >
                    <ArrowRight className="size-3.5" aria-hidden />
                  </TileAction>
                </>
              }
            />
          );
        })}
      </ul>
    </div>
  );
}

const EMPTY: readonly number[] = [];

/**
 * Off-screen tiles skip layout and paint (a 300-page merge stays quick);
 * every tile still exists, so focus, the keyboard grab, drop targets and the
 * lazy-preview observer keep working. Inline: the stylesheet takes no new
 * class names.
 */
const TILE_STYLE = {
  contentVisibility: "auto",
  containIntrinsicSize: "auto 220px",
} as const;

/** The file name under a tile, held to the tile's width. */
const CAPTION_STYLE = { maxWidth: "7.5rem" } as const;
