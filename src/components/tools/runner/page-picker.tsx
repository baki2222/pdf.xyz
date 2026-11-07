"use client";

/**
 * The shared thumbnail page picker (audits split-pdf#3, pdf-to-png#7,
 * resize-pdf#6, 2026-11-08): a grid of the PDF's own pages, rendered in the
 * browser by the same pdf.js thumbnail path the page tools already use, for a
 * tool whose page choice was a typed box only.
 *
 * Two modes:
 *  - `select`: each tile toggles its page (Shift extends a run), with Select
 *    all, Clear, Odd pages and Even pages above the grid.
 *  - `cut`: each tile but the last carries a "Cut after page N" toggle, and a
 *    badge with the file(s) the page lands in — the split points, by eye.
 *
 * Presentational over a set the caller owns: the caller derives `value` from
 * its typed box and writes the box back in `onChange` (page-picker-text.ts),
 * so the two cannot drift. Keyboard: one tab stop for the whole grid; the
 * arrow keys, Home and End move it; Space or Enter presses the focused tile.
 *
 * Loaded only through `page-picker-lazy.tsx`, so its code — and the tiles and
 * thumbnail hook it brings — is fetched when a picker is first shown.
 */
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Scissors } from "lucide-react";
import type { Rotation } from "@/lib/pdf/types";
import { cn } from "@/lib/utils";
import { ChipButton, PreviewStatus } from "./runner-kit";
import { PageTile } from "./page-tile";
import {
  allIndices,
  evenPages,
  oddPages,
  selectRange,
  toggleIndex,
} from "./selection";
import { usePdfThumbnails } from "./use-pdf-thumbnails";

/**
 * Pages rendered up front; the rest render as they scroll into view, one at a
 * time (the hook's queue), so a long PDF never rasterizes every page at once.
 */
export const PICKER_EAGER_PAGES = 24;

/** The cut toggle's accessible name — the split page's copy quotes it. */
export const cutAfterLabel = (pageNumber: number) =>
  `Cut after page ${pageNumber}`;

export interface PagePickerProps {
  bytes: Uint8Array;
  pageCount: number;
  rotations: readonly Rotation[];
  mode: "select" | "cut";
  /** `select`: the chosen 0-based pages. `cut`: the pages a cut follows. */
  value: ReadonlySet<number>;
  onChange: (next: Set<number>) => void;
  /** The grid's accessible name. */
  label: string;
  /**
   * `cut`: the 1-based files each page lands in (more than one where typed
   * ranges overlap), or an empty list for none.
   */
  partOf?: readonly (readonly number[])[];
  /** A short line under a tile's name, e.g. its page size. */
  caption?: (index: number) => string | undefined;
  disabled?: boolean;
}

