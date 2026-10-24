"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  FilePlus2,
  RotateCw,
  Trash2,
} from "lucide-react";
import type { EditorPdf } from "@/lib/pdf/editor/page-render";
import { cn } from "@/lib/utils";

/**
 * The page list beside the pages (desktop) or in the Pages sheet (phones
 * and tablets): a thumbnail per page as it is DISPLAYED — the editor's page
 * list, not the file's — with rotate, insert-a-blank-page-after, delete and
 * reorder (drag a thumbnail, or its move buttons, or Alt+Arrow on it). Every
 * operation is one undo step, objects following their page (`pages.ts`).
 */

const THUMB_WIDTH = 88;

export interface RailPage {
  /** Stable across reorders (the page's id). */
  key: string;
  /** Source page to draw, or null for a blank page. */
  source: number | null;
  turn: number;
  width: number;
  height: number;
}

export interface PageOps {
  onRotate: (index: number) => void;
  onInsert: (index: number) => void;
  onDelete: (index: number) => void;
  onMove: (from: number, to: number) => void;
}

function Thumb({
  doc,
  page,
  index,
  current,
  count,
  layout,
  ops,
  onJump,
  dragging,
  setDragging,
}: {
  doc: EditorPdf | null;
  page: RailPage;
  index: number;
  current: boolean;
  count: number;
  layout: "rail" | "sheet";
  ops: PageOps;
  onJump: (index: number) => void;
  dragging: number | null;
  setDragging: (i: number | null) => void;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  const [over, setOver] = useState(false);
  const scale = THUMB_WIDTH / page.width;

  useEffect(() => {
    const node = host.current;
    if (!node || seen) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setSeen(true);
      },
      { rootMargin: "200px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [seen]);

  useEffect(() => {
    const node = host.current;
    if (!seen || !doc || !node) return;
    if (page.source === null) {
      node.replaceChildren();
      return;
    }
    const controller = new AbortController();
    void doc
      .render(
        page.source,
        scale,
        window.devicePixelRatio || 1,
        controller.signal,
        page.turn,
      )
      .then((canvas) => {
        if (!canvas || controller.signal.aborted) return;
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.display = "block";
        node.replaceChildren(canvas);
      });
    return () => controller.abort();
  }, [seen, doc, page.source, page.turn, scale]);

  const n = index + 1;
  const iconBtn =
    "text-muted hover:text-fg hover:bg-wash rounded-ctl inline-flex flex-col items-center justify-center gap-0.5 px-0.5 py-1 text-[10px] leading-none aria-disabled:cursor-not-allowed aria-disabled:opacity-40";
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const from = Number(e.dataTransfer.getData("text/x-editor-page"));
    if (Number.isInteger(from) && from !== index) ops.onMove(from, index);
    setDragging(null);
  };
  return (
    <li
      data-rail-page={index}
      data-page-key={page.key}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/x-editor-page", String(index));
        e.dataTransfer.effectAllowed = "move";
        setDragging(index);
      }}
      onDragEnd={() => setDragging(null)}
      onDragOver={(e) => {
        if (dragging === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        "rounded-ctl flex flex-col items-center gap-0.5",
        over && dragging !== index && "ring-accent ring-2",
        dragging === index && "opacity-50",
      )}
    >
      <button
        type="button"
        onClick={() => onJump(index)}
        onKeyDown={(e) => {
          if (!e.altKey) return;
          const back = e.key === "ArrowUp" || e.key === "ArrowLeft";
          const fwd = e.key === "ArrowDown" || e.key === "ArrowRight";
          if (back && index > 0) {
            e.preventDefault();
            ops.onMove(index, index - 1);
          } else if (fwd && index < count - 1) {
            e.preventDefault();
            ops.onMove(index, index + 1);
          }
        }}
        aria-label={`Go to page ${n} of ${count}`}
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        aria-current={current ? "page" : undefined}
        className={cn(
          "rounded-ctl flex w-full flex-col items-center gap-1 p-1.5 transition",
          current ? "bg-accent/10 ring-accent/40 ring-1" : "hover:bg-wash",
        )}
      >
        <span
          ref={host}
          data-blank-page={page.source === null ? "" : undefined}
          className="block overflow-hidden bg-white shadow-sm ring-1 ring-black/10"
          style={{ width: THUMB_WIDTH, height: page.height * scale }}
        />
        <span className="text-muted text-[11px] tabular-nums">{n}</span>
      </button>
      <span
        role="group"
        aria-label={`Page ${n}`}
        className="flex flex-wrap justify-center gap-0.5"
      >
        <button
          type="button"
          aria-label={`Rotate page ${n}`}
          title="Rotate 90°"
          onClick={() => ops.onRotate(index)}
          className={iconBtn}
        >
          <RotateCw className="size-3.5" aria-hidden />
          Rotate
        </button>
        <button
          type="button"
          aria-label={`Insert a blank page after page ${n}`}
          title="Insert blank page after"
          onClick={() => ops.onInsert(index)}
          className={iconBtn}
        >
          <FilePlus2 className="size-3.5" aria-hidden />
          Blank page
        </button>
        <button
          type="button"
          aria-label={`Delete page ${n}`}
          title={count <= 1 ? "A PDF needs at least one page" : "Delete page"}
          aria-disabled={count <= 1 || undefined}
          onClick={() => {
            if (count > 1) ops.onDelete(index);
          }}
          className={cn(iconBtn, "hover:text-err")}
        >
          <Trash2 className="size-3.5" aria-hidden />
          Delete
        </button>
        {layout === "sheet" && (
          <>
            <button
              type="button"
              aria-label={`Move page ${n} earlier`}
              aria-disabled={index === 0 || undefined}
              onClick={() => {
                if (index > 0) ops.onMove(index, index - 1);
              }}
              className={iconBtn}
            >
              <ArrowLeft className="size-3.5" aria-hidden />
              Earlier
            </button>
            <button
              type="button"
              aria-label={`Move page ${n} later`}
              aria-disabled={index === count - 1 || undefined}
              onClick={() => {
                if (index < count - 1) ops.onMove(index, index + 1);
              }}
              className={iconBtn}
            >
              <ArrowRight className="size-3.5" aria-hidden />
              Later
            </button>
          </>
        )}
        {layout === "rail" && (
          <>
            <button
              type="button"
              aria-label={`Move page ${n} up`}
              aria-disabled={index === 0 || undefined}
              onClick={() => {
                if (index > 0) ops.onMove(index, index - 1);
              }}
              className={cn(iconBtn, "sr-only focus:not-sr-only")}
            >
              <ArrowUp className="size-3.5" aria-hidden />
              Up
            </button>
            <button
              type="button"
              aria-label={`Move page ${n} down`}
              aria-disabled={index === count - 1 || undefined}
              onClick={() => {
                if (index < count - 1) ops.onMove(index, index + 1);
              }}
              className={cn(iconBtn, "sr-only focus:not-sr-only")}
            >
              <ArrowDown className="size-3.5" aria-hidden />
              Down
            </button>
          </>
        )}
      </span>
    </li>
  );
}

export function ThumbnailRail({
  doc,
  pages,
  current,
  onJump,
  ops,
  layout = "rail",
}: {
  doc: EditorPdf | null;
  pages: readonly RailPage[];
  current: number;
  onJump: (index: number) => void;
  ops: PageOps;
  layout?: "rail" | "sheet";
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  return (
    <nav
      aria-label="Pages"
      data-page-rail={layout}
      className={cn(layout === "rail" && "h-full overflow-y-auto pr-1")}
    >
      <ol
        className={cn(
          layout === "rail"
            ? "flex flex-col gap-1"
            : "grid grid-cols-2 gap-2 sm:grid-cols-4",
        )}
      >
        {pages.map((page, index) => (
          <Thumb
            key={page.key}
            doc={doc}
            page={page}
            index={index}
            current={current === index}
            count={pages.length}
            layout={layout}
            ops={ops}
            onJump={onJump}
            dragging={dragging}
            setDragging={setDragging}
          />
        ))}
      </ol>
    </nav>
  );
}
