"use client";

import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { AlertTriangle } from "lucide-react";
import type { TextLayerHandle, ViewerLink, ViewerPdf } from "@/lib/pdf/viewer";
import { VIEWER_LINK_REL } from "@/lib/pdf/viewer-links";
import { turnFractionRect, type QuarterTurn } from "@/lib/pdf/viewer-geometry";
import type { SearchMatch } from "@/lib/pdf/viewer-search";
import { VIEWER_PAGE_FAILED } from "@/lib/pdf/viewer-copy";

type Status = "waiting" | "drawn" | "failed";

/**
 * One page of the viewer's column: a sheet at the page's real size, placed
 * where the shared layout puts it. A LIVE page (the visible ones and one
 * each side, `liveWindow`) holds a canvas, its selectable text and its
 * links; every other page is the empty sheet alone, so the column keeps its
 * height and the number of canvases stays bounded. Leaving the window, or
 * any change of zoom or turn, aborts the draw in flight and drops the
 * canvas (its pixels released by sizing it to zero).
 *
 * A page that cannot be drawn says so on its sheet, never shows a blank
 * page as if it were one.
 */
export const ViewerPage = memo(function ViewerPage({
  doc,
  index,
  top,
  left,
  width,
  height,
  scale,
  turn,
  live,
  pixelRatio,
  hits,
  activeHit,
  revealToken,
  onPage,
}: {
  doc: ViewerPdf;
  index: number;
  top: number;
  left: number;
  width: number;
  height: number;
  scale: number;
  turn: QuarterTurn;
  live: boolean;
  pixelRatio: number;
  /** This page's search matches, highlighted in its text layer. */
  hits: readonly SearchMatch[] | undefined;
  /** Which of `hits` is the current match, or -1. */
  activeHit: number;
  /**
   * Bumped each time the reader moves to a match: the page scrolls its
   * active match into view once per token, not every time it is redrawn.
   */
  revealToken: number;
  /** Follow an internal link to page `index` (0-based). */
  onPage: (index: number) => void;
}) {
  const canvasHost = useRef<HTMLDivElement>(null);
  const textHost = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("waiting");
  const [layer, setLayer] = useState<TextLayerHandle | null>(null);
  const [links, setLinks] = useState<ViewerLink[]>([]);
  const revealed = useRef(0);

  // The canvas: drawn while live, at this scale, turn and screen ratio. A
  // zoom keeps the page's last canvas, stretched to the new size, until the
  // new one is drawn (no white flash); a turn, or leaving the live window,
  // drops it at once.
  const shown = useRef<{ canvas: HTMLCanvasElement; turn: QuarterTurn } | null>(
    null,
  );
  const [stale, setStale] = useState(false);
  const drop = () => {
    const c = shown.current?.canvas;
    if (!c) return;
    c.remove();
    c.width = 0;
    c.height = 0;
    shown.current = null;
  };
  useEffect(() => {
    if (!live) {
      drop();
      queueMicrotask(() => setStatus("waiting"));
      return;
    }
    const controller = new AbortController();
    if (shown.current && shown.current.turn !== turn) drop();
    const keeping = shown.current !== null;
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setStale(keeping);
      if (!keeping) setStatus("waiting");
    });
    void doc
      .render(index, scale, pixelRatio, turn, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) {
          if (result.kind === "drawn") {
            result.canvas.width = 0;
            result.canvas.height = 0;
          }
          return;
        }
        if (result.kind === "drawn") {
          const canvas = result.canvas;
          canvas.setAttribute("aria-hidden", "true");
          canvas.style.width = "100%";
          canvas.style.height = "100%";
          canvas.style.display = "block";
          drop();
          canvasHost.current?.replaceChildren(canvas);
          shown.current = { canvas, turn };
          setStatus("drawn");
        } else if (result.kind === "failed") {
          drop();
          setStatus("failed");
        }
        setStale(false);
      });
    return () => controller.abort();
  }, [doc, index, scale, turn, pixelRatio, live]);
  // Unmounted (scrolled far away): the canvas goes with the sheet.
  useEffect(() => () => drop(), []);

  // The selectable text, drawn over the canvas at the same scale and turn.
  useEffect(() => {
    const host = textHost.current;
    if (!live || !host) return;
    const controller = new AbortController();
    host.replaceChildren();
    void doc
      .textLayer(index, host, scale, turn, controller.signal)
      .then((handle) => {
        if (!controller.signal.aborted) setLayer(handle);
      });
    return () => {
      controller.abort();
      setLayer(null);
      host.replaceChildren();
    };
  }, [doc, index, scale, turn, live]);

  // Links: read once the page is live, kept for the page's life.
  useEffect(() => {
    if (!live) return;
    let current = true;
    void doc.links(index).then((found) => {
      if (current) setLinks(found);
    });
    return () => {
      current = false;
    };
  }, [doc, index, live]);

  // Search highlights, inside the text layer's spans, by character.
  useEffect(() => {
    if (!layer) return;
    const marked = applyHits(layer.divs, hits ?? [], activeHit);
    if (marked && revealed.current !== revealToken) {
      revealed.current = revealToken;
      marked.scrollIntoView?.({ block: "center", inline: "nearest" });
    }
    return () => clearHits(layer.divs);
  }, [layer, hits, activeHit, revealToken]);

  const style: CSSProperties & Record<`--${string}`, string> = {
    top,
    left,
    width,
    height,
    "--total-scale-factor": String(scale),
    "--scale-round-x": "1px",
    "--scale-round-y": "1px",
  };

  return (
    <div
      role="group"
      aria-roledescription="page"
      aria-label={`Page ${index + 1}`}
      data-viewer-page={index + 1}
      data-viewer-page-status={
        !live ? "placeholder" : stale ? "redrawing" : status
      }
      className="absolute overflow-hidden bg-white shadow-sm ring-1 ring-black/10"
      style={style}
    >
      <div ref={canvasHost} className="absolute inset-0" />
      {status !== "drawn" && live && status === "waiting" && (
        <span
          aria-hidden
          className="text-faint absolute inset-0 grid place-items-center text-xs"
        >
          {index + 1}
        </span>
      )}
      {live && status === "failed" && (
        <div
          role="note"
          data-viewer-page-failed=""
          className="bg-wash text-fg absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm"
        >
          <AlertTriangle className="text-warn size-5" aria-hidden />
          <span>
            {VIEWER_PAGE_FAILED} (page {index + 1})
          </span>
        </div>
      )}
      <div ref={textHost} className="textLayer" />
      {live &&
        links.map((link, i) => {
          const r = turnFractionRect(link.rect, turn);
          const pos: CSSProperties = {
            left: `${r.left * 100}%`,
            top: `${r.top * 100}%`,
            width: `${r.width * 100}%`,
            height: `${r.height * 100}%`,
          };
          const cls =
            "rounded-ctl hover:bg-accent/10 focus-visible:outline-accent absolute z-[2] outline-offset-2 focus-visible:outline-2";
          return link.kind === "page" ? (
            <a
              key={i}
              href={`#page=${link.page + 1}`}
              data-viewer-link="page"
              aria-label={`Go to page ${link.page + 1}`}
              className={cls}
              style={pos}
              onClick={(e) => {
                e.preventDefault();
                onPage(link.page);
              }}
            />
          ) : (
            <a
              key={i}
              href={link.href}
              target="_blank"
              rel={VIEWER_LINK_REL}
              data-viewer-link="url"
              aria-label={`Open ${link.href} (new tab)`}
              className={cls}
              style={pos}
            />
          );
        })}
    </div>
  );
});

