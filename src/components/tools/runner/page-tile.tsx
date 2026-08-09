"use client";

// Thumbnails are pre-rendered PNG blobs (object URLs); next/image adds no value
// for already-rasterized, ephemeral bitmaps, so a plain <img> is intentional.
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, type ReactNode } from "react";
import { CheckSquare, GripVertical, Square } from "lucide-react";
import type { Rotation } from "@/lib/pdf/types";
import type { Thumbnail } from "@/lib/pdf/render-utils";
import { cn } from "@/lib/utils";

/** Faux page lines to give tiles the feel of a real document thumbnail. */
function SheetLines() {
  const widths = ["70%", "90%", "82%", "60%", "88%", "45%"];
  return (
    <div className="flex h-full w-full flex-col gap-[6%] p-[12%]">
      <span className="h-[10%] w-[55%] rounded-[1px] bg-slate-500/50" />
      {widths.map((w, i) => (
        <span
          key={i}
          className="h-[5%] rounded-[1px] bg-slate-400/40"
          style={{ width: w }}
        />
      ))}
    </div>
  );
}

/** Keyboard-operable drag handle config for a sortable (organize) tile. */
export interface DragHandle {
  /** Whether this tile is currently "grabbed" for keyboard movement. */
  grabbed: boolean;
  /** Full accessible name, including how to move (changes when grabbed). */
  label: string;
  /** Grab/drop toggle for pointer users. */
  onToggle: () => void;
  /** Arrow/Home/End/Enter/Escape handling while focused. */
  onKeyDown: (event: React.KeyboardEvent) => void;
}

/**
 * A page-shaped tile. The inner "sheet" rotates to preview orientation, so a
 * 90°/270° rotation visibly becomes landscape. Presentational only — selection,
 * ordering, and lazy preview requests are driven by props.
 *
 * Three usage modes:
 *  - `selectable`: a toggle button (extract / delete / rotate scope).
 *  - `dragHandle`: a sortable list item with a focusable keyboard drag handle.
 *  - plain: a static preview.
 */
