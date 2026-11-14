"use client";

/* eslint-disable @next/next/no-img-element -- a rendered page is an ephemeral object URL */

/**
 * One page, large (audit remove-pages#3, 2026-11-08): the page board's
 * thumbnails are small, and telling a near-blank page or a page scanned twice
 * from its neighbours is the job Delete Pages is used for. "View page N
 * larger" (`zoomLabel` in page-select-runner.tsx) opens this dialog over the board: the page rendered afresh at
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
import { usePageImage } from "./use-page-image";

/** The CSS width the enlarged page is rendered at. */
export const ZOOM_WIDTH = 720;

export interface PageZoomDialogProps {
  bytes: Uint8Array;
  pageCount: number;
  /** 0-based page shown. */
  index: number;
  onIndex: (index: number) => void;
  selected: boolean;
  onToggle: () => void;
  onClose: () => void;
}

export function PageZoomDialog({
  bytes,
  pageCount,
  index,
  onIndex,
  selected,
  onToggle,
  onClose,
}: PageZoomDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const image = usePageImage(bytes, index, ZOOM_WIDTH);
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
  const go = (to: number) => onIndex(Math.max(0, Math.min(pageCount - 1, to)));

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
            Page {index + 1} of {pageCount}
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
          {image ? (
            <img
              src={image.url}
              alt={
                image.note
                  ? `Page ${index + 1}. ${image.note}`
                  : `Page ${index + 1}`
              }
              className="rounded-sheet max-h-[70vh] w-auto max-w-full bg-white shadow-md ring-1 ring-black/5"
            />
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
              disabled={index >= pageCount - 1}
            >
              Next page
              <ChevronRight className="size-3.5" aria-hidden />
            </ChipButton>
          </div>
          <ChipButton onClick={onToggle} active={selected}>
            Select page {index + 1}
          </ChipButton>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
