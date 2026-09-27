"use client";

import { useCallback, useState } from "react";
import { PdfEngineError, getPageRotations } from "@/lib/pdf/engine";
import { classifyPdfAccess, type PdfAccess } from "@/lib/pdf/encryption";
import { readFileBytes } from "@/lib/pdf/browser";
import { validatePdfFile } from "@/lib/pdf/files";
import type { Rotation } from "@/lib/pdf/types";
import { errorMessage } from "./runner-kit";

export interface LoadedPdf {
  file: File;
  bytes: Uint8Array;
  pageCount: number;
  /** Each page's current rotation, in document order. */
  rotations: Rotation[];
}

/**
 * An encrypted PDF the in-browser engine refused, with what a READER makes of
 * it. Only produced for a caller that opts in with `classifyLocked`.
 */
export interface LockedPdf {
  file: File;
  bytes: Uint8Array;
  access: Exclude<PdfAccess, { kind: "unencrypted" }>;
}

export interface UseSinglePdfOptions {
  /**
   * When pdf-lib refuses an encrypted file, ask pdf.js whether it opens
   * without a password, and report it as `locked` instead of an error.
   *
   * Opt-in because every other single-file tool rewrites the document in the
   * browser and has nothing to offer either kind of encrypted file; a tool
   * with a path that does not need pdf-lib (Compress's secure worker) opts in.
   */
  classifyLocked?: boolean;
}

/**
 * Loads a single PDF into memory and reads its page count and per-page
 * rotations up front, so runners can render an accurate page board immediately.
 */
export function useSinglePdf({
  classifyLocked = false,
}: UseSinglePdfOptions = {}) {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [locked, setLocked] = useState<LockedPdf | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(
    async (file: File) => {
      const check = validatePdfFile(file);
      setLocked(null);
      if (!check.ok) {
        setError(check.reason ?? "That file can't be used here.");
        setPdf(null);
        return;
      }
      setLoading(true);
      setError(null);
      let bytes: Uint8Array | null = null;
      try {
        bytes = await readFileBytes(file);
        const rotations = await getPageRotations(bytes);
        setPdf({ file, bytes, pageCount: rotations.length, rotations });
      } catch (err) {
        setPdf(null);
        const access =
          classifyLocked &&
          bytes &&
          err instanceof PdfEngineError &&
          err.kind === "encrypted"
            ? await classifyPdfAccess(bytes)
            : null;
        // "unencrypted" here would contradict pdf-lib's refusal; report the
        // refusal rather than trust either side of a disagreement.
        if (bytes && access && access.kind !== "unencrypted") {
          setLocked({ file, bytes, access });
        } else {
          setError(errorMessage(err));
        }
      } finally {
        setLoading(false);
      }
    },
    [classifyLocked],
  );

  const clear = useCallback(() => {
    setPdf(null);
    setLocked(null);
    setError(null);
  }, []);

  return { pdf, locked, loading, error, open, clear };
}