export function PageTile({
  label,
  rotation = 0,
  thumbnail,
  loading = false,
  selectable = false,
  selected = false,
  onSelect,
  ariaLabel,
  cornerBadge,
  actions,
  dimmed = false,
  draggable = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  dropTarget = false,
  dragHandle,
  onEnterView,
  className,
}: {
  label: ReactNode;
  rotation?: Rotation;
  /** Rendered page preview; when absent, a placeholder sheet is shown. */
  thumbnail?: Thumbnail | null;
  /** Animate the placeholder while a preview is still rendering. */
  loading?: boolean;
  selectable?: boolean;
  selected?: boolean;
  /** Called on click/Enter/Space; `shiftKey` powers range selection. */
  onSelect?: (shiftKey: boolean) => void;
  /** Accessible name override (used by sortable tiles to announce position). */
  ariaLabel?: string;
  cornerBadge?: ReactNode;
  actions?: ReactNode;
  dimmed?: boolean;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
  dropTarget?: boolean;
  dragHandle?: DragHandle;
  /** Called once when the tile scrolls near the viewport without a preview. */
  onEnterView?: () => void;
  className?: string;
}) {
  const interactive = selectable && Boolean(onSelect);
  const grabbed = dragHandle?.grabbed ?? false;
  const rootRef = useRef<HTMLDivElement>(null);

  // Lazy previews: ask for this page's thumbnail once it nears the viewport.
  // Kept in a ref so an inline `() => requestPage(i)` doesn't re-arm the
  // observer every render. Degrades gracefully where IntersectionObserver is
  // unavailable (SSR/jsdom) — the placeholder simply stays.
  const enterViewRef = useRef(onEnterView);
  useEffect(() => {
    enterViewRef.current = onEnterView;
  }, [onEnterView]);
  const hasThumb = Boolean(thumbnail);
  useEffect(() => {
    if (hasThumb || !enterViewRef.current) return;
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          enterViewRef.current?.();
          observer.disconnect();
        }
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasThumb]);

  return (
    <div
      ref={rootRef}
      role={interactive ? "button" : dragHandle ? "listitem" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive ? selected : undefined}
      aria-label={ariaLabel}
      onClick={interactive ? (e) => onSelect?.(e.shiftKey) : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect?.(e.shiftKey);
              }
            }
          : undefined
      }
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative flex flex-col items-center gap-2 rounded-2xl border p-3 transition duration-200",
        interactive && "cursor-pointer",
        draggable && "cursor-grab active:cursor-grabbing",
        selected
          ? "border-violet-400/60 bg-violet-500/10 ring-2 ring-violet-400/40"
          : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]",
        dropTarget && "ring-2 ring-violet-400/70",
        grabbed && "ring-2 ring-violet-400/80 ring-offset-2 ring-offset-ink",
        dimmed && "opacity-40",
        className,
      )}
    >
      {selectable && (
        <span className="absolute left-2 top-2 z-10 text-violet-300">
          {selected ? (
            <CheckSquare className="size-4" aria-hidden />
          ) : (
            <Square className="size-4 text-slate-400" aria-hidden />
          )}
        </span>
      )}
      {dragHandle && (
        <button
          type="button"
          aria-label={dragHandle.label}
          aria-pressed={dragHandle.grabbed}
          aria-roledescription="Draggable page"
          onKeyDown={dragHandle.onKeyDown}
          onClick={(e) => {
            e.stopPropagation();
            dragHandle.onToggle();
          }}
          className={cn(
            "absolute left-2 top-2 z-10 grid size-6 cursor-grab place-items-center rounded-md border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60 active:cursor-grabbing",
            grabbed
              ? "border-violet-400/60 bg-violet-500/25 text-violet-100"
              : "border-white/10 bg-ink/70 text-slate-400 hover:text-white",
          )}
        >
          <GripVertical className="size-3.5" aria-hidden />
        </button>
      )}
      {cornerBadge && (
        <span className="absolute right-2 top-2 z-10 grid min-w-5 place-items-center rounded-full bg-ink/80 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-200 ring-1 ring-white/10">
          {cornerBadge}
        </span>
      )}

      <div className="grid aspect-square w-full place-items-center overflow-hidden">
        {thumbnail ? (
          <img
            src={thumbnail.url}
            alt=""
            draggable={false}
            className="max-h-[80%] max-w-[80%] rounded-[2px] bg-white object-contain shadow-md shadow-black/40 ring-1 ring-black/5 transition-transform duration-300"
            style={{ transform: `rotate(${rotation}deg)` }}
          />
        ) : (
          <div
            className={cn(
              "relative aspect-[1/1.414] h-[78%] overflow-hidden rounded-[3px] bg-gradient-to-br from-white/95 to-slate-200/85 shadow-md shadow-black/40 ring-1 ring-black/5 transition-transform duration-300",
              loading && "animate-pulse",
            )}
            style={{ transform: `rotate(${rotation}deg)` }}
          >
            <SheetLines />
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-slate-300">{label}</span>
        {rotation !== 0 && (
          <span className="rounded bg-white/10 px-1 text-[10px] font-semibold tabular-nums text-slate-300">
            {rotation}°
          </span>
        )}
      </div>

      {actions && (
        <div className="flex flex-wrap items-center justify-center gap-1">
          {actions}
        </div>
      )}
    </div>
  );
}

/**
 * Small square icon button used inside a tile's action row.
 *
 * `disabled` renders as `aria-disabled` + a guarded click, never the native
 * attribute — the ChipButton rule (#46), and these are its sharpest case:
 * "move left" disables at index 0, i.e. exactly when the user pressing it
 * repeatedly has just moved the page to the edge, so the native attribute
 * would throw THEIR OWN focus to `<body>` mid-interaction.
 */
export function TileAction({
  onClick,
  title,
  disabled,
  children,
  danger = false,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-disabled={disabled || undefined}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onClick();
      }}
      className={cn(
        "grid size-7 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-300 transition hover:bg-white/10 hover:text-white aria-disabled:cursor-not-allowed aria-disabled:opacity-30",
        danger && "hover:border-red-400/40 hover:bg-red-500/15 hover:text-red-200",
      )}
    >
      {children}
    </button>
  );
}
