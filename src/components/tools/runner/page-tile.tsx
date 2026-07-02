"use client";

// Thumbnails are pre-rendered PNG blobs (object URLs); next/image adds no value
// for already-rasterized, ephemeral bitmaps, so a plain <img> is intentional.
/* eslint-disable @next/next/no-img-element */

import type { ReactNode } from "react";
import { CheckSquare, Square } from "lucide-react";
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

/**
 * A page-shaped tile. The inner "sheet" rotates to preview orientation, so a
 * 90°/270° rotation visibly becomes landscape. Presentational only — selection
 * and actions are driven by props.
 */
export function PageTile({
  label,
  rotation = 0,
  thumbnail,
  loading = false,
  selectable = false,
  selected = false,
  onSelect,
  cornerBadge,
  actions,
  dimmed = false,
  draggable = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  dropTarget = false,
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
  onSelect?: () => void;
  cornerBadge?: ReactNode;
  actions?: ReactNode;
  dimmed?: boolean;
  draggable?: boolean;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
  dropTarget?: boolean;
  className?: string;
}) {
  const interactive = selectable && Boolean(onSelect);
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive ? selected : undefined}
      onClick={interactive ? onSelect : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect?.();
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
        dimmed && "opacity-40",
        className,
      )}
    >
      {selectable && (
        <span className="absolute left-2 top-2 z-10 text-violet-300">
          {selected ? (
            <CheckSquare className="size-4" aria-hidden />
          ) : (
            <Square className="size-4 text-slate-500" aria-hidden />
          )}
        </span>
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

/** Small square icon button used inside a tile's action row. */
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
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "grid size-7 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-300 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30",
        danger && "hover:border-red-400/40 hover:bg-red-500/15 hover:text-red-200",
      )}
    >
      {children}
    </button>
  );
}
