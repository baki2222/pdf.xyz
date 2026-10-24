"use client";

import { useEffect, useRef } from "react";
import type { EditorPdf } from "@/lib/pdf/editor/page-render";

/**
 * One page's pdf.js raster. Rendered only while `near` the view, re-rendered
 * (debounced) when the scale settles, and dropped when it scrolls far away.
 * The previous raster stays up — stretched by CSS — until the sharper one is
 * ready, so a zoom never flashes a blank sheet.
 */
export function PageCanvas({
  doc,
  index,
  turn = 0,
  scale,
  near,
  onRendered,
}: {
  doc: EditorPdf | null;
  /** The SOURCE page to draw. */
  index: number;
  /** Quarter turn added to its own /Rotate. */
  turn?: number;
  scale: number;
  near: boolean;
  onRendered?: (index: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const drawnAt = useRef<string | null>(null);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    if (!near || !doc) {
      if (!near && node.firstChild) {
        const old = node.firstChild as HTMLCanvasElement;
        old.width = 0;
        old.height = 0;
        node.replaceChildren();
        drawnAt.current = null;
      }
      return;
    }
    const key = `${index}:${turn}:${scale}`;
    if (drawnAt.current === key) return;
    const controller = new AbortController();
    const delay = drawnAt.current === null ? 0 : 140;
    const timer = window.setTimeout(() => {
      const ratio = window.devicePixelRatio || 1;
      void doc
        .render(index, scale, ratio, controller.signal, turn)
        .then((canvas) => {
          if (!canvas || controller.signal.aborted) return;
          canvas.style.width = "100%";
          canvas.style.height = "100%";
          canvas.style.display = "block";
          canvas.setAttribute("aria-hidden", "true");
          const old = node.firstChild as HTMLCanvasElement | null;
          node.replaceChildren(canvas);
          if (old) {
            old.width = 0;
            old.height = 0;
          }
          drawnAt.current = key;
          onRendered?.(index);
        });
    }, delay);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [doc, index, turn, scale, near, onRendered]);

  return <div ref={host} className="absolute inset-0" data-page-raster="" />;
}
