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
        setZipError(ZIP_FAILED_MESSAGE);
      } finally {
        setZipping(false);
      }
    },
    [zip, save],
  );

  return { zipping, zipError, downloadZip };
}