const HIT = "data-viewer-hit";

/**
 * Wrap each matched character range of the text layer's spans in a
 * `<mark>`, splitting the span's text as pdf.js's own viewer does; returns
 * the active match's first mark. Each span's text is its item's string, so
 * the ranges (in characters of that string) land on the right glyphs.
 */
function applyHits(
  divs: readonly HTMLElement[],
  hits: readonly SearchMatch[],
  active: number,
): HTMLElement | null {
  const byDiv = new Map<
    number,
    { start: number; end: number; on: boolean }[]
  >();
  hits.forEach((match, m) => {
    for (const r of match) {
      const list = byDiv.get(r.item) ?? [];
      list.push({ start: r.start, end: r.end, on: m === active });
      byDiv.set(r.item, list);
    }
  });
  let first: HTMLElement | null = null;
  for (const [i, ranges] of byDiv) {
    const div = divs[i];
    if (!div) continue;
    const text = div.textContent ?? "";
    div.dataset.viewerText = text;
    ranges.sort((a, b) => a.start - b.start);
    const nodes: Node[] = [];
    let at = 0;
    for (const r of ranges) {
      if (r.start > at)
        nodes.push(document.createTextNode(text.slice(at, r.start)));
      const mark = document.createElement("mark");
      mark.setAttribute(HIT, r.on ? "active" : "");
      mark.textContent = text.slice(Math.max(r.start, at), r.end);
      nodes.push(mark);
      if (r.on && !first) first = mark;
      at = Math.max(at, r.end);
    }
    if (at < text.length) nodes.push(document.createTextNode(text.slice(at)));
    div.replaceChildren(...nodes);
  }
  return first;
}

function clearHits(divs: readonly HTMLElement[]) {
  for (const div of divs) {
    const text = div.dataset.viewerText;
    if (text === undefined) continue;
    div.textContent = text;
    delete div.dataset.viewerText;
  }
}
