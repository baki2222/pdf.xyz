"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Undo2,
  X,
} from "lucide-react";
import type { Thumbnail } from "@/lib/pdf/render-utils";
import { ChipButton } from "./runner-kit";
import { PageTile, TileAction } from "./page-tile";
import { usePdfThumbnails } from "./use-pdf-thumbnails";
import { LazyPageZoomDialog, ZoomButton } from "./page-zoom-lazy";
import type { BoardPage } from "./page-zoom-dialog";
import {
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
 *
 * Built for a thousand pages (review of 2026-11-17, measured on 1,300):
 *  - each tile is memoised and every handler it gets is stable, so a
 *    thumbnail arriving or a page moving re-renders the tiles it changed,
 *    not all of them;
 *  - thumbnails are drawn newest request first, so the tiles on screen do
 *    not wait behind every tile already scrolled past;
 *  - the grid is ONE tab stop: Tab reaches one tile's buttons and leaves,
 *    and the arrow keys go from tile to tile (the page picker's roving tab
 *    stop), so the Merge button is a few presses away, not thousands.
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
  /** Brings back the order a Sort or Reset just threw away, while it can. */
  onUndo?: () => void;
}

/**
 * One file's thumbnails, renderless: its pdf.js renderer opens only once a
 * tile of the file has come near the screen (`wanted`), one page at a time,
 * through the existing hook and its budgets, the newest request first.
 * Unmounting it (the file removed, page mode left) revokes every image and
 * destroys the renderer.
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
    newestFirst: true,
  });
  // After the hook's own effect, so its request function is armed. The hook
  // never queues a page twice, so re-sending the list costs a lookup each.
  useEffect(() => {
    for (const page of wanted) requestPage(page);
  }, [wanted, requestPage]);
  useEffect(() => {
    onThumbs(file.id, thumbs);
  }, [file.id, thumbs, onThumbs]);
  useEffect(() => () => onThumbs(file.id, null), [file.id, onThumbs]);
  return null;
}

/** What every tile calls, by page key: one stable object for the grid. */
interface TileHandlers {
  moveBy: (key: string, delta: number) => void;
  turn: (key: string, delta: number) => void;
  setKept: (key: string, kept: boolean) => void;
  zoom: (key: string) => void;
  want: (fileId: string, pageIndex: number) => void;
  dragStart: (key: string) => void;
  dragOver: (key: string) => void;
  drop: (key: string) => void;
  dragEnd: () => void;
  toggleGrab: (key: string) => void;
  handleKey: (key: string, event: KeyboardEvent) => void;
}

interface TileProps {
  page: MergePage;
  /** 1-based place in the grid (left-out slots count). */
  position: number;
  fileName: string;
  /** Merged-PDF page number; undefined when left out. */
  at: number | undefined;
  keptCount: number;
  thumbnail: Thumbnail | null;
  first: boolean;
  last: boolean;
  /** The file's only kept page: it cannot be left out. */
  lastKept: boolean;
  grabbed: boolean;
  dropTarget: boolean;
  dragging: boolean;
  /** The grid's one tab stop. */
  active: boolean;
  handlers: TileHandlers;
}

