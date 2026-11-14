"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { usePdfThumbnails } from "../use-pdf-thumbnails";
import type { ViewerBookmark, ViewerPdf } from "@/lib/pdf/viewer";
import { VIEWER_LABELS } from "@/lib/pdf/viewer-copy";
import { VIEWER_LINK_REL } from "@/lib/pdf/viewer-links";
import {
  VIEWER_MAX_OUTLINE_DEPTH,
  VIEWER_MAX_OUTLINE_ITEMS,
} from "@/lib/pdf/viewer-geometry";
import { cn } from "@/lib/utils";
import { scrollWithin } from "./scroll-within";

export type SidebarTab = "thumbnails" | "bookmarks";

/** How many thumbnails render up front; the rest as they scroll into view. */
const EAGER_THUMBNAILS = 12;

/**
 * The viewer's side panel: page thumbnails (the same progressive renderer
 * every page-board tool uses, `usePdfThumbnails`), or the bookmark tree.
 * Beside the pages from 640 px up; below that (`sheet`), a sheet over them
 * with its own close button: focus moves into it when it opens, Escape
 * closes it and returns focus to the button that opened it, and the pages
 * it covers are made inert by the viewer (review, 2026-11-10: focus stayed
 * on the toolbar, Escape did nothing, and Tab reached the hidden column).
 */
export function ViewerSidebar({
  tab,
  sheet,
  bytes,
  doc,
  current,
  onPage,
  onClose,
}: {
  tab: SidebarTab;
  /** A sheet over the pages (a phone's width), not a column beside them. */
  sheet: boolean;
  bytes: Uint8Array;
  doc: ViewerPdf;
  current: number;
  onPage: (index: number) => void;
  /** `returnFocus`: put focus back on the button that opened the panel. */
  onClose: (returnFocus: boolean) => void;
}) {
  const label =
    tab === "thumbnails" ? VIEWER_LABELS.thumbnails : VIEWER_LABELS.bookmarks;
  const closeRef = useRef<HTMLButtonElement>(null);
  // A sheet takes focus as it opens (and when its tab changes).
  useEffect(() => {
    if (sheet) closeRef.current?.focus();
  }, [sheet, tab]);
  return (
    <aside
      aria-label={label}
      data-viewer-sidebar={tab}
      onKeyDown={(e) => {
        if (sheet && e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose(true);
        }
      }}
      className={cn(
        "border-line bg-panel flex min-h-0 flex-col border-r",
        // A sheet over the pages on a phone; a column beside them above.
        "max-sm:absolute max-sm:inset-0 max-sm:z-20 max-sm:border-r-0 sm:w-52 sm:shrink-0",
      )}
    >
      <div className="border-line flex items-center justify-between border-b px-3 py-1.5">
        <h3 className="text-fg text-sm font-semibold">{label}</h3>
        <button
          ref={closeRef}
          type="button"
          onClick={() => onClose(sheet)}
          aria-label={`Close ${label.toLowerCase()}`}
          className="text-muted hover:text-fg rounded-ctl grid size-11 place-items-center sm:size-8"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      {tab === "thumbnails" ? (
        <ThumbnailList
          bytes={bytes}
          pageCount={doc.numPages}
          current={current}
          onPage={onPage}
        />
      ) : (
        <BookmarkList doc={doc} onPage={onPage} />
      )}
    </aside>
  );
}

