"use client";

/* eslint-disable @next/next/no-img-element -- a rendered page is an ephemeral object URL */

/**
 * One page, large (audit remove-pages#3, 2026-11-08): the page board's
 * thumbnails are small, and telling a near-blank page or a page scanned twice
 * from its neighbours is the job Delete Pages is used for. "View page N
 * larger" (`zoomLabel` and `ZoomButton` in page-zoom-lazy.tsx, on every page
 * board since backlog #9, 2026-11-17) opens this dialog over the board: the
 * page rendered afresh at
 * {@link ZOOM_WIDTH} CSS pixels (in the browser, like every thumbnail),
 * Previous page / Next page (or the arrow keys) to compare neighbours, and the
 * same selection toggle the tile has.
 *
 * A native `<dialog>` opened with `showModal()`: the focus trap and the inert
 * board behind it are the browser's own. Escape and Close shut it, and focus
 * goes back to the button that opened it. Loaded with next/dynamic when first
 * opened, so the board pays nothing for it until then.
 */
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChipButton } from "./runner-kit";
import { usePageImageState } from "./use-page-image";

/** The CSS width the enlarged page is rendered at. */
export const ZOOM_WIDTH = 720;

/**
 * One place on a board whose order is not the file's (Organize): the page it
 * holds, or the blank sheet the tool inserts there, and its turn.
 */
export interface BoardPage {
  sourceIndex: number;
  /** Clockwise turn from the unrotated page, as the tile draws it. */
  rotation: number;
  /** A page the tool inserts: an empty sheet of this upright size. */
  blank?: { width: number; height: number };
  /**
   * A board of several files (Merge PDF's page grid): the file this page is
   * drawn from, in place of the dialog's `bytes`, and its name for the
   * heading ("Page 2 of b.pdf").
   */
  bytes?: Uint8Array;
  label?: string;
}

export interface PageZoomDialogProps {
  bytes: Uint8Array;
  pageCount: number;
  /** 0-based page shown. */
  index: number;
  onIndex: (index: number) => void;
  /**
   * The selection toggle, for a caller that selects pages (Delete Pages).
   * Without `onToggle` the dialog only shows the page (Chat with PDF's
   * citations, audit #30, 2026-11-15) and draws no "Select page" chip.
   */
  selected?: boolean;
  onToggle?: () => void;
  onClose: () => void;
  /**
   * Each file page's turn as the board draws it (Rotate's pending turns), in
   * place of its own /Rotate: the page as it will come out.
   */
  rotations?: readonly number[];
  /**
   * The board's own order (Organize): `index` and Previous / Next walk this
   * list, each place drawn turned as its tile is, and named by its page and
   * its position. Without it, page `index` of the file is shown.
   */
  pages?: readonly BoardPage[];
}

export function PageZoomDialog({
  bytes,
  pageCount,
  index,
  onIndex,
  selected = false,
  onToggle,
  onClose,
  rotations,
  pages,
}: PageZoomDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const place = pages?.[index];
  const count = pages ? pages.length : pageCount;
  const { state, image } = usePageImageState(
    place?.bytes ?? bytes,
    place ? (place.blank ? null : place.sourceIndex) : index,
    ZOOM_WIDTH,
    place ? place.rotation : rotations?.[index],
  );
  const imageName = place
    ? `${place.blank ? "Blank page" : (place.label ?? `Page ${place.sourceIndex + 1}`)}, position ${index + 1} of ${count}`
    : `Page ${index + 1}`;
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    const onDialogClose = () => closeRef.current();
    dialog.addEventListener("close", onDialogClose);
    return () => {
      dialog.removeEventListener("close", onDialogClose);
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      opener?.focus({ preventScroll: true });
    };
  }, []);

  const close = () => {
    const dialog = dialogRef.current;
    if (dialog?.open && typeof dialog.close === "function") dialog.close();
    else closeRef.current();
  };
  const go = (to: number) => onIndex(Math.max(0, Math.min(count - 1, to)));

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        } else if (event.key === "ArrowLeft") go(index - 1);
        else if (event.key === "ArrowRight") go(index + 1);
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      className={cn(
        "bg-panel text-fg border-line shadow-lift m-auto border p-0",
        "max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:border-0",
        "sm:rounded-panel sm:w-[48rem] sm:max-w-[calc(100vw-2rem)]",
        "backdrop:bg-scrim",
      )}
    >
      <div className="flex h-full flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id={headingId} className="tnum text-sm font-semibold">
            {place ? imageName : `Page ${index + 1} of ${count}`}
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="border-line text-muted hover:text-fg rounded-ctl tap grid size-8 place-items-center border"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="bg-wash rounded-panel grid min-h-0 flex-1 place-items-center overflow-auto p-3">
          {place?.blank ? (
            <BlankSheet size={place.blank} rotation={place.rotation} />
          ) : image ? (
            <img
              src={image.url}
              alt={image.note ? `${imageName}. ${image.note}` : imageName}
              className="rounded-sheet max-h-[70vh] w-auto max-w-full bg-white shadow-md ring-1 ring-black/5"
            />
          ) : state === "failed" ? (
            <p className="text-muted text-sm">
              This page could not be drawn here.
            </p>
          ) : (
            <div
              aria-hidden
              className="bg-canvas rounded-sheet aspect-[1/1.414] h-[60vh] max-w-full"
            />
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ChipButton onClick={() => go(index - 1)} disabled={index === 0}>
              <ChevronLeft className="size-3.5" aria-hidden />
              Previous page
            </ChipButton>
            <ChipButton
              onClick={() => go(index + 1)}
              disabled={index >= count - 1}
            >
              Next page
              <ChevronRight className="size-3.5" aria-hidden />
            </ChipButton>
          </div>
          {onToggle && (
            <ChipButton onClick={onToggle} active={selected}>
              Select page {index + 1}
            </ChipButton>
          )}
        </div>
      </div>
    </dialog>,
    document.body,
  );
}

/** An inserted page: an empty sheet, turned as the tile turns it. */
function BlankSheet({
  size,
  rotation,
}: {
  size: { width: number; height: number };
  rotation: number;
}) {
  const quarter = ((rotation % 180) + 180) % 180 === 90;
  const width = quarter ? size.height : size.width;
  const height = quarter ? size.width : size.height;
  return (
    <div
      role="img"
      aria-label="Blank page"
      data-blank-sheet=""
      className="rounded-sheet max-w-full bg-white shadow-md ring-1 ring-black/5"
      style={{
        aspectRatio: `${width} / ${height}`,
        ...(width >= height
          ? { width: "100%", maxHeight: "70vh" }
          : { height: "60vh" }),
      }}
    />
  );
}
