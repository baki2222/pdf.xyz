"use client";

import { useEffect, useState } from "react";

/**
 * A displayed-orientation render of page `index` for the Auto preview, as an
 * object URL; null while it renders, when it fails, or when `index` is null.
 * Revoked when the page changes or the editor unmounts.
 */
export function usePageImage(
  bytes: Uint8Array,
  index: number | null,
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (index === null) return;
    let alive = true;
    let made: string | null = null;
    (async () => {
      try {
        const { createThumbnailRenderer } = await import("@/lib/pdf/render");
        const renderer = await createThumbnailRenderer(bytes, {
          orientation: "displayed",
          targetWidth: 200,
          pixelRatio: 2,
        });
        try {
          const thumb = await renderer.renderPage(index);
          if (thumb && alive) {
            made = thumb.url;
            setUrl(thumb.url);
          } else if (thumb) URL.revokeObjectURL(thumb.url);
        } finally {
          await renderer.destroy();
        }
      } catch {
        // The preview image is cosmetic; the dashed box still shows the crop.
      }
    })();
    return () => {
      alive = false;
      setUrl(null);
      if (made) URL.revokeObjectURL(made);
    };
  }, [bytes, index]);
  return index === null ? null : url;
}
