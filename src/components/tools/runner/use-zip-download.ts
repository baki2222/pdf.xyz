"use client";

import { useCallback, useRef, useState } from "react";
import { downloadBlob, zipFiles, type ZipOptions } from "@/lib/pdf/browser";
import type { NamedBytes } from "@/lib/pdf/types";

/**
 * What a result view says when its ZIP could not be built.
 *
 * JSZip is a lazily loaded chunk (see `loadJsZip` in `@/lib/pdf/browser`),
 * fetched only at the moment of the click, so the FIRST archive of a session is
 * also a network fetch — and it fails when the connection dropped or a deploy
 * retired the chunk since the page was opened. Every "Download ZIP" button used
 * to sit in a `try/finally` with no `catch`: the button flipped from "Preparing
 * ZIP…" back to "Download ZIP", nothing downloaded, and the error went only to
 * the console.
 */
export const ZIP_FAILED_MESSAGE =
  "Couldn't build the ZIP. Check your connection and try again.";

/**
 * The other cause, which the connection sentence is false of: the archive did
 * not fit in memory. V8 reports that as `RangeError: Array buffer allocation
 * failed`; other engines say "out of memory" or "allocation size". Retrying on
 * a better connection would fail the same way.
 */
export const ZIP_OUT_OF_MEMORY_MESSAGE =
  "Couldn't build the ZIP: this browser ran out of memory bundling these files. Close other tabs, or process fewer pages or files at a time, and try again.";

/**
 * Which of the two sentences is true of `err`, followed by `fallback` — the
 * call site's own way round it, when it has one.
 */
export function zipFailureMessage(err?: unknown, fallback?: string): string {
  const { name, message } = (err ?? {}) as {
    name?: unknown;
    message?: unknown;
  };
  const text = typeof message === "string" ? message : "";
  const outOfMemory =
    name === "RangeError" ||
    /out of memory|allocation (failed|size)/i.test(text);
  const base = outOfMemory ? ZIP_OUT_OF_MEMORY_MESSAGE : ZIP_FAILED_MESSAGE;
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

type Zip = (files: NamedBytes[], options?: ZipOptions) => Promise<Blob>;
type Save = (blob: Blob, filename: string) => void;

/**
 * The one way a runner turns several outputs into a downloaded ZIP: busy
 * state, the build, the save, and a failure the user can SEE.
 *
 * WHY THIS EXISTS: four runners each wrote `setZipping(true); try { await
 * zipFiles(...); downloadBlob(...) } finally { setZipping(false) }` — or, in
 * batch compress, no try at all — and called it with `void`. There was no
 * `catch`, so a rejected archive became an unhandled rejection and nothing on
 * the page said why. For PDF → PNG that is the only way to get a multi-page
 * result past the pages that have their own buttons.
 *
 * One hook so the four cannot drift again; `zip-download.test.tsx` and
 * `use-zip-download.test.tsx` walk the tree for every other caller of
 * `zipFiles(` and fail on one. `zip`/`save` are injectable so the failure
 * branch is testable without mocking a shared module.
 */
export function useZipDownload(zip: Zip = zipFiles, save: Save = downloadBlob) {
  const [zipping, setZipping] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);
  // A ref, not the state, guards re-entry: two clicks inside one render would
  // both read `zipping === false` and build the archive twice.
  const inFlight = useRef(false);

  const downloadZip = useCallback(
    async (
      files: NamedBytes[],
      filename: string,
      { fallback, ...zipOptions }: ZipDownloadOptions = {},
    ): Promise<boolean> => {
      if (inFlight.current) return false;
      inFlight.current = true;
      setZipError(null);
      setZipping(true);
      try {
        save(await zip(files, zipOptions), filename);
        return true;
      } catch (err) {
        console.error("ZIP build failed", err);
        setZipError(zipFailureMessage(err, fallback));
        return false;
      } finally {
        inFlight.current = false;
        setZipping(false);
      }
    },
    [zip, save],
  );

  return { zipping, zipError, downloadZip };
}
