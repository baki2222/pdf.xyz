"use client";

import { useEffect, useMemo, useState } from "react";
import { renderThumbnails } from "@/lib/pdf/render";
import { clampPixelRatio, type Thumbnail } from "@/lib/pdf/render-utils";

export type ThumbnailStatus = "idle" | "rendering" | "done" | "error";

export interface PdfThumbnails {
  /** One slot per page; `null` until that page has rendered. */
  thumbs: (Thumbnail | null)[];
  /** How many pages have rendered so far. */
  rendered: number;
  status: ThumbnailStatus;
}

/**
 * Progressively render real page thumbnails for a loaded PDF. Object URLs are
 * revoked on unmount or when the source changes, and rendering is cancelled via
 * an AbortSignal so switching files or unmounting never leaks work or memory.
 *
 * State is initialized from props (the editors that use this are keyed by file,
 * so a new document remounts the hook fresh), and the effect only ever calls
 * setState asynchronously. `rendered` is derived from `thumbs`, and the effect
 * overwrites each slot unconditionally, so a re-run (e.g. React Strict Mode's
 * double-invoke) can't double-count or strand a revoked URL.
 *
 * Failures are non-fatal: on error the slots stay `null` and callers fall back
 * to the placeholder tile, so the tool keeps working even if previews can't render.
 */
export function usePdfThumbnails(
  bytes: Uint8Array,
  pageCount: number,
  enabled = true,
): PdfThumbnails {
  const [thumbs, setThumbs] = useState<(Thumbnail | null)[]>(() =>
    new Array(Math.max(0, pageCount)).fill(null),
  );
  const [status, setStatus] = useState<ThumbnailStatus>(() =>
    enabled && pageCount > 0 ? "rendering" : "idle",
  );

  useEffect(() => {
    if (!enabled || pageCount <= 0) return;

    let active = true;
    const controller = new AbortController();
    const created: string[] = [];

    const pixelRatio = clampPixelRatio(
      typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
    );

    renderThumbnails(bytes, {
      pixelRatio,
      signal: controller.signal,
      onThumbnail: (thumb) => {
        if (!active) {
          URL.revokeObjectURL(thumb.url);
          return;
        }
        created.push(thumb.url);
        setThumbs((prev) => {
          const next = prev.slice();
          next[thumb.index] = thumb;
          return next;
        });
      },
    })
      .then(() => {
        if (active) setStatus("done");
      })
      .catch(() => {
        if (active) setStatus("error");
      });

    return () => {
      active = false;
      controller.abort();
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [bytes, pageCount, enabled]);

  const rendered = useMemo(
    () => thumbs.reduce((count, thumb) => (thumb ? count + 1 : count), 0),
    [thumbs],
  );

  return { thumbs, rendered, status };
}