function ThumbnailList({
  bytes,
  pageCount,
  current,
  onPage,
}: {
  bytes: Uint8Array;
  pageCount: number;
  current: number;
  onPage: (index: number) => void;
}) {
  const { thumbs, requestPage } = usePdfThumbnails(bytes, pageCount, {
    eagerLimit: EAGER_THUMBNAILS,
  });
  const list = useRef<HTMLOListElement>(null);

  // Tiles past the eager ones render as they scroll into view.
  useEffect(() => {
    const root = list.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            requestPage(Number((e.target as HTMLElement).dataset.index));
          }
        }
      },
      { root, rootMargin: "200px 0px" },
    );
    for (const tile of root.querySelectorAll("[data-index]")) io.observe(tile);
    return () => io.disconnect();
  }, [requestPage, pageCount]);

  // Keep the current page's tile in view as the reader moves: the list
  // scrolls, never the web page around it (`scrollWithin`).
  useEffect(() => {
    const root = list.current;
    const tile = root?.querySelector<HTMLElement>(`[data-index="${current}"]`);
    if (root && tile) scrollWithin(root, tile, "nearest");
  }, [current]);

  return (
    <ol
      ref={list}
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3"
    >
      {Array.from({ length: pageCount }, (_, i) => {
        const thumb = thumbs[i];
        return (
          <li key={i} data-index={i}>
            <button
              type="button"
              onClick={() => onPage(i)}
              aria-current={i === current ? "page" : undefined}
              // A button's contents are presentational: the note drawn in
              // the page's place is read only as part of its name.
              aria-label={`Page ${i + 1}${thumb?.note ? `. ${thumb.note}` : ""}`}
              data-viewer-thumbnail={i + 1}
              className={cn(
                "rounded-ctl flex w-full flex-col items-center gap-1 p-1.5 text-xs",
                i === current
                  ? "bg-accent/10 text-fg ring-accent ring-2"
                  : "text-muted hover:bg-wash",
              )}
            >
              {thumb ? (
                // eslint-disable-next-line @next/next/no-img-element -- an object URL of a page this browser drew
                <img
                  src={thumb.url}
                  alt={thumb.note ?? ""}
                  className="max-h-40 w-auto max-w-full bg-white shadow-sm ring-1 ring-black/10"
                />
              ) : (
                <span className="block aspect-[3/4] w-24 bg-white shadow-sm ring-1 ring-black/10" />
              )}
              <span aria-hidden>{i + 1}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function BookmarkList({
  doc,
  onPage,
}: {
  doc: ViewerPdf;
  onPage: (index: number) => void;
}) {
  const [read, setRead] = useState<{
    entries: ViewerBookmark[];
    truncated: boolean;
  } | null>(null);
  useEffect(() => {
    let live = true;
    void doc.outline().then((r) => {
      if (live) setRead(r);
    });
    return () => {
      live = false;
    };
  }, [doc]);

  if (!read) {
    return <p className="text-muted p-3 text-sm">Reading bookmarks…</p>;
  }
  if (read.entries.length === 0) {
    return <p className="text-muted p-3 text-sm">This PDF has no bookmarks.</p>;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
      <ul className="flex flex-col">
        {read.entries.map((b, i) => (
          <li key={i} style={{ paddingInlineStart: `${b.depth * 0.75}rem` }}>
            {b.page !== null ? (
              <button
                type="button"
                onClick={() => onPage(b.page!)}
                data-viewer-bookmark=""
                className="text-fg hover:bg-wash rounded-ctl min-h-11 w-full px-2 py-2 text-left text-sm sm:min-h-0 sm:py-1.5"
              >
                {b.title}
              </button>
            ) : b.href ? (
              <a
                href={b.href}
                target="_blank"
                rel={VIEWER_LINK_REL}
                className="text-accent hover:bg-wash rounded-ctl flex min-h-11 items-center px-2 py-2 text-sm underline sm:block sm:min-h-0 sm:py-1.5"
              >
                {b.title}
              </a>
            ) : (
              <span className="text-muted block px-2 py-2 text-sm sm:py-1.5">
                {b.title}
              </span>
            )}
          </li>
        ))}
      </ul>
      {read.truncated && (
        <p className="text-muted mt-2 px-2 text-xs">
          Only the first {VIEWER_MAX_OUTLINE_ITEMS.toLocaleString("en-US")}{" "}
          bookmarks, {VIEWER_MAX_OUTLINE_DEPTH} levels deep, are listed.
        </p>
      )}
    </div>
  );
}
