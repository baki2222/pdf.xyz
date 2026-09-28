"use client";

import { useCallback, useState } from "react";
import { downloadBlob, zipFiles, type ZipOptions } from "@/lib/pdf/browser";
import type { NamedBytes } from "@/lib/pdf/types";

/**
 * What a result view says when its ZIP could not be built.
 *
 * JSZip is fetched only at the moment of the click (by design), and the whole
 * archive is built in memory, so a dropped connection after a long render or
 * an allocation failure on a big one both reject here. Every "Download ZIP"
 * button used to sit in a `try/finally` with no `catch`: the button flipped
 * from "Preparing ZIP…" back to "Download ZIP", nothing downloaded, and the
 * error went only to the console.
 */
export const ZIP_FAILED_MESSAGE =
  "Couldn't build the ZIP. Check your connection and try again.";

/**
 * The other cause named above, which the connection sentence is false of: the
 * archive did not fit in memory. V8 reports that as `RangeError: Array buffer
 * allocation failed`; other engines say "out of memory" or "allocation size".
 * Retrying on a better connection would fail the same way.
 */
export const ZIP_OUT_OF_MEMORY_MESSAGE =
  "Couldn't build the ZIP: this browser ran out of memory bundling these files. Close other tabs, or process fewer pages or files at a time, and try again.";

/** Which of the two sentences is true of `err`. */
export function zipFailureMessage(err: unknown): string {
  const { name, message } = (err ?? {}) as {
    name?: unknown;
    message?: unknown;
  };
  const text = typeof message === "string" ? message : "";
  const outOfMemory =
    name === "RangeError" ||
    /out of memory|allocation (failed|size)/i.test(text);
  return outOfMemory ? ZIP_OUT_OF_MEMORY_MESSAGE : ZIP_FAILED_MESSAGE;
}

type Zip = (files: NamedBytes[], options?: ZipOptions) => Promise<Blob>;
type Save = (blob: Blob, filename: string) => void;

/**
 * The one way a runner bundles a download: busy state, the build, the save,
 * and a failure the user can SEE. `zip`/`save` are injectable so the failure
 * branch is testable without mocking a shared module.
 */
export function useZipDownload(zip: Zip = zipFiles, save: Save = downloadBlob) {
  const [zipping, setZipping] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);

  const downloadZip = useCallback(
    async (files: NamedBytes[], filename: string, options?: ZipOptions) => {
      setZipError(null);
      setZipping(true);
      try {
        save(await zip(files, options), filename);
      } catch (err) {
        console.error("ZIP build failed", err);
        setZipError(zipFailureMessage(err));
      } finally {
        setZipping(false);
      }
    },
    [zip, save],
  );

  return { zipping, zipError, downloadZip };
}