const MergeTile = memo(function MergeTile({
  page,
  position,
  fileName,
  at,
  keptCount,
  thumbnail,
  first,
  last,
  lastKept,
  grabbed,
  dropTarget,
  dragging,
  active,
  handlers: h,
}: TileProps) {
  const { key } = page;
  const label = `Page ${page.pageIndex + 1} of ${fileName}`;
  const name = `page ${page.pageIndex + 1} of ${fileName}`;
  const placed = at ? `page ${at} of ${keptCount} in the merged PDF` : null;
  const where = placed ? `${label}, ${placed}` : `${label}, left out`;
  const tab = active ? 0 : -1;
  return (
    <PageTile
      style={TILE_STYLE}
      label={
        <>
          Page {page.pageIndex + 1}
          <span
            title={fileName}
            className="text-muted block truncate text-center text-[10px] font-normal"
            style={CAPTION_STYLE}
          >
            {fileName}
          </span>
        </>
      }
      ariaLabel={where}
      rotation={page.rotation}
      thumbnail={thumbnail}
      onEnterView={() => h.want(page.fileId, page.pageIndex)}
      cornerBadge={at}
      draggable
      onDragStart={() => h.dragStart(key)}
      onDragOver={(e) => {
        e.preventDefault();
        h.dragOver(key);
      }}
      onDrop={() => h.drop(key)}
      onDragEnd={h.dragEnd}
      dropTarget={dropTarget}
      dimmed={dragging || !page.kept}
      dragHandle={{
        grabbed,
        tabIndex: tab,
        label: grabbed
          ? `${where}. Grabbed: arrow keys move, Enter drops, Escape puts it back.`
          : `Reorder ${name}, ${placed ?? "left out"}. Press Enter or Space to grab.`,
        onToggle: () => h.toggleGrab(key),
        onKeyDown: (e) => h.handleKey(key, e),
      }}
      actions={
        <>
          <TileAction
            title={`Move ${name} earlier`}
            onClick={() => h.moveBy(key, -1)}
            disabled={first}
            tabIndex={tab}
          >
            <ArrowLeft className="size-3.5" aria-hidden />
          </TileAction>
          <TileAction
            title={`Move ${name} later`}
            onClick={() => h.moveBy(key, 1)}
            disabled={last}
            tabIndex={tab}
          >
            <ArrowRight className="size-3.5" aria-hidden />
          </TileAction>
          <ZoomButton
            pageNumber={position}
            onClick={() => h.zoom(key)}
            tabIndex={tab}
          />
          <TileAction
            title={`Rotate ${name} left`}
            onClick={() => h.turn(key, -90)}
            tabIndex={tab}
          >
            <RotateCcw className="size-3.5" aria-hidden />
          </TileAction>
          <TileAction
            title={`Rotate ${name} right`}
            onClick={() => h.turn(key, 90)}
            tabIndex={tab}
          >
            <RotateCw className="size-3.5" aria-hidden />
          </TileAction>
          {page.kept ? (
            <TileAction
              title={
                lastKept
                  ? `Keep at least one page of ${fileName}, or remove the file`
                  : `Leave out ${name}`
              }
              onClick={() => h.setKept(key, false)}
              disabled={lastKept}
              danger
              tabIndex={tab}
            >
              <X className="size-3.5" aria-hidden />
            </TileAction>
          ) : (
            <TileAction
              title={`Put back ${name}`}
              onClick={() => h.setKept(key, true)}
              tabIndex={tab}
            >
              <Plus className="size-3.5" aria-hidden />
            </TileAction>
          )}
        </>
      }
    />
  );
});

