"use client";

import { useEffect, useState } from "react";

/** A rendered page: its object URL, and the note drawn in its place, if one was. */
export interface PageImage {
  url: string;
  /** The sentence drawn instead of the page (see `Thumbnail.note`): its accessible name. */
  note?: string;
}

/**
 * Where the hook gets its renderer. An object so a test can swap it and put it
 * back — a `vi.mock` of `@/lib/pdf/render` would leave every module evaluated
 * under it (this hook, the dialog, the panels) bound to the stub for the next
 * test file (src/tests/mock-isolation.test.ts).
 */
export const pageImageDeps: {
  renderer: () => Promise<typeof import("@/lib/pdf/render")>;
} = {
  renderer: () => import("@/lib/pdf/render"),
};

/**
 * Where a preview stands. `failed` is said only when drawing really failed —
 * the renderer could not open the file, or the page came back as nothing —
 * so a caller can tell "still drawing" from "will not draw" (2026-11-15:
 * `usePageImage` returns null for both, and no copy can be true of both).
 */
export type PageImageState =
  | { state: "idle"; image: null }
  | { state: "loading"; image: null }
  | { state: "ready"; image: PageImage }
  | { state: "failed"; image: null };

const IDLE: PageImageState = { state: "idle", image: null };
const LOADING: PageImageState = { state: "loading", image: null };
const FAILED: PageImageState = { state: "failed", image: null };

/**
 * A displayed-orientation render of page `index` for a preview, with where it
 * stands. Revoked when the page changes or the caller unmounts. `targetWidth`
 * is the CSS width it is drawn at (200 for Crop's preview; the page zoom asks
 * for more).
 *
 * `bytes` is an effect dependency, so it must be ONE array per document: a
 * fresh `Uint8Array` on every render re-runs the effect each time, and the
 * cleanup's reset makes that a render loop that never settles.
 */
export function usePageImageState(
  bytes: Uint8Array,
  index: number | null,
  targetWidth = 200,
  /** Clockwise turn from the unrotated page, in place of its own /Rotate. */
  rotation?: number,
): PageImageState {
  const [result, setResult] = useState<PageImageState>(LOADING);
  useEffect(() => {
    if (index === null) return;
    let alive = true;
    let made: string | null = null;
    (async () => {
      try {
        const { createThumbnailRenderer } = await pageImageDeps.renderer();
        const renderer = await createThumbnailRenderer(bytes, {
          orientation: "displayed",
          targetWidth,
          pixelRatio: 2,
          ...(rotation === undefined ? {} : { rotation }),
        });
        try {
          const thumb = await renderer.renderPage(index);
          if (thumb && alive) {
            made = thumb.url;
            setResult({
              state: "ready",
              image: thumb.note
                ? { url: thumb.url, note: thumb.note }
                : { url: thumb.url },
            });
          } else if (thumb) URL.revokeObjectURL(thumb.url);
          else if (alive) setResult(FAILED);
        } finally {
          await renderer.destroy();
        }
      } catch {
        // A renderer that fails to close after drawing has still drawn.
        if (alive && made === null) setResult(FAILED);
      }
    })();
    return () => {
      alive = false;
      setResult(LOADING);
      if (made) URL.revokeObjectURL(made);
    };
  }, [bytes, index, targetWidth, rotation]);
  return index === null ? IDLE : result;
}

/**
 * A displayed-orientation render of page `index` for a preview, as an object
 * URL; null while it renders, when it fails, or when `index` is null. Revoked
 * when the page changes or the editor unmounts. `targetWidth` is the CSS width
 * it is drawn at (200 for Crop's preview; the page zoom asks for more).
 */
export function usePageImage(
  bytes: Uint8Array,
  index: number | null,
  targetWidth = 200,
): PageImage | null {
  // The preview image is cosmetic for Crop; the dashed box still shows the crop.
  return usePageImageState(bytes, index, targetWidth).image;
}
