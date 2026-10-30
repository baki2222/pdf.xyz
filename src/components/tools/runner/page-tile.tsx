"use client";

// Thumbnails are pre-rendered PNG blobs (object URLs); next/image adds no value
// for already-rasterized, ephemeral bitmaps, so a plain <img> is intentional.
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, type ReactNode } from "react";
import { CheckSquare, GripVertical, Square } from "lucide-react";
import type { Rotation } from "@/lib/pdf/types";
import type { Thumbnail } from "@/lib/pdf/render-utils";
import { cn } from "@/lib/utils";
import { useUnwrappedAngle } from "./unwrapped-angle";

/** Faux page lines to give tiles the feel of a real document thumbnail. */
function SheetLines() {
  const widths = ["70%", "90%", "82%", "60%", "88%", "45%"];
  return (
    <div className="flex h-full w-full flex-col gap-[6%] p-[12%]">
      <span className="rounded-tag h-[10%] w-[55%] bg-slate-500/50" />
      {widths.map((w, i) => (
        <span
          key={i}
          className="rounded-tag h-[5%] bg-slate-400/40"
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
  blankSheet,
  className,
}: {
  label: ReactNode;
  /**
   * Draw an empty sheet of this upright size instead of a preview — a page
   * the tool inserts, which has no source page to render and no text to fake
   * with placeholder lines.
   */
  blankSheet?: { width: number; height: number };
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
  // Drawn the short way round: 270° then "Right" turns to 360°, not back to 0°.
  const drawn = useUnwrappedAngle(rotation);
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
        "group rounded-panel relative flex flex-col items-center gap-2 border p-3 transition duration-200",
        draggable
          ? "cursor-grab active:cursor-grabbing"
          : interactive && "cursor-pointer",
        selected
          ? "border-accent/40 bg-accent/10 ring-accent/50 ring-2"
          : "border-line bg-wash hover:border-line-strong hover:bg-wash",
        dropTarget && "ring-accent/50 ring-2",
        grabbed && "ring-offset-ink ring-accent/50 ring-2 ring-offset-2",
        dimmed && "opacity-40",
        className,
      )}
    >
      {selectable && (
        <span className="text-accent absolute top-2 left-2 z-10">
          {selected ? (
            <CheckSquare className="size-4" aria-hidden />
          ) : (
            <Square className="text-muted size-4" aria-hidden />
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
            "focus-visible:ring-accent/50 rounded-ctl tap absolute top-2 left-2 z-10 grid size-6 cursor-grab place-items-center border transition focus:outline-none focus-visible:ring-2 active:cursor-grabbing",
            grabbed
              ? "border-accent/40 bg-accent/10 text-accent"
              : "bg-canvas/70 border-line text-muted hover:text-fg",
          )}
        >
          <GripVertical className="size-3.5" aria-hidden />
        </button>
      )}
      {cornerBadge && (
        <span className="bg-canvas/80 text-fg ring-line rounded-tag absolute top-2 right-2 z-10 grid min-w-5 place-items-center px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ring-1">
          {cornerBadge}
        </span>
      )}

      <div className="grid aspect-square w-full place-items-center overflow-hidden">
        {blankSheet ? (
          <div
            data-blank-sheet=""
            className="rounded-sheet max-h-[78%] max-w-[78%] bg-white shadow-md ring-1 shadow-black/40 ring-black/5 transition-transform duration-300"
            style={{
              aspectRatio: `${blankSheet.width} / ${blankSheet.height}`,
              [blankSheet.width >= blankSheet.height ? "width" : "height"]:
                "78%",
              transform: `rotate(${drawn}deg)`,
            }}
          />
        ) : thumbnail ? (
          <img
            src={thumbnail.url}
            alt=""
            draggable={false}
            className="rounded-sheet max-h-[80%] max-w-[80%] bg-white object-contain shadow-md ring-1 shadow-black/40 ring-black/5 transition-transform duration-300"
            style={{ transform: `rotate(${drawn}deg)` }}
          />
        ) : (
          <div
            className={cn(
              "rounded-ctl relative aspect-[1/1.414] h-[78%] overflow-hidden bg-gradient-to-br from-white/95 to-slate-200/85 shadow-md ring-1 shadow-black/40 ring-black/5 transition-transform duration-300",
              loading && "animate-pulse",
            )}
            style={{ transform: `rotate(${drawn}deg)` }}
          >
            <SheetLines />
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-muted text-xs font-medium">{label}</span>
        {rotation !== 0 && (
          <span className="bg-wash text-muted rounded-tag px-1 text-[10px] font-semibold tabular-nums">
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
        "border-line bg-wash text-muted rounded-ctl tap grid size-7 place-items-center border transition aria-disabled:cursor-not-allowed aria-disabled:opacity-30",
        danger
          ? "hover:border-err/40 hover:bg-err/10 hover:text-err"
          : "hover:bg-wash hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}
