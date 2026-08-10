"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createThumbnailRenderer,
  type ThumbnailRenderer,
} from "@/lib/pdf/render";
import { clampPixelRatio, type Thumbnail } from "@/lib/pdf/render-utils";

export type ThumbnailStatus = "idle" | "rendering" | "done" | "error";

/**
 * Default cap on how many pages render *eagerly* on load. Documents at or under
 * this size render fully up front (unchanged behavior); larger ones render the
 * first `EAGER_LIMIT` pages and then fill the rest in as they scroll into view,
 * bounding both up-front work and peak object-URL memory for huge PDFs.
 */
export const EAGER_LIMIT = 60;

export interface UsePdfThumbnailsOptions {
  enabled?: boolean;
  /** Override how many pages render eagerly before lazy loading kicks in. */
  eagerLimit?: number;
}

export interface PdfThumbnails {
  /** One slot per page; `null` until that page has rendered. */
  thumbs: (Thumbnail | null)[];
  /** How many pages have rendered so far (eager + lazy). */
  rendered: number;
  /** Status of the initial eager pass. */
  status: ThumbnailStatus;
  /** True when not every page renders eagerly — the rest load on scroll. */
  capped: boolean;
  /** How many pages render eagerly for this document. */
  eagerCount: number;
  /** Ask for a specific page's preview (used by lazy, in-view tiles). */
  requestPage: (index: number) => void;
}

/**
 * Progressively render real page thumbnails for a loaded PDF, parsing the
 * document once and rasterizing pages on demand.
 *
 * The first `eagerLimit` pages render immediately; any page beyond that is
 * rendered only when `requestPage(index)` is called (the runners wire this to an
 * on-screen check), so a 900-page PDF never rasterizes 900 bitmaps up front.
 *
 * Memory & lifecycle: every object URL we create is tracked and revoked on
 * unmount or when the source changes; the pdfjs document is destroyed and all
 * in-flight renders are aborted on teardown, so switching files or unmounting
 * never leaks work or memory. State is initialized from props and the hook is
 * keyed by file upstream, so a new document mounts it fresh.
 *
 * Failures are non-fatal: on error the slots stay `null` and callers fall back
 * to the placeholder tile, so the tool keeps working even if previews can't render.
 */
export function usePdfThumbnails(
  bytes: Uint8Array,
  pageCount: number,
  options: UsePdfThumbnailsOptions = {},
): PdfThumbnails {
  const { enabled = true, eagerLimit = EAGER_LIMIT } = options;
  const total = Math.max(0, pageCount);
  const eagerCount = Math.min(total, Math.max(0, eagerLimit));
  const capped = enabled && total > eagerCount;

  const [thumbs, setThumbs] = useState<(Thumbnail | null)[]>(() =>
    new Array(total).fill(null),
  );
  const [status, setStatus] = useState<ThumbnailStatus>(() =>
    enabled && eagerCount > 0 ? "rendering" : "idle",
  );

  // Stable handle to the current effect's request function; reset on teardown so
  // a late call from an unmounted tile is a harmless no-op.
  const requestRef = useRef<(index: number) => void>(() => {});

  useEffect(() => {
    if (!enabled || total <= 0) {
      queueMicrotask(() => {
        setStatus("idle");
      });
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const created = new Set<string>(); // every object URL we hand out
    const claimed = new Set<number>(); // pages rendered or queued (never twice)
    const queue: number[] = [];
    let draining = false;
    let renderer: ThumbnailRenderer | null = null;
    let eagerRemaining = eagerCount;

    const pixelRatio = clampPixelRatio(
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
    );

    const write = (thumb: Thumbnail) => {
      if (cancelled) {
        URL.revokeObjectURL(thumb.url);
        return;
      }
      created.add(thumb.url);
      setThumbs((prev) => {
        const next = prev.slice();
        next[thumb.index] = thumb;
        return next;
      });
    };

    const drain = async () => {
      if (draining) return;
      draining = true;
      try {
        while (queue.length > 0 && !cancelled && !controller.signal.aborted) {
          const index = queue.shift()!;
          const isEager = index < eagerCount;
          const thumb = renderer
            ? await renderer.renderPage(index, {
                pixelRatio,
                signal: controller.signal,
              })
            : null;
          if (thumb) write(thumb);
          // Count every eager page we *attempt*, so a single failed page can't
          // strand the status in "rendering" forever.
          if (isEager && eagerRemaining > 0) {
            eagerRemaining -= 1;
            if (eagerRemaining === 0 && !cancelled) setStatus("done");
          }
        }
      } finally {
        draining = false;
      }
    };

    const enqueue = (index: number) => {
      if (cancelled || !Number.isInteger(index)) return;
      if (index < 0 || index >= total || claimed.has(index)) return;
      claimed.add(index);
      queue.push(index);
      if (renderer) void drain();
    };

    requestRef.current = enqueue;

    (async () => {
      try {
        renderer = await createThumbnailRenderer(bytes, { pixelRatio });
        if (cancelled) {
          await renderer.destroy();
          return;
        }
        for (let i = 0; i < eagerCount; i++) enqueue(i);
        await drain();
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      requestRef.current = () => {};
      for (const url of created) URL.revokeObjectURL(url);
      created.clear();
      renderer?.destroy().catch(() => {});
    };
  }, [bytes, total, eagerCount, enabled]);

  const requestPage = useCallback((index: number) => {
    requestRef.current(index);
  }, []);

  const rendered = useMemo(
    () => thumbs.reduce((count, thumb) => (thumb ? count + 1 : count), 0),
    [thumbs],
  );

  return { thumbs, rendered, status, capped, eagerCount, requestPage };
}