export function MergePageGrid({
  pages,
  files,
  update,
  announce,
  onReset,
  resetDisabled,
  onUndo,
}: MergePageGridProps) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [grabbedKey, setGrabbedKey] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [zoomKey, setZoomKey] = useState<string | null>(null);
  const [wanted, setWanted] = useState<Record<string, number[]>>({});
  const [thumbs, setThumbs] = useState<
    Record<string, (Thumbnail | null)[] | undefined>
  >({});
  const listRef = useRef<HTMLUListElement>(null);
  /** Where the grabbed page was when grabbed: Escape puts it back. */
  const grabFrom = useRef<number>(-1);

  const fileOf = useMemo(() => new Map(files.map((f) => [f.id, f])), [files]);
  /** Merged-PDF page number of each kept page, and each file's kept count. */
  const { merged, keptOf } = useMemo(() => {
    const merged = new Map<string, number>();
    const keptOf = new Map<string, number>();
    for (const p of pages) {
      if (!p.kept) continue;
      merged.set(p.key, merged.size + 1);
      keptOf.set(p.fileId, (keptOf.get(p.fileId) ?? 0) + 1);
    }
    return { merged, keptOf };
  }, [pages]);
  const keptCount = merged.size;

  // The handlers read the latest render through this ref, so the object the
  // tiles hold never changes and a memoised tile is skipped.
  const latest = useRef({ pages, fileOf, merged, grabbedKey, dragKey });
  useEffect(() => {
    latest.current = { pages, fileOf, merged, grabbedKey, dragKey };
  });

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

  const handlers = useMemo<TileHandlers>(() => {
    const nameOf = (key: string) => {
      const p = latest.current.pages.find((q) => q.key === key);
      const file = p && latest.current.fileOf.get(p.fileId);
      return p ? `page ${p.pageIndex + 1} of ${file?.name ?? "a file"}` : "";
    };
    /** Where a page lands in the merged PDF, said after a move. */
    const placeOf = (list: readonly MergePage[], key: string) => {
      let n = 0;
      let total = 0;
      let at: number | null = null;
      for (const p of list) {
        if (p.kept) total += 1;
        if (p.kept) n += 1;
        if (p.key === key) at = p.kept ? n : null;
      }
      return at === null ? null : `page ${at} of ${total} in the merged PDF`;
    };
    const sayMoved = (key: string, next: readonly MergePage[]) => {
      const at = placeOf(next, key);
      announce(
        at === null
          ? `Moved ${nameOf(key)}.`
          : `Moved ${nameOf(key)} to ${at}.`,
      );
    };
    const moveTo = (key: string, index: number) => {
      const list = latest.current.pages;
      const from = list.findIndex((p) => p.key === key);
      if (from < 0 || index < 0 || index >= list.length || index === from)
        return;
      const next = moveKeyTo(list, key, index);
      latest.current = { ...latest.current, pages: next };
      update((l) => moveKeyTo(l, key, index));
      sayMoved(key, next);
    };
    return {
      moveBy: (key, delta) => {
        const from = latest.current.pages.findIndex((p) => p.key === key);
        if (from >= 0) moveTo(key, from + delta);
      },
      turn: (key, delta) => {
        const next = rotateKey(latest.current.pages, key, delta);
        const rotation = next.find((p) => p.key === key)?.rotation ?? 0;
        latest.current = { ...latest.current, pages: next };
        update((l) => rotateKey(l, key, delta));
        announce(`Rotated ${nameOf(key)} to ${rotation}°.`);
      },
      setKept: (key, kept) => {
        const list = latest.current.pages;
        const next = setKeptKey(list, key, kept);
        if (next.every((p, i) => p === list[i])) return;
        latest.current = { ...latest.current, pages: next };
        update((l) => setKeptKey(l, key, kept));
        announce(`${kept ? "Put back" : "Left out"} ${nameOf(key)}.`);
      },
      zoom: (key) => setZoomKey(key),
      want: (id, page) =>
        setWanted((prev) =>
          prev[id]?.includes(page)
            ? prev
            : { ...prev, [id]: [...(prev[id] ?? []), page] },
        ),
      dragStart: (key) => setDragKey(key),
      dragOver: (key) => setOverKey(key),
      drop: (key) => {
        const dragged = latest.current.dragKey;
        const to = latest.current.pages.findIndex((p) => p.key === key);
        if (dragged && to >= 0) moveTo(dragged, to);
        setDragKey(null);
        setOverKey(null);
      },
      dragEnd: () => {
        setDragKey(null);
        setOverKey(null);
      },
      toggleGrab: (key) => {
        const grabbed = latest.current.grabbedKey === key;
        grabFrom.current = grabbed
          ? -1
          : latest.current.pages.findIndex((p) => p.key === key);
        setGrabbedKey(grabbed ? null : key);
      },
      handleKey: (key, e) => {
        const grabbed = latest.current.grabbedKey === key;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (grabbed) {
            setGrabbedKey(null);
            grabFrom.current = -1;
            const at = placeOf(latest.current.pages, key);
            announce(
              at === null
                ? `Dropped ${nameOf(key)}.`
                : `Dropped ${nameOf(key)} at ${at}.`,
            );
          } else {
            setGrabbedKey(key);
            grabFrom.current = latest.current.pages.findIndex(
              (p) => p.key === key,
            );
            latest.current = { ...latest.current, grabbedKey: key };
            announce(
              `Grabbed ${nameOf(key)}. Use arrow keys to move, Enter to drop, Escape to put it back.`,
            );
          }
          return;
        }
        if (e.key === "Escape") {
          if (!grabbed) return;
          e.preventDefault();
          setGrabbedKey(null);
          const home = grabFrom.current;
          grabFrom.current = -1;
          const list = latest.current.pages;
          const now = list.findIndex((p) => p.key === key);
          if (home >= 0 && home < list.length && home !== now) {
            const next = moveKeyTo(list, key, home);
            latest.current = { ...latest.current, pages: next };
            update((l) => moveKeyTo(l, key, home));
            const at = placeOf(next, key);
            announce(
              `Move cancelled. ${nameOf(key)} is back${at ? ` at ${at}` : ""}.`,
            );
          } else announce("Move cancelled.");
          return;
        }
        if (!grabbed) return;
        const from = latest.current.pages.findIndex((p) => p.key === key);
        const end = latest.current.pages.length - 1;
        const to =
          e.key === "ArrowLeft" || e.key === "ArrowUp"
            ? from - 1
            : e.key === "ArrowRight" || e.key === "ArrowDown"
              ? from + 1
              : e.key === "Home"
                ? 0
                : e.key === "End"
                  ? end
                  : null;
        if (to === null) return;
        e.preventDefault();
        moveTo(key, to);
      },
    };
  }, [announce, update]);

  /** The roving tab stop: the tile it names, or the first one. */
  const tabKey =
    activeKey && pages.some((p) => p.key === activeKey)
      ? activeKey
      : (pages[0]?.key ?? null);

  /**
   * Arrow keys between tiles, landing on the same button of the next one.
   * A grabbed handle has already used its key (`defaultPrevented`).
   */
  const onGridKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.defaultPrevented) return;
    const list = listRef.current;
    const target = e.target as HTMLElement;
    if (!list || target.tagName !== "BUTTON") return;
    const tiles = [...list.children] as HTMLElement[];
    const tile = tiles.find((t) => t.contains(target));
    if (!tile) return;
    const from = tiles.indexOf(tile);
    // Columns: the tiles sharing the first one's row (1 where nothing has a
    // layout, as in a test page).
    const top = tiles[0]!.offsetTop;
    let columns = tiles.findIndex((t) => t.offsetTop !== top);
    if (columns <= 0) columns = 1;
    const to =
      e.key === "ArrowLeft"
        ? from - 1
        : e.key === "ArrowRight"
          ? from + 1
          : e.key === "ArrowUp"
            ? from - columns
            : e.key === "ArrowDown"
              ? from + columns
              : e.key === "Home"
                ? 0
                : e.key === "End"
                  ? tiles.length - 1
                  : null;
    if (to === null) return;
    e.preventDefault();
    const next = tiles[Math.max(0, Math.min(tiles.length - 1, to))]!;
    const buttons = [...tile.querySelectorAll("button")];
    const nextButtons = [...next.querySelectorAll("button")];
    const slot = Math.max(0, buttons.indexOf(target as HTMLButtonElement));
    (nextButtons[Math.min(slot, nextButtons.length - 1)] ?? next).focus();
  };
  /** Focus inside a tile (Tab, a click, the arrows) makes it the tab stop. */
  const onGridFocus = (e: React.FocusEvent<HTMLUListElement>) => {
    const list = listRef.current;
    if (!list) return;
    const index = [...list.children].findIndex((t) => t.contains(e.target));
    const key = pages[index]?.key;
    if (key && key !== activeKey) setActiveKey(key);
  };

  const zoomIndex =
    zoomKey === null ? -1 : pages.findIndex((p) => p.key === zoomKey);
  const zoomPages = useMemo<BoardPage[] | null>(
    () =>
      zoomKey === null
        ? null
        : pages.map((p) => {
            const file = fileOf.get(p.fileId);
            return {
              sourceIndex: p.pageIndex,
              rotation: p.rotation,
              bytes: file?.bytes,
              label: `Page ${p.pageIndex + 1} of ${file?.name ?? "a file"}`,
            };
          }),
    [zoomKey, pages, fileOf],
  );
  const zoomFile = zoomIndex >= 0 ? fileOf.get(pages[zoomIndex]!.fileId) : null;

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
        {onUndo && (
          <ChipButton onClick={onUndo}>
            <Undo2 className="size-3.5" aria-hidden />
            Undo
          </ChipButton>
        )}
      </div>
      <ul
        ref={listRef}
        role="list"
        aria-label="Pages of every file, in merged order: drag a tile, use its move buttons, or grab its handle and use the arrow keys. Tab enters the grid once; the arrow keys go from page to page."
        onKeyDown={onGridKeyDown}
        onFocus={onGridFocus}
        className="border-line bg-wash rounded-panel grid max-h-[58vh] list-none grid-cols-2 gap-3 overflow-auto border p-3 sm:grid-cols-3 lg:grid-cols-4"
      >
        {pages.map((page, i) => (
          <MergeTile
            key={page.key}
            page={page}
            position={i + 1}
            fileName={fileOf.get(page.fileId)?.name ?? ""}
            at={merged.get(page.key)}
            keptCount={keptCount}
            thumbnail={thumbs[page.fileId]?.[page.pageIndex] ?? null}
            first={i === 0}
            last={i === pages.length - 1}
            lastKept={page.kept && keptOf.get(page.fileId) === 1}
            grabbed={grabbedKey === page.key}
            dropTarget={
              overKey === page.key && dragKey !== null && dragKey !== page.key
            }
            dragging={dragKey === page.key}
            active={tabKey === page.key}
            handlers={handlers}
          />
        ))}
      </ul>
      {zoomIndex >= 0 && zoomPages && zoomFile && (
        <LazyPageZoomDialog
          bytes={zoomFile.bytes}
          pageCount={pages.length}
          pages={zoomPages}
          index={zoomIndex}
          onIndex={(i) => setZoomKey(pages[i]?.key ?? null)}
          onClose={() => setZoomKey(null)}
        />
      )}
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