export function PagePicker({
  bytes,
  pageCount,
  rotations,
  mode,
  value,
  onChange,
  label,
  partOf,
  caption,
  disabled = false,
}: PagePickerProps) {
  const { thumbs, rendered, status, capped, eagerCount, requestPage } =
    usePdfThumbnails(bytes, pageCount, { eagerLimit: PICKER_EAGER_PAGES });
  const gridRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<number | null>(null);
  // The page whose control holds the grid's one tab stop.
  const [active, setActive] = useState(0);
  // In cut mode the last page has no control, so its neighbour holds the stop.
  const lastFocusable = mode === "cut" ? pageCount - 2 : pageCount - 1;
  const stop = Math.max(0, Math.min(active, lastFocusable));

  const change = (next: Set<number>) => {
    if (!disabled) onChange(next);
  };

  const controls = () =>
    Array.from(
      gridRef.current?.querySelectorAll<HTMLElement>(
        "[data-picker-page] [tabindex]",
      ) ?? [],
    );
  const pageOf = (el: Element | null) => {
    const slot = el?.closest<HTMLElement>("[data-picker-page]");
    return slot ? Number(slot.dataset.pickerPage) : null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
    if (![...keys, "Home", "End"].includes(event.key)) return;
    const list = controls();
    const at = list.indexOf(event.target as HTMLElement);
    if (at < 0) return;
    // Columns as laid out: the controls sharing the first one's row.
    const top = list[0]!.getBoundingClientRect().top;
    const columns = Math.max(
      1,
      list.filter((el) => el.getBoundingClientRect().top === top).length,
    );
    const step: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -columns,
      ArrowDown: columns,
    };
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? list.length - 1
          : Math.max(0, Math.min(list.length - 1, at + step[event.key]!));
    event.preventDefault();
    const target = list[next]!;
    const page = pageOf(target);
    if (page !== null) setActive(page);
    target.focus();
  };

  return (
    <div className="flex flex-col gap-3">
      {mode === "select" && (
        <div className="flex flex-wrap items-center gap-2">
          <ChipButton
            onClick={() => change(allIndices(pageCount))}
            disabled={disabled}
          >
            Select all
          </ChipButton>
          <ChipButton
            onClick={() => change(new Set())}
            disabled={disabled || value.size === 0}
          >
            Clear
          </ChipButton>
          <ChipButton
            onClick={() => change(oddPages(pageCount))}
            disabled={disabled}
          >
            Odd pages
          </ChipButton>
          <ChipButton
            onClick={() => change(evenPages(pageCount))}
            disabled={disabled || pageCount < 2}
          >
            Even pages
          </ChipButton>
        </div>
      )}
      <PreviewStatus
        rendered={rendered}
        total={pageCount}
        status={status}
        capped={capped}
        eager={eagerCount}
      />
      <div
        ref={gridRef}
        role="group"
        aria-label={label}
        onKeyDown={onKeyDown}
        onFocus={(event) => {
          const page = pageOf(event.target);
          if (page !== null) setActive(page);
        }}
        className="border-line bg-wash rounded-panel grid max-h-[50vh] grid-cols-2 gap-3 overflow-auto border p-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6"
      >
        {Array.from({ length: pageCount }, (_, i) => {
          const name = `Page ${i + 1}`;
          const line = caption?.(i);
          const tileLabel: ReactNode = (
            <>
              {name}
              {line && (
                <span className="text-muted block text-center text-[10px] font-normal">
                  {line}
                </span>
              )}
            </>
          );
          const common = {
            label: tileLabel,
            rotation: rotations[i] ?? 0,
            thumbnail: thumbs[i],
            loading: status === "rendering",
            onEnterView: capped ? () => requestPage(i) : undefined,
          } as const;
          if (mode === "select") {
            return (
              <div key={i} data-picker-page={i} className="contents">
                <PageTile
                  {...common}
                  ariaLabel={line ? `${name}, ${line}` : name}
                  selectable
                  selected={value.has(i)}
                  tabIndex={i === stop ? 0 : -1}
                  onSelect={(shiftKey) => {
                    change(
                      shiftKey && anchorRef.current !== null
                        ? selectRange(value, anchorRef.current, i, pageCount)
                        : toggleIndex(value, i),
                    );
                    anchorRef.current = i;
                  }}
                />
              </div>
            );
          }
          const parts = partOf?.[i] ?? [];
          const cut = value.has(i);
          return (
            <div key={i} data-picker-page={i} className="contents">
              <PageTile
                {...common}
                cornerBadge={parts.length ? parts.join(", ") : undefined}
                dimmed={parts.length === 0}
                actions={
                  i < pageCount - 1 ? (
                    <button
                      type="button"
                      title={cutAfterLabel(i + 1)}
                      aria-label={cutAfterLabel(i + 1)}
                      aria-pressed={cut}
                      aria-disabled={disabled || undefined}
                      tabIndex={i === stop ? 0 : -1}
                      onClick={() => change(toggleIndex(value, i))}
                      className={cn(
                        "rounded-ctl tap focus-visible:ring-accent/50 grid size-7 place-items-center border transition outline-none focus-visible:ring-2",
                        cut
                          ? "border-accent/40 bg-accent/10 text-accent"
                          : "border-line bg-wash text-muted hover:text-fg",
                      )}
                    >
                      <Scissors className="size-3.5" aria-hidden />
                    </button>
                  ) : undefined
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
