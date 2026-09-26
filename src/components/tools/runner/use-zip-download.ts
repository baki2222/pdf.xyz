"use client";

import { useCallback, useRef, useState } from "react";
import { downloadBlob, zipFiles, type ZipOptions } from "@/lib/pdf/browser";
import type { NamedBytes } from "@/lib/pdf/types";

/**
 * What a person is told when the "Download ZIP" they pressed produced nothing.
 *
 * The most likely cause is not the one that comes to mind first. JSZip is a
 * lazily loaded chunk (see `loadJsZip` in `@/lib/pdf/browser`), so the FIRST
 * archive of a session is also a network fetch — and it fails when the
 * connection dropped or a deploy retired the chunk since the page was opened.
 * Running out of memory on a very large archive is the other cause. The first
 * sentence covers both; `fallback` is the call site's own way round it.
 */
export function zipFailureMessage(fallback?: string): string {
  const base =
    "The ZIP could not be prepared. Check your connection and try again.";
  return fallback ? `${base} ${fallback}` : base;
}

export interface ZipDownloadOptions extends ZipOptions {
  /**
   * One sentence appended to the failure message naming what THIS tool offers
   * instead — per-file downloads, a lower resolution. Omit it where there is no
   * honest alternative; a suggestion the page cannot honour is worse than none.
   */
  fallback?: string;
}

/**
 * The one way a runner turns several outputs into a downloaded ZIP.
 *
 * WHY THIS EXISTS: four runners each wrote `setZipping(true); try { await
 * zipFiles(...); downloadBlob(...) } finally { setZipping(false) }` — or, in
 * batch compress, no try at all — and called it with `void`. There was no
 * `catch`, so a rejected archive (the JSZip chunk failing to load, or an
 * allocation failure on a large bundle) became an unhandled rejection: the
 * button flashed "Preparing ZIP…" back to "Download ZIP", no file arrived, and
 * nothing on the page said why. For PDF → PNG that is the only way to get a
 * multi-page result past the 24 pages that have their own buttons.
 *
 * One hook so the four cannot drift again; `zip-download.test.tsx` walks
 * `src/` for every other caller of `zipFiles(` and fails on one.
 */
export function useZipDownload() {
  const [zipping, setZipping] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);
  // A ref, not the state, guards re-entry: two clicks inside one render would
  // both read `zipping === false` and build the archive twice.
  const inFlight = useRef(false);

  const download = useCallback(
    async (
      files: NamedBytes[],
      filename: string,
      { fallback, ...zipOptions }: ZipDownloadOptions = {},
    ): Promise<boolean> => {
      if (inFlight.current) return false;
      inFlight.current = true;
      setZipping(true);
      setZipError(null);
      try {
        const blob = await zipFiles(files, zipOptions);
        downloadBlob(blob, filename);
        return true;
      } catch {
        setZipError(zipFailureMessage(fallback));
        return false;
      } finally {
        inFlight.current = false;
        setZipping(false);
      }
    },
    [],
  );

  return { zipping, zipError, download };
}
